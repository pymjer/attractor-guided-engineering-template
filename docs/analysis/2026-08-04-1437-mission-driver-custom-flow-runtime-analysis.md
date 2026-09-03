# Mission-Driver Custom Flow Runtime Analysis And Optimization Proposal

> Analysis date: 2026-08-04
> Evidence run: `C:/Work/cardlite-acq-feature-test/_tmp/2026-08-04-130201-mission-driver/`
> Mission: `docs-for-ai-remediation`
> Engine source: `tools/mission-driver/`
> Nature: analysis and optimization proposal only; no engine implementation in this document

## Executive Summary

The custom flow override **did take effect** in the inspected run.

The evidence is conclusive:

- Main run state records `flowName: docs-for-ai-remediation` in
  `run-state.json:2-4`.
- Child run state records
  `flowName: docs-for-ai-remediation-plan-execution` in
  `run-state-EXEC_PLANS-2-0.json:2-4`.
- Captured prompts match the mission-specific prompt set rather than the shared
  `missions/prompts/` or built-in prompt text. Examples:
  `oc-DRAFT_PLANS-*.log.prompt`, `oc-EXECUTE-*.log.prompt`, and
  `oc-CLOSURE_AUDIT-*.log.prompt`.

`CLOSURE_SCRIPT_CHECK` ran because the **custom plan-execution flow explicitly
contains it**:

```text
EXECUTE -> CLOSURE_SCRIPT_CHECK -> CLOSURE_AUDIT -> BUILD_VERIFY
```

The definition is in the target project's
`missions/flows/docs-for-ai-remediation-plan-execution.json:15-40`. This was not
fallback to the built-in flow and was not dynamically inserted by the engine.

The confusion is nevertheless legitimate because mission-driver currently does
not provide a trustworthy preflight/effective-config view:

- `list-steps` always reads the built-in top-level `mission-driver.json`.
- startup logs do not print the selected flow file or prompt source files.
- `mission-check` validates only shallow mission fields and path existence, not
  the recursively resolved flow graph.
- run state persists names but not source paths or content digests.

The run also exposed several engine-level defects with broader impact:

1. parent mission limits override child-flow limits;
2. `maxInnerCycles` is parsed but never consumed;
3. `maxAuditRounds` is flow-owned only and quota exhaustion reports success;
4. built-in plan execution can bypass semantic closure audit;
5. closure state is persisted before final build verification;
6. failed child plans are allowed to fall through to ordinary drafting;
7. audit/plan terminal predicates can ignore held drafts and unresolved audit
   ownership;
8. clean/audit agent failures can be mistaken for successful audit completion;
9. repeated audit rounds can overwrite the same audit files;
10. config precedence, validation, monitor resolution, and prompt linting are not
    based on one effective configuration model.

The recommended direction is to introduce a side-effect-free **effective-config
preflight**, establish explicit configuration ownership and precedence, and
replace distributed closure mutations with an atomic `FINALIZE` step after all
verification succeeds.

## 1. Evidence And Run Reconstruction

### 1.1 Custom main flow loaded

The mission specifies:

```json
"flowName": "docs-for-ai-remediation"
```

Runtime evidence:

- `run-state.json:3` = `docs-for-ai-remediation`.
- `events.jsonl:1-19` consistently identifies the same flow.
- The observed top-level sequence is:
  `CHECK -> REVIEW_PLANS -> EXEC_PLANS -> DRAFT_PLANS -> REVIEW_PLANS -> EXEC_PLANS`.
- This matches the custom main flow, including its custom subflow name.

### 1.2 Custom plan-execution subflow loaded

Runtime evidence:

- `run-state-EXEC_PLANS-2-0.json:3` =
  `docs-for-ai-remediation-plan-execution`.
- `events.jsonl:20` starts that exact child flow.
- The first plan executed:
  `EXECUTE -> CLOSURE_SCRIPT_CHECK -> CLOSURE_AUDIT -> BUILD_VERIFY`.
- The second plan followed the same sequence at `events.jsonl:50-68`.

Therefore, the plan-execution override mechanism worked as designed.

### 1.3 Mission-specific prompts loaded

The mission sets:

```json
"promptsDir": "missions/prompt-sets/docs-for-ai-remediation"
```

Captured prompt evidence:

