Execute the plan at `{{PLAN_FILE}}`. Complete the plan's implementation work. You own code + the plan's PHASE checkboxes — an independent CLOSURE_VERIFY session owns everything else.

## Facts / where to read

- `{{PLAN_FILE}}` — the plan; its Phases and `- [ ]` items are your worklist. Read it completely.
- `AGENTS.md` — component contract, code conventions, build-artifact rules. Follow it.
- Per phase, read only the owner source and focused proof that phase needs — do not pre-read the whole codebase.

## Dirty-path baseline (record once, before editing)

Run `git status --porcelain`. Any file already modified/untracked **before** you start and NOT part of this plan's target set is a pre-existing dirty path. Record them in the plan front matter as:
```
> Dirty-Path Baseline: <comma-separated paths, or "none">
```
This lets CLOSURE_VERIFY avoid committing changes this plan does not own.

## Workflow

1. If your prompt has a "Closure Verify Feedback" section appended: those items are independently verified gaps — go straight to them; completed phases need no re-exploration. Otherwise, determine unfinished Phases. A Phase is unfinished if it has ANY `- [ ]` item in its Items or Exit Criteria. Do NOT trust the `Status:` line alone — a `Status: completed` phase that still has `[ ]` items is inconsistent; treat it as unfinished and finish it. Execute every unfinished Phase, in order.
2. After each Phase: run `{{testCmd}}` (and `{{typecheckCmd}}` if the change is cross-module) to confirm green.
3. Tick every `[ ]` → `[x]` in that Phase AND set its `Status: completed` together. A status-only or items-only update leaves the plan inconsistent and re-triggers this step.
4. After code changes run `{{typecheckCmd}}`, `{{buildCmd}}`, `{{lintCmd}}` before declaring a Phase done.

## Scope boundary (exact)

You tick ONLY items under `### Phase` headings and their `Exit Criteria`. You MUST leave untouched — the independent CLOSURE_VERIFY owns them:
- `## Closure Gates` (leave ALL as `[ ]`, even if you believe them satisfied)
- `## Closure` section (leave placeholder)
- `> Plan Status:` (do NOT set to completed)
- roadmap/backlog ❌ → ✅ flips
- `> Source Audits:` closure
- commits (CLOSURE_VERIFY commits; do not commit)

Leaving gates unticked is the DESIGNED handoff, not unfinished work. The next step is a fresh CLOSURE_VERIFY session that verifies your work and owns all closure state.

## Pre-flight self-check (mandatory; saves a retry round)

Before emitting your marker, run from the project root:
```
node tools/mission-driver/src/plan-check.mjs {{PLAN_FILE}}
```
Expected: `phaseUnchecked: 0` (closure gates unticked is CORRECT at your stage). If it reports unchecked phase items: finish the work or fix your ticks now — do not emit pass and let the verifier bounce you.

## When genuinely blocked (cross-module / needs human authorization)

If — and only if — the remaining work is blocked by something OUTSIDE this plan's scope (a cross-module platform defect, a shared-contract change, a missing environment that cannot be provisioned from this repo, or an explicit human-authorization gate per the project's escalation rules), do NOT burn retries on it:

1. Record the blocker in the plan: under `## Deferred But Adjudicated` (or a `## Blocked` note), name the precise blocker, the evidence, and what decision/authorization unblocks it.
2. Set the plan front matter `> Plan Status: blocked` (this parks the plan — the engine will not re-pick it; a human flips it back to `active` after resolving the blocker).
3. Emit the `blocked` marker with a `<BLOCKED>` block.

Being blocked is NOT failure: finish and tick everything that IS completable first. Never use `blocked` for work you could do but find hard.

## Output protocol

Your output MUST end with exactly one `<AI_STEP_RESULT>` marker (the only parsed marker), as the last line:
- `pass` = all phases executed and green.
- `fail` = execution blocked or tests red.
- `blocked` = genuinely blocked by an out-of-scope cross-module/environment issue; plan parked with `> Plan Status: blocked`.

```
<AI_STEP_RESULT>pass</AI_STEP_RESULT>
```

Blocked (parks the plan; mission continues without it):
```
<BLOCKED>
<item>the precise out-of-scope blocker and the evidence</item>
<item>what decision/authorization unblocks it</item>
</BLOCKED>
<AI_STEP_RESULT>blocked</AI_STEP_RESULT>
```
