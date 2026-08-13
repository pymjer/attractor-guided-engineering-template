/**
 * prompt-check.mjs — lint prompts/*.md against the flow marker contract.
 *
 * Root cause of the original "false failure" incident: a prompt example carried
 * a mismatched/typo'd result tag (`<AIE_STEP_RESULT>done</AI_STEP_RESULT>`), which
 * the model faithfully copied, defeating marker extraction. This linter makes
 * that class of bug impossible to reintroduce silently, and (prompt-contract-
 * optimization) now also enforces the deterministic contract shape so the
 * gate catches leaks/format drift instead of leaving it to runtime luck:
 *
 *   Per-tag (lintPrompt):
 *   1. Every `<…STEP_RESULT>value</…STEP_RESULT>` example MUST use exactly
 *      `<AI_STEP_RESULT>` on BOTH tags (catches AIE_ typos + open/close mismatch).
 *   2. The example `value` MUST be a valid transition marker / top-level alias
 *      for the bound step — now ALSO enforced for forEach steps (D1): forEach
 *      aggregates per-item markers, but the per-item value must still resolve to
 *      the transition∪alias union (e.g. plan-review's `approved` is valid ONLY
 *      because mission-driver.json aliases approved→all_complete).
 *   3. A `created` example MUST carry a `<FLOW_VARS>`+`<PLAN_FILE>` block that
 *      precedes it (E10 ordering); an `issues` example MUST carry `<REMAINING>`.
 *
 *   File-level (lintAllPrompts), for flow-bound prompts only:
 *   4. At least one well-formed, in-contract marker example must exist.
 *   5. Every `{{templateVar}}` must be in the injected-var allowlist (catches the
 *      E1 class: `{{backlogDir}}` used in a flow prompt where it is not injected).
 *
 *   File-level (all prompts):
 *   6. Project-specific leakage scan: Maven module flags, Jira key templates,
 *      literal `{timestamp}` — these must never appear in a generic built-in prompt.
 *
 * Run standalone: `node src/prompt-check.mjs` (exit 1 on any error).
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FLOW_NAMES = ["mission-driver", "plan-execution", "deep-audit-loop"];

// Template vars injected for FLOW-BOUND prompts. Sources:
//  - main.js delegates.vars (the mission-driver run path)
//  - per-step / engine-injected vars (forEach items, PLAN_FILE, closure script vars)
// NOTE: command-path prompts (mission-brief/mission-draft/run-postmortem) are NOT
// flow-bound and get a different var set (e.g. backlogDir, flowHint, runSkeleton),
// so the allowlist check deliberately skips them.
export const FLOW_INJECTED_VARS = new Set([
  "missionName", "projectRoot", "missionsDir", "roadmapPath", "plansDir", "planGuide",
  "auditsDir", "contextDir", "moduleContextFile", "moduleDir", "testCmd", "buildCmd",
  "lintCmd", "typecheckCmd", "checkCmd", "commitFormat", "multiAuditPrompt", "openAuditPrompt",
  "sourcePaths", "TIMESTAMP", "runDir", "selfMemoryIndex", "moduleMemoryIndex",
  "PLAN_FILE", "forEachItem", "forEachIndex", "SCRIPT_CHECK_RESULT", "SCRIPT_CHECK_DETAILS",
]);

// Project-leakage signatures that must not appear in a generic built-in prompt.
const LEAK_PATTERNS = [
  { re: /-pl\s+\S+\s+-am\b/, msg: "Maven module-scoping flags (`-pl … -am`) — use the injected {{buildCmd}}/{{testCmd}} instead" },
  { re: /\bJira\b/i, msg: "Jira-specific reference — built-in prompts must stay project-agnostic" },
  { re: /<[A-Z]{2,}>-\\d\+|\b[A-Z]{2,}-\\d\+/, msg: "hardcoded Jira-key template (e.g. `<PROJ>-\\d+`)" },
  { re: /\{timestamp\}/, msg: "literal `{timestamp}` placeholder — use {{commitFormat}} or a real date token" },
];

/**
 * Build map: prompt-basename → { markers: Set<string>, forEach: boolean }.
 * Aggregates across every flow step that references the prompt.
 */
export function buildPromptMarkerMap(rootDir = TOOL_ROOT) {
  const map = new Map();
  for (const name of FLOW_NAMES) {
    const flowPath = join(rootDir, "flows", `${name}.json`);
    if (!existsSync(flowPath)) continue;
    let flow;
    try {
      flow = JSON.parse(readFileSync(flowPath, "utf8"));
    } catch {
      continue;
    }
    const aliases = Object.keys(flow.markerAliases || {});
    for (const step of Object.values(flow.steps || {})) {
      if (!step.promptPath) continue;
      const base = basename(step.promptPath);
      const entry = map.get(base) || { markers: new Set(), forEach: false };
      for (const m of Object.keys(step.transitions || {})) entry.markers.add(m);
      for (const a of aliases) entry.markers.add(a);
      if (step.forEach) entry.forEach = true;
      map.set(base, entry);
    }
  }
  return map;
}