- `oc-DRAFT_PLANS-1785819778407-t5vwga.log.prompt:1` starts with
  `# Draft The Next Remediation Plan`.
- `oc-EXECUTE-1785820611467-lgkfi1.log.prompt:1` starts with
  `# Execute One Canonical Remediation Plan`.
- `oc-CLOSURE_AUDIT-1785821951397-02kcsf.log.prompt:1` starts with
  `# Independent Semantic Closure Audit`.

These titles and bodies match the mission prompt set. Prompt override is
effective for both the main flow and loaded subflows.

### 1.4 Why `CLOSURE_SCRIPT_CHECK` ran

The custom plan-execution flow says:

```json
"EXECUTE": {
  "transitions": {
    "pass": { "goto": "CLOSURE_SCRIPT_CHECK" }
  }
},
"CLOSURE_SCRIPT_CHECK": {
  "type": "script",
  "scriptId": "closure-script-check",
  "transitions": {
    "pass": { "goto": "CLOSURE_AUDIT" },
    "fail": { "goto": "CLOSURE_AUDIT" }
  }
}
```

The run followed exactly that transition:

- plan 1: `events.jsonl:26-31`;
- plan 2: `events.jsonl:56-61`.

Conclusion: this is a custom-flow definition issue or expectation mismatch, not
an override-loading failure.

### 1.5 Run health and cost shape

At the inspected cutoff, two roadmap plans had completed and the third draft was
starting. The first plan subflow took about 32m53s; the second took about 34m50s.
No provider timeout, rate-limit, OOM, or disk-pressure failure was observed.

Systematic signals:

- both closure-script checks failed;
- both closure-script checks failed on intentionally open audit gates; both
  independent auditors then performed semantic review, corrected/closed the
  gates, reran checks, and returned `approved`;
- all `EXEC_PLANS` visits logged a false unresolved `{{forEachItem}}` warning;
- child runs reported parent budgets, not their declared child-flow budgets.

## 2. Findings

### F1. No Effective-Configuration Preflight Or Provenance

**Severity:** P0 usability / P1 correctness risk

#### Evidence

- Runtime resolves the main flow from project flows before built-ins:
  `src/flow-loader.js:295-308`.
- Runtime resolves subflows from project flows before built-ins:
  `src/flow-loader.js:311-333`.
- Runtime resolves prompts in this order:
  mission `promptsDir` -> shared `missions/prompts/` -> built-in prompts:
  `src/flow-loader.js:239-252,311-321`.
- `loadFlowFile` and `loadPrompt` return parsed content/text but discard selected
  source paths: `src/flow-loader.js:239-284`.
- startup prints mission metadata but not flow/prompt provenance:
  `src/main.js:630-643`.

#### Impact

Before execution, users cannot prove:

- which exact main flow file was loaded;
- which exact subflow files will load later;
- whether a prompt came from mission, shared project, or built-in fallback;
- whether a script ID is resolvable;
- what effective limits will apply to parent and child flows.

This made expected custom behavior indistinguishable from fallback behavior until
after the child flow ran.

#### Recommendation

Add a side-effect-free command:

```bash
mission-driver preflight <mission>
mission-driver preflight <mission> --json
```

It should recursively resolve and report:

- fully merged mission config with field provenance;
- main flow and all transitive subflow source paths;
- every prompt source path and precedence tier;
- every script ID and implementation source;
- entry, steps, transitions, marker aliases, limits, skip settings;
- SHA-256 for each flow/prompt and a deterministic whole-config digest.

Persist the same result as `_tmp/<run>/effective-config.json`; reference its
digest from `run-state.json` and the first `run_started` event.

Optional safety:

```bash
mission-driver run <mission> --expect-config-sha <sha256>
```

This fails before side effects if flow/prompt/config changed after review.

### F2. `list-steps` Is Incorrect For Custom Flows

**Severity:** P1

#### Evidence

`getTopSteps()` hardcodes the built-in flow:

- `src/main.js:68-72` reads
  `tools/mission-driver/flows/mission-driver.json`.
- `cmdListSteps()` uses this fixed list at `src/main.js:136-150`.
- invalid `--step` / `--from-step` diagnostics repeat the fixed list at
  `src/main.js:726-746`.

It does not load `mission.flowName` or project flow overrides.

