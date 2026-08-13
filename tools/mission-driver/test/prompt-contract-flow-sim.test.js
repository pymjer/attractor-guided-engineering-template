import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMissionDriverFlow, loadSubFlow, _scanOpenAuditsList } from "../src/flow-loader.js";
import { FlowEngine } from "../src/engine.js";
import { makeMockDelegates } from "./helpers.js";

// Phase 4 (prompt-contract-optimization) — flow contract + failure-honesty +
// audit tri-state regression. Static/simulated only (no real model runs).

function subflow(name) {
  // loadSubFlow is a method that reads this.config; call with a minimal ctx so
  // it falls back to the built-in flows/ dir.
  return loadSubFlow.call({ config: {} }, name);
}

describe("Phase4 — flow contract pins (Option B + failure honesty)", () => {
  it("plan-execution: closure-pass skips CLOSURE_AUDIT; script-fail routes to it", () => {
    const f = subflow("plan-execution");
    assert.equal(f.steps.CLOSURE_SCRIPT_CHECK.transitions.pass.goto, "BUILD_VERIFY");
    assert.equal(f.steps.CLOSURE_SCRIPT_CHECK.transitions.fail.goto, "CLOSURE_AUDIT");
  });

  it("plan-execution: CLOSURE_AUDIT non-convergence is honest (onMaxRetries → failed, not BUILD_VERIFY) [6D]", () => {
    const f = subflow("plan-execution");
    assert.deepEqual(f.steps.CLOSURE_AUDIT.onMaxRetries, { done: "failed" });
  });

  it("mission-driver: Option B — DRAFT routes THROUGH REVIEW_PLANS (no self-promote skip)", () => {
    const f = createMissionDriverFlow({ flowName: "mission-driver" });
    assert.equal(f.steps.DRAFT_PLANS.transitions.created.goto, "REVIEW_PLANS");
    assert.equal(f.steps.REVIEW_PLANS.forEach, "draftPlans()");
  });

  it("mission-driver: DRAFT_PLANS honest fail edge → done:failed", () => {
    const f = createMissionDriverFlow({ flowName: "mission-driver" });
    assert.deepEqual(f.steps.DRAFT_PLANS.transitions.fail, { done: "failed" });
  });

  it("deep-audit-loop: every draft/audit step has an honest fail edge → done:failed", () => {
    const f = subflow("deep-audit-loop");
    for (const s of ["CHECK_OPEN_AUDITS", "MULTI_AUDIT", "OPEN_AUDIT", "SCAN_NEW_RESULTS"]) {
      assert.deepEqual(f.steps[s].transitions.fail, { done: "failed" }, `${s} must fail honestly`);
    }
  });
});

describe("Phase4 — failure honesty (engine sim): fail is not laundered into nothing/completed", () => {
  it("DRAFT_PLANS emitting fail terminates the run as failed", async () => {
    const flow = createMissionDriverFlow({ flowName: "mission-driver" });
    flow.entry = "DRAFT_PLANS";
    const delegates = makeMockDelegates({
      async runAgent(stepName) {
        if (stepName === "DRAFT_PLANS") return { text: "<AI_STEP_RESULT>fail</AI_STEP_RESULT>", ok: true };
        return { text: "<AI_STEP_RESULT>ok</AI_STEP_RESULT>", ok: true };
      },
      config: { projectRoot: process.cwd() },
      expressionFuncs: { draftPlans: () => [], activePlans: () => [], openAudits: () => [] },
    });
    const result = await new FlowEngine(flow, delegates).run();
    assert.equal(result.status, "failed", "DRAFT_PLANS fail must end the run failed, not nothing/completed");
  });
});

describe("Phase4 — audit tri-state counting (E8 downstream): only `open` is counted", () => {
  it("_scanOpenAuditsList counts open, ignores triaged and clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "mdo-audits-"));
    const mk = (name, status) =>
      writeFileSync(join(dir, name), `> Audit Status: ${status}\n> Audit Type: multi-dimensional\n> Mission: m\n\nbody\n`);
    mk("t-open-multi-audit-m.md", "open");
    mk("t-triaged-multi-audit-m.md", "triaged");
    mk("t-clean-open-audit-m.md", "clean");

    const open = _scanOpenAuditsList(dir);
    assert.equal(open.length, 1, "only the `open` audit is counted");
    assert.match(open[0], /t-open-multi-audit-m\.md$/);
  });
});