// Matches an XML-ish result-tag PAIR: <OPEN>value</CLOSE> where either tag name
// ends in STEP_RESULT. Deliberately loose on the tag name so typos are caught.
const TAG_PAIR_RE = /<\s*([A-Za-z_]*STEP_RESULT)\s*>\s*([A-Za-z_][A-Za-z_]*)\s*<\/\s*([A-Za-z_]*STEP_RESULT)\s*>/g;
const TEMPLATE_VAR_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Lint a single prompt's per-tag contract. Returns an array of error strings. */
export function lintPrompt(fileName, content, markerInfo) {
  const errors = [];
  TAG_PAIR_RE.lastIndex = 0;
  let m;
  let sawValidMarker = false;
  let lastCreatedIdx = -1;
  let sawIssues = false;
  while ((m = TAG_PAIR_RE.exec(content)) !== null) {
    const [full, open, value, close] = m;
    if (open !== "AI_STEP_RESULT" || close !== "AI_STEP_RESULT") {
      errors.push(
        `${fileName}: malformed result tag "${full.trim()}" — both tags must be exactly ` +
        `<AI_STEP_RESULT>…</AI_STEP_RESULT> (found <${open}>…</${close}>)`,
      );
      continue;
    }
    const v = value.toLowerCase();
    // Value membership — now enforced for forEach steps too (D1). The per-item
    // marker must resolve to the transition∪alias union of the bound step(s).
    if (markerInfo && markerInfo.markers.size > 0) {
      if (markerInfo.markers.has(v)) {
        sawValidMarker = true;
      } else {
        errors.push(
          `${fileName}: marker value "${v}" is not a valid transition/alias for its step ` +
          `(allowed: ${[...markerInfo.markers].sort().join(", ")})`,
        );
      }
    } else {
      sawValidMarker = true;
    }
    if (v === "created") lastCreatedIdx = m.index;
    if (v === "issues") sawIssues = true;
  }

  // created ⇒ FLOW_VARS+PLAN_FILE preceding it (E10 aux-data-first ordering).
  if (lastCreatedIdx >= 0) {
    const flowVarsIdx = content.indexOf("<FLOW_VARS>");
    if (!/<PLAN_FILE>/.test(content)) {
      errors.push(`${fileName}: a 'created' marker must be accompanied by a <FLOW_VARS> block containing <PLAN_FILE>`);
    } else if (flowVarsIdx === -1 || flowVarsIdx > lastCreatedIdx) {
      errors.push(`${fileName}: <FLOW_VARS> must appear BEFORE the 'created' marker (auxiliary data first, marker last)`);
    }
  }
  // issues ⇒ REMAINING block.
  if (sawIssues && !/<REMAINING>/.test(content)) {
    errors.push(`${fileName}: an 'issues' marker must be accompanied by a <REMAINING> block`);
  }

  // expose whether a valid marker was seen (for the file-level existence check)
  lintPrompt._sawValidMarker = sawValidMarker;
  return errors;
}

/** File-level checks that only make sense against a full prompt file. */
function lintFileLevel(fileName, content, markerInfo) {
  const errors = [];
  const flowBound = !!markerInfo;

  if (flowBound) {
    // (4) at least one valid in-contract marker example must exist.
    lintPrompt._sawValidMarker = false;
    // recompute presence cheaply
    let sawValid = false;
    TAG_PAIR_RE.lastIndex = 0;
    let m;
    while ((m = TAG_PAIR_RE.exec(content)) !== null) {
      const [, open, value, close] = m;
      if (open !== "AI_STEP_RESULT" || close !== "AI_STEP_RESULT") continue;
      const v = value.toLowerCase();
      if (markerInfo.markers.size === 0 || markerInfo.markers.has(v)) { sawValid = true; break; }
    }
    if (!sawValid) {
      errors.push(`${fileName}: flow-bound prompt has no well-formed in-contract <AI_STEP_RESULT> example`);
    }

    // (5) template-var allowlist.
    TEMPLATE_VAR_RE.lastIndex = 0;
    let t;
    const seen = new Set();
    while ((t = TEMPLATE_VAR_RE.exec(content)) !== null) {
      const name = t[1];
      if (!FLOW_INJECTED_VARS.has(name) && !seen.has(name)) {
        seen.add(name);
        errors.push(`${fileName}: template var {{${name}}} is not injected for flow-bound prompts (allowlist miss — likely an un-injected variable)`);
      }
    }
  }

  // (6) project-leakage scan — all prompts.
  for (const { re, msg } of LEAK_PATTERNS) {
    if (re.test(content)) {
      errors.push(`${fileName}: project leakage — ${msg}`);
    }
  }
  return errors;
}

/** Lint every prompts/*.md. Returns an array of error strings (empty = clean). */
export function lintAllPrompts(rootDir = TOOL_ROOT) {
  const promptsDir = join(rootDir, "prompts");
  if (!existsSync(promptsDir)) return [];
  const map = buildPromptMarkerMap(rootDir);
  const errors = [];
  for (const f of readdirSync(promptsDir).filter((x) => x.endsWith(".md"))) {
    const content = readFileSync(join(promptsDir, f), "utf8");
    const info = map.get(f);
    errors.push(...lintPrompt(f, content, info));
    errors.push(...lintFileLevel(f, content, info));
  }
  return errors;
}

// CLI entry
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = lintAllPrompts();
  if (errors.length === 0) {
    console.log("prompt-check: OK — all prompt result-tag examples are well-formed.");
    process.exit(0);
  }
  console.error(`prompt-check: ${errors.length} problem(s) found:`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