#### Impact

`list-steps docs-for-ai-remediation` can appear successful while proving nothing
about the selected custom flow. It also lists only top-level built-in step names,
so it cannot reveal that a custom child flow contains `CLOSURE_SCRIPT_CHECK`.

#### Recommendation

- resolve the effective mission and main flow before listing;
- print flow source path and entry;
- add `--all` or `--tree` to recursively display subflows and child steps;
- include step type and selected prompt/script source;
- use the effective list in invalid-step diagnostics.

Example:

```text
Flow: missions/flows/docs-for-ai-remediation.json
CHECK [agent] -> prompt-sets/.../health-check.md
EXEC_PLANS [subflow] -> missions/flows/docs-for-ai-remediation-plan-execution.json
  EXECUTE [agent]
  CLOSURE_SCRIPT_CHECK [script: closure-script-check]
  CLOSURE_AUDIT [agent]
  BUILD_VERIFY [agent]
```

### F3. Mission Validation Does Not Validate The Flow Graph

**Severity:** P1

#### Evidence

`mission-check.mjs` validates only:

- required fields;
- `commands.test` presence;
- existence of roadmap/plans/context/module/prompts directories.

See `src/mission-check.mjs:13-14,58-87`.

It does not validate:

- `flowName` existence;
- flow JSON schema;
- entry existence;
- transition targets;
- marker compatibility;
- recursive subflows;
- prompt existence;
- script IDs;
- known mission fields or types.

Subflows are loaded lazily only when reached: `src/engine.js:1045-1048`.

#### Impact

A mission can pass `mission-check` and fail after creating a run directory,
printing startup metadata, and starting Monitor. An unreachable broken subflow
can evade even a normal dry-run.

#### Recommendation

Make preflight the shared implementation behind mission validation. At minimum,
recursive graph validation must reject:

- missing flow/subflow;
- invalid JSON/schema;
- missing or invalid entry;
- dangling `goto`/`retry` targets;
- unknown step type;
- unknown `scriptId`;
- missing prompt;
- invalid marker contracts;
- unresolved required template variables.

Run this before creating `_tmp` or starting Monitor.

### F4. Limit Scope Contract Is Incomplete And `maxInnerCycles` Is Dead

**Severity:** P1 contract/design defect

#### Evidence

The custom plan subflow declares:

- `maxTotalSteps: 40`;
- `maxCycleVisits: 8`.

The runtime child event reports:

- `maxTotalSteps: 500`;
- `maxCycleVisits: 60`.

See evidence run `events.jsonl:20` and `events.jsonl:50`.

Root cause:

- `_runChildSubflow` copies the full parent config:
  `src/engine.js:1187-1199`.
- every engine prefers config values over its own flow values:
  `src/engine.js:1434-1441`.

Therefore, mission/CLI parent limits overwrite all child-flow limits. This is
currently documented behavior, not an accidental regression: `README.md:72-86`
explicitly says `--max-cycles` overrides all three flows. The contract problem is
that each flow still advertises a local default and config exposes a separate
`maxInnerCycles`, while runtime offers no independent child limit once the
parent override is set.

#### Additional defect: `maxInnerCycles` is dead

`maxInnerCycles` is parsed and returned:

- `src/config.js:468-470,601-603,676-678`;

but no engine code consumes it. Documentation presents it as a real field in
base config, creating a false configuration surface.

#### Recommendation

Define separate scopes:

- `limits.run.maxTotalSteps` - shared global mission budget;
- `limits.main.maxCycleVisits` - top-level flow visits;
- `limits.subflow.maxCycleVisits` - default child limit;
- optional per-flow JSON values as local defaults;
- optional CLI overrides with explicit scope.

One backward-compatible option is:

- parent engine may use `config.maxCycles`;
- child engine should use `config.maxInnerCycles ?? flow.maxCycleVisits`;
- child engine should use its own `flow.maxTotalSteps`, unless a true global
  shared counter is implemented.

If `maxTotalSteps` is intended globally, implement one shared counter across all
engines rather than giving every child the same independent allowance.

### F5. Audit Budget Is Flow-Owned, While Quota Completion Is Unsafe

**Severity:** P0/P1

#### Ownership and validation boundary

The engine reads audit budget only from the flow:

