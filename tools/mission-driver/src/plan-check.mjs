/**
 * plan-check.mjs — Self-contained plan checklist inspector for the mission driver.
 *
 * This is the flux-project counterpart of nop-entropy's
 * `check-plan-checklist.mjs::inspectPlan`. It parses a plan markdown file and
 * reports unchecked checklist items, plan status, and closure-evidence gaps.
 *
 * Plan format (see docs/plans/00-plan-authoring-and-execution-guide.md):
 *   > Plan Status: draft | active | completed | ...
 *   > Last Reviewed: YYYY-MM-DD
 *
 *   ### Phase N - Name
 *   Status: planned
 *   Exit Criteria:
 *   - [ ] item
 *
 *   ## Closure Gates
 *   - [ ] item
 *
 *   ## Closure
 *   Status Note: ...
 *   Closure Audit Evidence:
 *   - ...
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";

export const PLAN_STATUS_RE = /^>\s*(?:\*\*)?(?:Plan\s+)?Status(?:\*\*)?:\s*\*{0,2}([A-Za-z][A-Za-z /-]*)\*{0,2}\s*$/im;
const CHECKLIST_UNCHECKED_RE = /^(\s*)-\s+\[\s?\]\s+(.+)$/gm;
const CHECKLIST_CHECKED_RE = /^(\s*)-\s+\[x\]\s+(.+)$/gim;
// The "## Closure Gates" heading splits executor-owned phase items (before)
// from verifier-owned gate items (after). Executor contract: phases all [x],
// gates left [ ]; the independent verifier owns gate ticks.
const CLOSURE_GATES_HEADER_RE = /^#{2,4}\s+Closure Gates\s*$/im;
// Match the real "## Closure" section, NOT "## Closure Gates". `\b` alone
// would also match "Closure Gates" (word boundary before the space), and since
// the plan template always places "## Closure Gates" before "## Closure",
// content.search() would pick the wrong section. Anchoring to end-of-line
// after "Closure" ensures only the bare Closure heading is matched.
const CLOSURE_HEADER_RE = /^#{2,4}\s+Closure\s*$/im;

function toPosix(p) {
  return p.split(/\\/).join("/");
}

/**
 * Analyze a plan file and return raw metrics.
 * @param {string} filePath absolute or project-relative path to the plan
 * @param {string} [projectRoot] for computing relative paths in output
 */
