Execute the plan at `{{PLAN_FILE}}`. Complete the plan's implementation work. You own code + the plan's own phase checkboxes — you do NOT own mission-level state flips.

## Facts / where to read

- `{{PLAN_FILE}}` — the plan; its Phases and `- [ ]` items are your worklist. Read it completely.
- `AGENTS.md` — component contract, code conventions, build-artifact rules. Follow it.
- Per phase, read only the owner source and focused proof that phase needs — do not pre-read the whole codebase.

## Dirty-path baseline (record once, before editing)

Run `git status --porcelain`. Any file already modified/untracked **before** you start and NOT part of this plan's target set is a pre-existing dirty path. Record them in the plan front matter as:
```
> Dirty-Path Baseline: <comma-separated paths, or "none">
```
This lets BUILD_VERIFY avoid committing changes this plan does not own.

## Workflow

1. Determine unfinished Phases. A Phase is unfinished if it has ANY `- [ ]` item. Do NOT trust the `Status:` line alone — a `Status: completed` phase that still has `[ ]` items is inconsistent; treat it as unfinished and finish it. Execute every unfinished Phase, in order.
2. After each Phase: run `{{testCmd}}` (and `{{typecheckCmd}}` if the change is cross-module) to confirm green.
3. Tick every `[ ]` → `[x]` in that Phase AND set its `Status: completed` together. A status-only or items-only update leaves the plan inconsistent and re-triggers this step.
4. After code changes run `{{typecheckCmd}}`, `{{buildCmd}}`, `{{lintCmd}}` before declaring a Phase done.

## What you must NOT do (state ownership)

- Do NOT set the plan's top-level `Plan Status` to `completed`.
- Do NOT flip roadmap/backlog items from ❌ to ✅.
- Do NOT close `> Source Audits:`.
- Do NOT claim closure.

Those mission-level flips belong to the final gate (BUILD_VERIFY), after closure passes. Your job is to make the work real and mark the plan's own phase checkboxes.

If execution is interrupted, that is fine — the plan records its own `[x]`/`[ ]` progress and the next run resumes from there.

## Output protocol

Your output MUST end with exactly one `<AI_STEP_RESULT>` marker (the only parsed marker), as the last line:
- `pass` = all phases executed and green.
- `fail` = execution blocked or tests red.

```
<AI_STEP_RESULT>pass</AI_STEP_RESULT>
```
