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
  it("plan-execution: two-step loop — EXECUTE routes to CLOSURE_VERIFY, no script step", () => {
    const f = subflow("plan-execution");
    assert.equal(f.steps.EXECUTE.transitions.pass.goto, "CLOSURE_VERIFY");
    assert.equal(Object.keys(f.steps).length, 2, "flow is exactly EXECUTE + CLOSURE_VERIFY");
    assert.ok(!f.steps.CLOSURE_SCRIPT_CHECK, "script gate removed from the loop");
  });

  it("plan-execution: CLOSURE_VERIFY feedback returns to EXECUTE; 3-round cap then honest fail", () => {
    const f = subflow("plan-execution");
    const issues = f.steps.CLOSURE_VERIFY.transitions.issues;
    assert.equal(issues.retry, "EXECUTE");
    assert.equal(issues.maxRetries, 2, "initial round + 2 feedback rounds = 3 EXECUTE→CV cycles max");
    assert.equal(issues.append.extract, "REMAINING", "findings are fed back to EXECUTE");
    assert.deepEqual(f.steps.CLOSURE_VERIFY.onMaxRetries, { done: "failed" });
  });

  it("plan-execution: blocked marker parks the plan from both steps (no retry loop)", () => {
    const f = subflow("plan-execution");
    assert.deepEqual(f.steps.EXECUTE.transitions.blocked, { done: "blocked" });
    assert.deepEqual(f.steps.CLOSURE_VERIFY.transitions.blocked, { done: "blocked" });
  });

  it("plan-execution: both agent steps carry a wall-clock timeoutMs (stall watchdog)", () => {
    const f = subflow("plan-execution");
    assert.ok(f.steps.EXECUTE.timeoutMs > 0, "EXECUTE timeoutMs set");
    assert.ok(f.steps.CLOSURE_VERIFY.timeoutMs > 0, "CLOSURE_VERIFY timeoutMs set");
  });

  it("mission-driver: EXEC_PLANS routes blocked aggregates onward (mission continues)", () => {
    const f = createMissionDriverFlow({ flowName: "mission-driver" });
    assert.equal(f.steps.EXEC_PLANS.transitions.some_blocked.goto, "DRAFT_PLANS");
    assert.equal(f.steps.EXEC_PLANS.transitions.all_blocked.goto, "DRAFT_PLANS");
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

describe("blocked marker — parked plans aggregate honestly, mission continues", () => {
  it("all-blocked EXEC_PLANS aggregates to all_blocked (not failed)", async () => {
    const flow = createMissionDriverFlow({ flowName: "mission-driver" });
    // Stub plan-execution: EXECUTE parks every plan with the blocked marker.
    const stubPlanExec = {
      name: "stub-plan-exec", entry: "EXECUTE", maxTotalSteps: 5,
      steps: {
        EXECUTE: {
          type: "agent", prompt: "execute stub",
          transitions: { blocked: { done: "blocked" } },
        },
      },
    };
    const delegates = makeMockDelegates({
      responses: { EXECUTE: "<AI_STEP_RESULT>blocked</AI_STEP_RESULT>" },
      config: { projectRoot: process.cwd() },
      expressionFuncs: { activePlans: () => ["plan-a.md", "plan-b.md"], draftPlans: () => [], openAudits: () => [] },
      loadSubFlow() { return stubPlanExec; },
    });
    const engine = new FlowEngine(flow, delegates);
    const result = await engine._executeSubflowStep("EXEC_PLANS", flow.steps.EXEC_PLANS);
    assert.equal(result.marker, "all_blocked", "2 parked plans → all_blocked, never all_failed");
    assert.equal(result.ok, true, "parked plans are progress, not failure");
    assert.ok(result.subflowRuns.every((r) => r.status === "blocked"), "each item recorded as blocked");
  });

  it("mixed completed+blocked aggregates to some_blocked (failures still win when present)", async () => {
    const flow = createMissionDriverFlow({ flowName: "mission-driver" });
    let call = 0;
    const stubPlanExec = {
      name: "stub-plan-exec", entry: "EXECUTE", maxTotalSteps: 5,
      steps: {
        EXECUTE: {
          type: "agent", prompt: "execute stub",
          transitions: {
            pass: { done: "completed" },
            blocked: { done: "blocked" },
            fail: { done: "failed" },
          },
        },
      },
    };
    const delegates = makeMockDelegates({
      async runAgent(stepName) {
        if (stepName === "EXECUTE") {
          call++;
          const marker = call === 1 ? "pass" : call === 2 ? "blocked" : "fail";
          return { text: `<AI_STEP_RESULT>${marker}</AI_STEP_RESULT>`, ok: true };
        }
        return { text: "<AI_STEP_RESULT>ok</AI_STEP_RESULT>", ok: true };
      },
      config: { projectRoot: process.cwd() },
      expressionFuncs: { activePlans: () => ["p1.md", "p2.md", "p3.md"], draftPlans: () => [], openAudits: () => [] },
      loadSubFlow() { return stubPlanExec; },
    });
    const engine = new FlowEngine(flow, delegates);
    const mixed = await engine._executeSubflowStep("EXEC_PLANS", flow.steps.EXEC_PLANS);
    assert.equal(mixed.marker, "some_failed", "a real failure outranks parked plans in the aggregate");

    // Now without the failure: completed + blocked → some_blocked
    call = 0;
    const delegates2 = makeMockDelegates({
      async runAgent(stepName) {
        if (stepName === "EXECUTE") {
          call++;
          const marker = call === 1 ? "pass" : "blocked";
          return { text: `<AI_STEP_RESULT>${marker}</AI_STEP_RESULT>`, ok: true };
        }
        return { text: "<AI_STEP_RESULT>ok</AI_STEP_RESULT>", ok: true };
      },
      config: { projectRoot: process.cwd() },
      expressionFuncs: { activePlans: () => ["p1.md", "p2.md"], draftPlans: () => [], openAudits: () => [] },
      loadSubFlow() { return stubPlanExec; },
    });
    const engine2 = new FlowEngine(flow, delegates2);
    const parked = await engine2._executeSubflowStep("EXEC_PLANS", flow.steps.EXEC_PLANS);
    assert.equal(parked.marker, "some_blocked", "completed + parked → some_blocked");
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