```js
const maxAuditRounds = this.flow.maxAuditRounds ?? 0;
```

See `src/engine.js:1441`.

Flow ownership is intentional in the current implementation. Mission-level
support would be a new contract. The validation defect is that a mission-level
`maxAuditRounds` field is accepted as unknown configuration but has no effect,
so an unsupported override looks valid instead of being rejected.

#### Unconditional success on quota exhaustion

At `src/engine.js:1531-1535`, reaching the audit quota returns `completed`
without checking:

- roadmap completion;
- active/draft/held/failed plans;
- open/planned audits;
- last audit result;
- successful final verification.

Existing tests explicitly allow completion with open audits in quota cases.

#### Ping-pong mutation

The engine silently increases effective ping-pong window based on audit budget:
`src/engine.js:1443-1447`. A declared `pingPongWindow: 10` with
`maxAuditRounds: 100` effectively becomes at least 202, but that effective value
is not surfaced.

#### Recommendation

- Either keep flow-only ownership and reject mission-level audit fields, or add
  an explicit precedence such as CLI/runtime override -> mission override -> flow
  default. Do not accept an ignored field.
- Persist declared and effective values separately.
- Validate topology compatibility, for example repeated-step capacity must be
  sufficient for requested audit rounds.
- Change quota result from `completed` to `audit_exhausted` unless a full
  completion predicate is true.
- Do not silently mutate ping-pong limits; either reject incompatibility or print
  both declared and effective values in preflight.

Recommended completion predicate:

```text
roadmap all done
AND no draft/held/active/executing/failed plans
AND no open/planned/unowned audits
AND at least one complete clean audit round
AND all configured audit reports exist
AND final verification ledger is green
```

### F6. Closure Lifecycle Is Not Atomic

**Severity:** P0

#### Evidence from the run

For both plans:

1. executor set `Plan Status: completed` while audit-only checkboxes remained
   unchecked;
2. `CLOSURE_SCRIPT_CHECK` failed;
3. the independent auditor treated the remaining audit gate as expected,
   performed semantic verification, corrected closure records, checked the
   gate, reran validation, and then returned `approved`;
4. `BUILD_VERIFY` ran afterward.

Plan 1 script output:

```text
Plan closure check FAILED.
status: completed
1 unchecked items remain
```

The auditors added real value; plan 1's auditor corrected an incorrect GAP count
before approval. The defect is a lifecycle/checker mismatch, not approval
without review: the custom execute prompt asks for `completed` before closure
audit, while the controlling plan guide says `completed` means independent
closure audit accepted. This guarantees a structure-check failure whenever the
independent-audit gate is correctly left unchecked.

#### Built-in flow has a separate serious defect

Built-in `flows/plan-execution.json` routes a successful script check directly to
`BUILD_VERIFY`; semantic `CLOSURE_AUDIT` runs only when script check fails. Thus a
structurally passing plan can bypass independent semantic closure entirely.

Two built-in retry-exhaustion transitions are also fail-open:

- exhausted `EXECUTE` retries go to `CLOSURE_SCRIPT_CHECK` instead of failing:
  `flows/plan-execution.json:25`;
- exhausted closure-audit retries go to `BUILD_VERIFY` instead of failing:
  `flows/plan-execution.json:53`.

The script itself uses `inspectPlan(..., { strict: false })` and checks only a
small subset of closure conditions: `src/flow-loader.js:191-229`.

#### Premature persistent state

Both built-in/custom patterns allow plan, roadmap, and audit status mutation
before final build verification. If `BUILD_VERIFY` later fails permanently, disk
state may already claim completion.

#### Recommendation: read-only verification plus explicit finalization phase

Use this state machine:

```text
draft
  -> held | active
  -> executing
  -> closure_pending
  -> closure_approved
  -> verified
  -> FINALIZE
  -> completed
```

Execution flow:

```text
EXECUTE
  -> PLAN_CHECK_STRICT
  -> CLOSURE_AUDIT
  -> BUILD_VERIFY
  -> FINALIZE (deterministic script)
```

Only `FINALIZE` may atomically:

- set Plan Status to `completed`;
- set roadmap item to `done`;
- close source audits;
- write final verification ledger/evidence.

Any failure before FINALIZE leaves the plan non-terminal and resumable.