function analyzePlan(filePath, projectRoot) {
  const content = readFileSync(filePath, "utf-8");
  const relPath = projectRoot ? toPosix(relative(projectRoot, filePath)) : toPosix(filePath);

  const statusMatch = content.match(PLAN_STATUS_RE);
  const planStatus = statusMatch ? statusMatch[1].trim().toLowerCase() : "unknown";
  const isCompleted = planStatus === "completed";

  // Closure section presence + evidence
  const closureHeaderIdx = content.search(CLOSURE_HEADER_RE);
  let hasClosureSection = closureHeaderIdx !== -1;
  let closureBody = "";
  if (hasClosureSection) {
    // Slice from the Closure header to the next ## heading (or EOF)
    const after = content.slice(closureHeaderIdx);
    const nextH2 = after.slice(1).search(/\n#{2}\s/);
    closureBody = nextH2 === -1 ? after : after.slice(0, nextH2 + 1);
  }

  // Closure "evidence" = any non-placeholder list item under Closure. A bare
  // "*(pending)*" or "(pending)" placeholder does not count as evidence.
  const evidenceItemRe = /^-\s+(.+)$/gm;
  const placeholderRe = /^\*\(pending\)\*$|^\(pending\)$|\bTODO\b/i;
  let closureEvidenceCount = 0;
  if (closureBody) {
    let m;
    while ((m = evidenceItemRe.exec(closureBody)) !== null) {
      if (!placeholderRe.test(m[1].trim())) closureEvidenceCount++;
    }
  }
  const hasClosureEvidence = closureEvidenceCount > 0;

  // Checklist counts (whole-document: phases + closure gates + execution plan)
  const totalUnchecked = (content.match(CHECKLIST_UNCHECKED_RE) || []).length;
  const totalChecked = (content.match(CHECKLIST_CHECKED_RE) || []).length;
  const allUnchecked = totalChecked === 0 && totalUnchecked > 0;

  // Phase/gate split: unchecked items before "## Closure Gates" belong to the
  // executor (phase items + exit criteria); items from that heading onward
  // belong to the independent closure verifier. No gates heading → everything
  // is phase-scoped (backward compatible with gate-less plans).
  const gatesHeaderMatch = content.match(CLOSURE_GATES_HEADER_RE);
  const gatesStart = gatesHeaderMatch
    ? content.indexOf(gatesHeaderMatch[0])
    : content.length;
  const beforeGates = gatesStart === content.length ? content : content.slice(0, gatesStart);
  const fromGates = gatesStart === content.length ? "" : content.slice(gatesStart);
  const phaseUnchecked = (beforeGates.match(CHECKLIST_UNCHECKED_RE) || []).length;
  const gatesUnchecked = totalUnchecked - phaseUnchecked;
  const phaseChecked = (beforeGates.match(CHECKLIST_CHECKED_RE) || []).length;

  return {
    file: relPath,
    planStatus,
    isCompleted,
    totalChecked,
    totalUnchecked,
    allUnchecked,
    phaseChecked,
    phaseUnchecked,
    gatesUnchecked,
    hasClosureSection,
    hasClosureEvidence,
    closureEvidenceCount,
  };
}

/**
 * Inspect a plan file and return a pass/fail verdict with detail messages.
 *
 * Mirrors the contract the mission-driver engine expects:
 *   { passed, file, planStatus, totalChecked, totalUnchecked, details, allUnchecked }
 *
 * @param {string} filePath plan file path
 * @param {{ strict?: boolean, projectRoot?: string }} [options]
 */
export function inspectPlan(filePath, options = {}) {
  const strict = options.strict === true;
  const projectRoot = options.projectRoot;
  const result = analyzePlan(filePath, projectRoot);

  const details = [];

  if (result.totalUnchecked > 0) {
    details.push(`${result.totalUnchecked} unchecked items`);
  }

  // A plan marked completed must carry real closure evidence.
  if (result.isCompleted && !result.hasClosureEvidence) {
    details.push("missing closure evidence");
  }

  // Strict mode: a completed plan must have an explicit Closure section.
  if (strict && result.isCompleted && !result.hasClosureSection) {
    details.push("completed plan missing ## Closure section");
  }

  const failed = details.length > 0;

  return {
    passed: !failed,
    file: result.file,
    planStatus: result.planStatus,
    totalChecked: result.totalChecked,
    totalUnchecked: result.totalUnchecked,
    phaseChecked: result.phaseChecked,
    phaseUnchecked: result.phaseUnchecked,
    gatesUnchecked: result.gatesUnchecked,
    executorHandoffOk: result.phaseUnchecked === 0 && result.gatesUnchecked > 0,
    details,
    allUnchecked: result.allUnchecked,
  };
}

// CLI entrypoint: node plan-check.mjs <plan.md> [--strict]
// Guard must use pathToFileURL(...).href (mirrors mission-check.mjs:107, WI4 /
// design §2.5 "缺陷 4"): the naive `file://${process.argv[1]}` concatenation is
// never equal to import.meta.url on Windows (file:///C:/... vs file://C:\...),
// silently no-op'ing the whole CLI body.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const file = argv.find(a => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: plan-check.mjs <plan.md> [--strict]");
    process.exit(2);
  }
  const res = inspectPlan(file, { strict });
  const summary = [
    `plan: ${res.file} | status: ${res.planStatus}`,
    `phase items: ${res.phaseChecked} checked, ${res.phaseUnchecked} unchecked (executor owns these — must be 0 after EXECUTE)`,
    `closure gates: ${res.gatesUnchecked} unchecked (verifier owns these — unticked is expected before CLOSURE_VERIFY)`,
    `executor handoff ok: ${res.executorHandoffOk}`,
    ...(res.details.length ? [`issues: ${res.details.join("; ")}`] : []),
  ].join("\n");
  console.log(JSON.stringify({ ...res, summary }, null, 2));
  process.exit(res.passed ? 0 : 1);
}
