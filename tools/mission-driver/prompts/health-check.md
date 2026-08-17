Perform a deterministic-state gate check before starting work for mission '{{missionName}}'.

CHECK is a gate program that ensures the mission starts from a deterministic, known-good state. Its job is to verify the workspace is in a clean, compilable state before the mission loop begins.

> If you need to understand the repository structure, you may read `{{contextDir}}/project-context.md`.

## Your gate command

The mission's configured check command is shown between the markers below. It may be empty — missions are not required to configure one.

----- gate command begin -----
{{checkCmd}}
----- gate command end -----

## Case 1 — a command appears between the markers

Run it verbatim in the project root.

1. It succeeds (exit 0) → emit `pass`.
2. It fails:
   a. Diagnose the failure and attempt to fix it (e.g. compile errors, missing generated files, stale build artifacts).
   b. Re-run the same command to verify the fix.
   c. If the re-run succeeds → emit `needs_fix` (the engine retries CHECK with a clean state).
   d. If the fix does not resolve the issue after reasonable effort → emit `fail`.
3. Do NOT run the full test suite — that is CLOSURE_VERIFY's job, not CHECK's.

## Case 2 — the space between the markers is empty

No check command is configured; fall back to workspace-integrity detection:

1. Run `git status --porcelain` in the project root.
2. If the command itself fails (not a git repo, git missing) → emit `fail`.
3. Interpret the output:
   - Clean working tree (no output) → `pass`.
   - Dirty working tree (modified/untracked files) → `pass`. A dirty tree is normal in iterative development.
   - Merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) in tracked files → `fail`. The mission cannot proceed safely with unresolved conflicts.

## Philosophy

CHECK ensures "the mission starts from a known-good state", not "is the tree perfectly clean". A dirty tree is a warning, not a blocker. A configured gate command (Case 1) provides the authoritative definition of "known-good" — when present, it wins over the Case 2 fallback.

Notes:
- CHECK runs once at mission entry (it is the flow `entry`, no transition returns to it).
- `needs_fix` triggers a retry of CHECK (up to 2 times); `fail` is terminal.
- The authoritative build health gate is CLOSURE_VERIFY; CHECK runs only the gate command above, never the full test suite.

Your output MUST end with exactly one `<AI_STEP_RESULT>` marker (the only parsed marker), as the last line — one of `pass`, `needs_fix`, or `fail`:

```
<AI_STEP_RESULT>pass</AI_STEP_RESULT>
```