This ordering is valid only if `BUILD_VERIFY` is read-only. The current built-in
prompt may diagnose and modify files, update logs, and commit after closure
audit. If verification changes an audited file, rerun closure audit on the final
diff or split repair from read-only verification. Multi-file FINALIZE is not a
true filesystem transaction; use a journal/idempotency record and recovery logic.

### F7. Fault-Tolerant Child Failure Policy Can Delay Or Obscure Failure

**Severity:** P1 policy risk

Both built-in and custom main flows route:

- `all_complete` -> drafting;
- `some_failed` -> drafting;
- `all_failed` -> drafting.

This continuation is intentional: `design/mission-driver-flow-design.md:22`
defines fault-tolerant fallback. A failed plan normally remains active and can
be rediscovered by a later `EXEC_PLANS` visit.

#### Impact

The risk is ordering and visibility: the engine may draft new work before
retrying failed active plans, and agent-side premature roadmap/audit mutations
can obscure retry ownership.

#### Recommendation

- make strict vs tolerant behavior explicit per mission;
- strict mode: `some_failed` -> `BLOCKED`, `all_failed` -> mission `failed`;
- tolerant mode: retry failed active plans before drafting new roadmap work;
- persist failed plan identities and reasons;
- never allow terminal roadmap/audit state to hide failed-plan ownership.

### F8. Audit Agent Failure Can Look Like A Clean Audit

**Severity:** P1

Built-in and custom deep-audit flows route audit-agent `onError` forward to the
next audit or scan. If an auditor crashes before writing a report:

- no open audit exists;
- scan skips;
- child flow can report completed;
- audit round was already incremented;
- the top-level clean gate may later complete the mission.

#### Recommendation

- audit-agent error must fail the audit round;
- require an audit-round manifest listing required report types and statuses;
- a round is clean only if all configured auditors completed and wrote terminal
  `clean` reports;
- absence of a report is failure, not clean.

### F9. Clean Gate Ignores Draft/Held Plans And Roadmap State

**Severity:** P1

`_shouldCompleteOnAuditQuota` checks only:

- `activePlans()`;
- `openAudits()`;
- audit round count.

See `src/engine.js:626-646`.

It does not check:

- `draftPlans()` / held plans;
- failed plans;
- roadmap completion;
- planned audit ownership;
- final verification state.

Prompt-level reopen/reuse conventions reduce risk but do not establish a hard
invariant.

#### Recommendation

Move completion to one deterministic predicate shared by:

- normal clean audit exit;
- audit quota handling;
- terminal reconciliation;
- monitor display.

Prompt behavior must not be the only protection against held-work loss.

### F10. Audit Status Has No Ownership Or Transition Invariant

**Severity:** P1

`openAudits()` recognizes only literal `Audit Status: open`:
`src/flow-loader.js:85-106`.

Statuses such as `planned`, `triaged`, `clean`, `closed`, malformed, or unknown
are invisible to the outstanding-work predicate. There is no mechanical proof
that:

- every `planned` audit has a live owner plan;
- the owner plan was not deleted or held;
- every `closed` audit has closure evidence;
- `clean` came from a successful configured auditor.

#### Recommendation

Define an audit state machine and registry:

```text
open -> planned -> verifying -> closed
open -> triaged
auditing -> clean
```

Validate ownership:

- `planned` requires owner plan path and finding IDs;
- owner plan must exist in an allowed non-terminal state;
- `closed` requires owner plan completed + final verification ID;
- unknown/malformed status is blocking.

### F11. Audit Reports Can Be Overwritten Across Rounds

**Severity:** P2/P1 traceability

`TIMESTAMP` is created once per mission run in `src/config.js:647-667`. Audit
prompts reuse that static value in filenames, so later rounds in the same run can
overwrite earlier reports.

#### Recommendation

Include immutable round identity:

```text
{runId}-r{auditRound}-{auditType}.md
```

Persist report paths in an audit-round manifest and never overwrite a prior
round.

### F12. Terminal Reconciliation Can Mask Real Failure

**Severity:** P1

When `reconcileOnTerminal: true`, `_reconcileTerminal` converts failish statuses
to `completed` if roadmap is done and no active/draft/open work is seen:
`src/engine.js:572-607`.

It does not require:

