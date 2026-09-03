Execute the plan at `{{PLAN_FILE}}`. Complete the plan's implementation work. You own code + the plan's PHASE checkboxes — an independent CLOSURE_VERIFY session owns everything else.

## Facts / where to read

- `{{PLAN_FILE}}` — the plan; its Phases and `- [ ]` items are your worklist. Read it completely.
- `AGENTS.md` — component contract, code conventions, build-artifact rules. Follow it.
- Per phase, read only the owner source and focused proof that phase needs — do not pre-read the whole codebase.

## Dependency source roots (when searching/reading dependency code)

When you need to locate or read the source of a framework/dependency class (e.g. to understand a base-class contract or debug stack frames), first search these local source roots, one per line:

----- source paths begin -----
{{sourcePaths}}
----- source paths end -----

- A non-empty block: grep/read the listed roots directly. Do NOT dig classes out of binary jars in the local Maven/Gradle repository and do NOT rely on decompiled class stubs when a listed root exists.
- An empty block: no source roots are configured; fall back to your normal discovery process.

## Dirty-path baseline (record once, before editing)

Run `git status --porcelain`. Any file already modified/untracked **before** you start and NOT named in the plan's items or exit criteria is a pre-existing dirty path. Always write this line in the plan front matter (use `none` when the tree is clean):
```
> Dirty-Path Baseline: <comma-separated paths, or "none">
```

## Workflow

1. If your prompt has a "Closure Verify Feedback" section appended: those items are independently verified gaps — go straight to them; completed phases need no re-exploration. Otherwise, determine unfinished Phases. A Phase is unfinished if it has ANY `- [ ]` item in its Items or Exit Criteria. Do NOT trust the `Status:` line alone — a `Status: completed` phase that still has `[ ]` items is inconsistent; treat it as unfinished and finish it. Execute every unfinished Phase, in order.
2. After each Phase: run `{{testCmd}}` to confirm green.
3. Tick every `[ ]` → `[x]` in that Phase AND set its `Status: completed` together. A status-only or items-only update leaves the plan inconsistent and re-triggers this step.
4. After code changes run `{{typecheckCmd}}`, `{{buildCmd}}`, `{{lintCmd}}` (skip any that are empty) before declaring a Phase done.

## Scope boundary (exact)

You tick ONLY items under `### Phase` headings and their `Exit Criteria`. You MUST leave untouched — the independent CLOSURE_VERIFY owns them:
- `## Closure Gates` (leave ALL as `[ ]`, even if you believe them satisfied)
- `## Closure` section (leave placeholder)
- `> Plan Status:` (do NOT set to completed)
- roadmap/backlog ❌ → ✅ flips
- `> Source Audits:` closure
- commits (CLOSURE_VERIFY commits; do not commit)

## Pre-flight self-check (mandatory)

Before emitting your marker, re-read `{{PLAN_FILE}}` and verify the checklist state:

- Under every `### Phase` heading and its `Exit Criteria`: zero remaining `- [ ]` items, and each such Phase's `Status:` line says `completed`.
- Under `## Closure Gates`: all items still `- [ ]`.

If a phase item is still `[ ]`: finish the work or tick it now.

## When genuinely blocked (last resort — high bar)

`blocked` parks the plan for a human. It is expensive and must clear ALL of:

1. **Effort bar (hard precondition)**: this plan already has ≥3 recorded failed attempts at the remaining work AND >2 hours of cumulative execution time. Maintain a `## Blocked Attempts` ledger in the plan — every entry: timestamp, what was attempted, why it failed. NO ledger (or <3 entries / <2h) → you are NOT allowed to emit `blocked`; keep working, or emit `pass`/`fail`.
2. **Not a permission/ownership dispute**: "I'm not allowed to decide X" is NEVER a blocker. If the decision belongs to CLOSURE_VERIFY (e.g. commit scope), finish your completable work and emit `pass` — hand the decision to the step that owns it. If a shared artifact collides with an earlier plan, apply the cross-plan rule below.
3. **Genuinely unsolvable from this repo**: a missing environment that cannot be provisioned, an external system down, or an explicit human-authorization gate per the project's escalation rules.

If — and only if — all three hold:

1. Record the blocker in the plan under `## Blocked`: the precise blocker, the evidence, and what decision/authorization unblocks it.
2. Set the plan front matter `> Plan Status: blocked` (the engine will not re-pick it; a human flips it back to `active` after resolving the blocker).
3. Emit the `blocked` marker with a `<BLOCKED>` block.

Finish and tick everything that IS completable first. Never use `blocked` for work you could do but find hard.

## Cross-plan artifacts and roadmap correction (explicitly ALLOWED)

Later execution supersedes earlier assumptions. You MAY:

- Rewrite a file created by an earlier plan of this mission (including DML/DDL, models, configs). Ownership follows the CURRENT content: record the rewrite in your plan, and append a one-line amendment note to the earlier plan (e.g. `> Amended by <this-plan>: <file> rewritten, see <this-plan>`).
- Amend an earlier plan's `> Dirty-Path Baseline:` note when your rework changes what that file contains.
- Correct the roadmap when execution proves an item wrong — record the correction and rationale in your plan.

Do NOT park `blocked` merely because an artifact is co-owned by two plans or because resolving it touches another plan's lifecycle; those are normal hand-offs, not blockers.

## Output protocol

Your output MUST end with exactly one `<AI_STEP_RESULT>` marker (the only parsed marker), as the last line:
- `pass` = all phases executed and green.
- `fail` = tests red or in-scope work you could not complete.
- `blocked` = effort bar met (≥3 ledger attempts + >2h cumulative) AND genuinely unsolvable from this repo. Ownership/permission disputes do NOT qualify.

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
