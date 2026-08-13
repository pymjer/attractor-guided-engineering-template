Read `{{multiAuditPrompt}}` **completely** and follow it precisely.

Perform a multi-dimensional audit on mission `{{missionName}}`, focused on `{{moduleDir}}/` — code, config, tests, and public contracts (exports, API surface). Cross-reference architecture docs for documented contract drift. Sample by risk: prioritize changed/contract-bearing surfaces named in `{{multiAuditPrompt}}`; you need not read every file.

## Priority every finding — `[P0]` / `[P1]` / `[P2]`

Prefix EVERY finding with a priority tag and a one-line justification:

- **`[P0]`** — blocking: contract break, incorrect behavior, data loss, security, failing/absent test for changed behavior. MUST be fixed.
- **`[P1]`** — material: a real defect or contract drift that should be fixed but is not blocking. MUST be fixed.
- **`[P2]`** — trivial/non-blocking polish: doc line-number rot, wording, naming, cosmetic nits. Recorded but does not by itself warrant a plan.

Downstream, only `P0`+`P1` drive remediation plans; `P2`-only audits are triaged. Do not inflate a cosmetic nit to `P1`.

## Result file + honest status header

Write to `{{auditsDir}}/{{TIMESTAMP}}-multi-audit-{{missionName}}.md`. The header's `Audit Status` MUST reflect the real outcome so the mission loop is not misled:

- Any `P0`/`P1` finding → `> Audit Status: open`
- Only `P2` findings → `> Audit Status: triaged`
- No finding at all → `> Audit Status: clean`

```
> Audit Status: <open | triaged | clean>
> Audit Type: multi-dimensional
> Mission: {{missionName}}
```

`open` is counted by the mission's open-audit gate; `triaged`/`clean` are terminal and NOT counted.

## Output protocol

Your output MUST end with exactly one `<AI_STEP_RESULT>` marker (the only parsed marker), as the last line:
- Any finding (`P0`/`P1`/`P2`): `issues`
- No finding: `clean`
- Audit tool/prompt unusable or evidence unobtainable (do not fake clean): `fail`

```
<AI_STEP_RESULT>clean</AI_STEP_RESULT>
```