- successful child executions;
- green build verification;
- successful clean audit report set;
- a verification ledger;
- audit ownership integrity.

#### Recommendation

Either remove terminal reconciliation or make it use the exact same full
completion predicate and persisted verification ledger as normal completion.
Do not use broad disk heuristics to downgrade failure to success.

### F13. Effective Mission Config Precedence Contains Confirmed Bugs

**Severity:** P1

Confirmed cases:

1. `agent`, `driver`, and `promptMode` receive defaults before mission fallback at
   `src/config.js:461-465`, making mission values unreachable at `:594-600`.
2. env injection uses no-overwrite semantics while injecting base/local/mission
   sequentially, so earlier base values can prevent intended later overrides.
3. `skipSteps` uses `splitCsv(...) || ...`; an empty array is truthy, so lower
   precedence environment/mission values can be skipped.
4. `maxInnerCycles` is exposed but unused.
5. `autoPostmortem` can be accepted from config while engine behavior states
   postmortem is manual-only.

#### Recommendation

Implement one provenance-aware resolver:

```text
CLI > shell env > mission > base.local > base > hard default
```

Resolve all layers into a typed effective-config object before injecting any env
or starting the run. Preserve shell-provided keys as authoritative. Reject or
warn on every documented-but-unused field.

### F14. `mission-check` Accepts Unknown, Mistyped, And Invalid Fields

**Severity:** P1

The current validator checks truthiness and a few paths only. It accepts:

- `maxAuditRound` typo;
- string/zero/negative numeric limits;
- unknown nested command/prompt fields;
- dead config such as unsupported mission-level fields;
- name/filename mismatch;
- path type mismatch;
- invalid flow references.

`extends` also lacks cycle detection and does not fully honor its documented
filename/absolute-path forms.

#### Recommendation

Introduce an explicit typed schema:

- known top-level and nested fields;
- numeric ranges;
- file-vs-directory checks;
- mission filename/name consistency;
- unknown-field errors with typo suggestions;
- extension namespace for intentional custom metadata;
- extends normalization and cycle detection.

Add a test proving every documented config field has a runtime consumer.

### F15. Monitor And Context Tools Do Not Use Effective Mission Resolution

**Severity:** P2/P1 operational confusion

Runtime uses resolved `extends` and mission prompt directories. Monitor and
context tooling often raw-read mission JSON or search only shared/built-in
prompts. Consequences:

- dashboard can show config different from runtime;
- inherited missions can look incomplete or non-runnable;
- scenario/injection-map can display a different flow or prompt from execution;
- project prompt lint ignores mission-specific prompt sets.

#### Recommendation

All consumers must read the persisted `effective-config.json` for a run, or call
the same resolver for pre-run views. Remove duplicate flow/prompt resolution
logic from monitor/context-map/prompt-check.

### F16. `dry-run` Is Not A Static Flow Validator

**Severity:** P2/P1 expectation mismatch

Documentation describes dry-run as flow-orchestration validation. In practice it:

- simulates one data-dependent path;
- uses hardcoded mock responses based on step names;
- can skip unvisited subflows;
- can stop early on marker mismatch;
- still executes in-process script steps.

#### Recommendation

Rename/document current behavior as `simulate`. Add true static `preflight` for
graph/config validation. If retaining `dry-run`, mock script steps or prominently
report which scripts still execute.

### F17. False `{{forEachItem}}` Warning

**Severity:** P2

Every `EXEC_PLANS` visit logs an unresolved variable warning even though the
variable is correctly resolved per iteration. Root cause:

- base flowArgs are resolved before the forEach context exists:
  `src/engine.js:1050-1055`;
- they are correctly re-resolved later at `:1076-1084`.

#### Recommendation

Do not pre-resolve `flowArgs` for forEach subflows. Resolve only inside each
iteration, or suppress warnings for variables declared as forEach-bound.

### F18. Child Run-State Visibility Is Delayed

**Severity:** P2

While a forEach child is running, parent run-state may show `subflowRuns: []`
until the child completes. The evidence run showed the child at CLOSURE_AUDIT
while parent state still had no child record.

#### Recommendation

Append a running child placeholder before awaiting each forEach child, not only
after completion. Persist child state file path immediately so Monitor can link
to live progress.

### F19. Script Check Contract Is Ambiguous And Weak

