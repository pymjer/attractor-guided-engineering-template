import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SCRIPT_REGISTRY } from "../src/flow-loader.js";

// Phase 1 (prompt-contract-optimization) — closureScriptCheck honesty guard.
// On an exception (e.g. the plan file cannot be read), the check MUST still
// populate SCRIPT_CHECK_RESULT / SCRIPT_CHECK_DETAILS so the downstream
// closure-audit prompt never interpolates an unresolved {{SCRIPT_CHECK_RESULT}}
// placeholder. It must also return the honest `fail` marker.
describe("closure-script-check — exception path sets SCRIPT_CHECK vars (no residual template var)", () => {
  function makeFlowVars(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
      get: (k) => store.get(k),
      set: (k, v) => store.set(k, v),
      _store: store,
    };
  }

  it("missing/unreadable plan file → marker fail AND SCRIPT_CHECK_RESULT=FAIL with details", async () => {
    const run = SCRIPT_REGISTRY["closure-script-check"];
    const flowVars = makeFlowVars({ PLAN_FILE: "does/not/exist/plan.md" });
    const delegates = { config: { projectRoot: "/nonexistent-root-xyz" } };

    const res = await run(delegates, flowVars);

    assert.equal(res.marker, "fail", "exception must yield honest fail marker");
    assert.equal(flowVars.get("SCRIPT_CHECK_RESULT"), "FAIL",
      "SCRIPT_CHECK_RESULT must be set to FAIL on exception (no unresolved placeholder)");
    const details = flowVars.get("SCRIPT_CHECK_DETAILS");
    assert.ok(details && details.length > 0,
      "SCRIPT_CHECK_DETAILS must carry the error reason");
  });

  it("no PLAN_FILE → honest fail (guard path)", async () => {
    const run = SCRIPT_REGISTRY["closure-script-check"];
    const flowVars = makeFlowVars({});
    const res = await run({ config: {} }, flowVars);
    assert.equal(res.marker, "fail");
  });
});
