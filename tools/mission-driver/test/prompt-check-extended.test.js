import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintPrompt, lintAllPrompts, FLOW_INJECTED_VARS } from "../src/prompt-check.mjs";

// Phase 3 (prompt-contract-optimization) — extended contract linter.
// Each new rule must flag its defect sample AND leave the real shipped prompts clean.

describe("prompt-check extended contract — defect samples flagged", () => {
  const dp = { markers: new Set(["created", "nothing", "fail"]), forEach: false };

  it("real shipped prompts all pass the extended linter", () => {
    assert.deepEqual(lintAllPrompts(), []);
  });

  it("created marker without FLOW_VARS/PLAN_FILE is flagged (E11)", () => {
    const errors = lintPrompt("draft.md", "<AI_STEP_RESULT>created</AI_STEP_RESULT>", dp);
    assert.ok(errors.some((e) => /must be accompanied by a <FLOW_VARS>/.test(e)), errors.join("\n"));
  });

  it("created marker BEFORE FLOW_VARS is flagged as wrong ordering (E10)", () => {
    const content = "<AI_STEP_RESULT>created</AI_STEP_RESULT>\n<FLOW_VARS><PLAN_FILE>x.md</PLAN_FILE></FLOW_VARS>";
    const errors = lintPrompt("draft.md", content, dp);
    assert.ok(errors.some((e) => /must appear BEFORE the 'created' marker/.test(e)), errors.join("\n"));
  });

  it("created marker WITH FLOW_VARS+PLAN_FILE first is accepted (E10)", () => {
    const content = "<FLOW_VARS>\n<PLAN_FILE>x.md</PLAN_FILE>\n</FLOW_VARS>\n<AI_STEP_RESULT>created</AI_STEP_RESULT>";
    assert.deepEqual(lintPrompt("draft.md", content, dp), []);
  });

  it("issues marker without REMAINING is flagged", () => {
    const ci = { markers: new Set(["approved", "issues"]), forEach: false };
    const errors = lintPrompt("closure-audit.md", "<AI_STEP_RESULT>issues</AI_STEP_RESULT>", ci);
    assert.ok(errors.some((e) => /must be accompanied by a <REMAINING>/.test(e)), errors.join("\n"));
  });

  it("project leakage (Maven -pl … -am, Jira, {timestamp}) is flagged by lintAllPrompts scan", () => {
    // white-box: the LEAK_PATTERNS drive lintFileLevel; assert via lintAllPrompts on
    // a crafted temp is heavy, so assert the allowlist + presence of the guard here
    // and rely on the shipped-prompts-clean test above for the integration signal.
    assert.ok(FLOW_INJECTED_VARS.has("roadmapPath"));
    assert.ok(!FLOW_INJECTED_VARS.has("backlogDir"),
      "backlogDir must NOT be in the flow-injected allowlist (E1: it is only injected on the draft/brief command path)");
  });

  it("positive leak samples are flagged (E7): Maven -pl…-am, Jira, {timestamp}", () => {
    const dir = mkdtempSync(join(tmpdir(), "mdo-leak-"));
    const promptsDir = join(dir, "prompts");
    mkdirSync(promptsDir);
    // A prompt not bound to any flow (no flow files present) so only the
    // all-prompt leakage scan applies. Each line trips a distinct LEAK_PATTERN.
    writeFileSync(join(promptsDir, "leaky.md"),
      "Run `mvn test -pl core -am`.\nUse the Jira key.\nCommit as plan-{timestamp}.\n");
    const errors = lintAllPrompts(dir);
    assert.ok(errors.some((e) => /Maven module-scoping/.test(e)), errors.join("\n"));
    assert.ok(errors.some((e) => /Jira-specific/.test(e)), errors.join("\n"));
    assert.ok(errors.some((e) => /\{timestamp\}/.test(e)), errors.join("\n"));
  });
});