**Severity:** P1

`closure-script-check`:

- is a built-in script registry entry, not a plan-defined script runner;
- uses `strict: false`;
- checks only unchecked items and a limited closure-evidence condition;
- may be described as a strict checker in prompts even though it is not;
- sets `SCRIPT_CHECK_DETAILS`, but custom prompts may omit the details variable.

In the evidence run, rendered closure prompt said `If FAIL is FAIL`, without the
actual failed-item details.

#### Recommendation

- rename to `PLAN_STRUCTURE_CHECK` if it is only structural;
- use strict plan validation or expose check profiles;
- inject structured result fields into closure prompt;
- distinguish deterministic structure check from semantic closure audit;
- do not let either `pass` or `fail` carry ambiguous completion semantics.

## 3. Recommended Target Architecture

### 3.1 One effective configuration object

Create a resolver that produces:

```json
{
  "mission": {},
  "origins": {},
  "mainFlow": { "path": "...", "sha256": "...", "effectiveLimits": {} },
  "subflows": [],
  "prompts": [],
  "scripts": [],
  "graph": {},
  "digest": "..."
}
```

Every runtime and UI consumer uses this object.

### 3.2 Side-effect-free preflight before run creation

Order:

```text
load + merge config
-> validate schema
-> resolve all flows/subflows/prompts/scripts
-> validate graph + markers + variables
-> compute effective limits + compatibility
-> emit effective-config digest
-> only then create runDir/start Monitor/spawn agents
```

### 3.3 Explicit runtime state machines

Plan state:

```text
draft -> held | active -> executing -> closure_pending
-> closure_approved -> verified -> completed
```

Audit state:

```text
auditing -> clean
auditing -> open -> planned -> verifying -> closed
open -> triaged
```

Mission terminal state:

```text
completed | blocked | failed | audit_exhausted | max_cycles | max_total_steps
```

Limits are not successful terminal conditions by themselves.

### 3.4 Atomic finalization

The final mutation is deterministic, but verification must be read-only:

```text
EXECUTE
-> PLAN_STRUCTURE_CHECK
-> CLOSURE_AUDIT
-> BUILD_VERIFY
-> FINALIZE
```

FINALIZE verifies preconditions and atomically changes plan/roadmap/audit states.
If BUILD_VERIFY repairs any audited file, the flow must return to CLOSURE_AUDIT
before FINALIZE. FINALIZE should be journaled and idempotent because normal
multi-file writes are not truly atomic.

### 3.5 Verification ledger

Persist machine-readable evidence for each plan:

```json
{
  "plan": "...",
  "closureAudit": { "status": "approved", "sessionId": "..." },
  "commands": [{ "command": "...", "exitCode": 0, "timestamp": "..." }],
  "finalizedAt": "..."
}
```

Completion and reconciliation consume this ledger rather than prose heuristics.

## 4. Prioritized Implementation Roadmap

### Phase 1 - Correctness And False-Success Prevention

Priority: P0

1. Change audit quota exhaustion from `completed` to `audit_exhausted` unless the
   full completion predicate passes.
2. Add draft/held/failed plans, roadmap completion, audit ownership, and clean
   report set to the completion predicate.
3. Add explicit strict/tolerant child-failure policies; in tolerant mode retry
   failed active plans before ordinary drafting.
4. Require semantic closure audit on the normal plan path.
5. Make BUILD_VERIFY read-only or rerun closure audit after any repair; then add
   journaled, idempotent FINALIZE and move terminal status mutations there.
6. Make audit-agent errors fail the round.
7. Restrict or disable terminal reconciliation until it uses the same complete
   predicate and verification ledger.

### Phase 2 - Effective Config And Preflight

Priority: P1

1. Implement typed effective-config resolution with provenance.
2. Add recursive flow/prompt/script graph validation.
3. Add `preflight` and `preflight --json`.
4. Persist `effective-config.json` and digest before first step.
5. Fix `list-steps` to use effective flow; add recursive tree output.
6. Run preflight before runDir and Monitor side effects.

### Phase 3 - Limit Ownership And Config Cleanup

Priority: P1

1. Define main/subflow/global budget scopes.
2. Wire or remove `maxInnerCycles`.
3. Define mission-vs-flow ownership for `maxAuditRounds` and ping-pong behavior.
4. Stop parent config from overriding child flow limits accidentally.
5. Fix agent/driver/promptMode/env/skipSteps precedence.
6. Reject unknown or unused mission fields.

### Phase 4 - Audit And Plan Integrity

Priority: P1

1. Add audit status schema and owner-plan references.
2. Generate unique per-round audit filenames.
3. Add audit-round manifest requiring every configured report.
4. Introduce machine-readable verification ledger.
5. Make planned/closed audit integrity a deterministic check.

### Phase 5 - Observability And Developer Experience

Priority: P2

1. Print flow/prompt provenance and effective limits at startup.
2. Make Monitor read effective config snapshots.
3. Fix context-map/scenario/prompt lint to use mission prompt sets.
4. Fix false `forEachItem` warnings.
5. Persist running child placeholders immediately.
6. Rename dry-run semantics or split `simulate` from `preflight`.

## 5. Regression Test Matrix

### Flow And Prompt Resolution

- custom `flowName` appears in `list-steps`;
- project flow wins over built-in flow;
- mission `promptsDir` wins over shared and built-in prompts;
- nested prompt paths preserve directories;
- missing transitive subflow fails preflight;
- unknown script fails preflight even when unreachable;
- effective flow/prompt digest changes when source content changes.

### Limits

- parent `500/8`, child `50/6` retains child limits;
- `maxInnerCycles: 2` affects only child flows;
- global max-total-step budget is shared if documented as global;
- mission audit override beats flow default if supported;
- incompatible audit/cycle/ping-pong budgets fail or warn before run;
- hitting any safety limit is never automatically `completed`.

### Closure

- no semantic closure audit -> plan cannot complete;
- build failure after closure approval leaves roadmap/audits non-terminal;
- FINALIZE is the only writer of completed/done/closed states;
- BUILD_VERIFY does not mutate audited files, or changed files trigger another
  closure-audit pass before FINALIZE;
- some_failed/all_failed child batch blocks further drafting;
- strict structure check and semantic audit have distinct results;
- closure details are injected structurally, not reconstructed by the agent.

### Audit

- auditor process error cannot produce clean round;
- missing configured report blocks completion;
- held draft blocks completion;
- planned audit without owner blocks completion;
- audit quota exhaustion returns `audit_exhausted` when work remains;
- each round writes unique immutable report files;
- one complete clean round plus no outstanding work permits completion.

### Config

- CLI > shell env > mission > local > base > default;
- mission agent/driver/promptMode are honored;
- mission/env skipSteps work without CLI value;
- unknown fields and typo suggestions are tested;
- every documented field has a runtime consumer test;
- extends filename/absolute/nested/cycle cases are covered.

### Observability

- preflight causes no `_tmp` or Monitor side effects;
- run-state references effective-config digest before CHECK;
- Monitor displays persisted run config, not current raw mission JSON;
- running forEach child appears in parent state before child completion;
- no false unresolved `forEachItem` warning.

## 6. Immediate Guidance For Existing Users

Until the engine changes land:

1. Inspect `run-state.json.flowName` and child `run-state-*.json.flowName` to
   confirm custom flow selection.
2. Inspect captured `.log.prompt` files to confirm prompt override.
3. Read custom child flow JSON directly; `list-steps` is not authoritative.
4. Do not assume mission-level `maxAuditRounds` works; edit the selected flow or
   use a dedicated flow, and verify run-state effective value.
5. Do not trust child-flow local limits when parent mission max limits are set.
6. Treat safety-limit completion and terminal reconciliation as requiring manual
   review.
7. Keep plan/roadmap/audit terminal mutations until after BUILD_VERIFY in custom
   workflows.
8. Treat CLOSURE_SCRIPT_CHECK as structural support, not independent semantic
   closure proof.

## 7. Final Verdict

The evidence run is **not** an example of custom flow override failure. Custom
flow and prompt override both worked.

It is an example of insufficient effective-configuration observability and
several deeper runtime-contract defects. The highest risks are false-success
terminal paths, non-atomic closure, child-limit leakage, and shallow validation.

Implementing effective-config preflight plus atomic FINALIZE will remove most of
the ambiguity and several correctness hazards at once. Limit ownership and audit
integrity should follow immediately afterward.
