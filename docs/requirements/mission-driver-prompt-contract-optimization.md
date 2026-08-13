# Requirement — mission-driver Prompt 契约优化

> Status: draft (implementation-ready pending human review)
> Source inputs:
> - 现行内置 12 prompts：`tools/mission-driver/prompts/*.md` + `flows/*.json` + `src/prompt-check.mjs` + `src/flow-loader.js`（机器契约实证，非事后推断）
> - 准则：`C:\Work\cardlite-acq\docs\docs-for-ai\11-ai-tooling\ai-promptes-guild.md`（可执行契约写法）
> - 两套实战 prompt 集：`C:\Work\cardlite-acq\missions\prompt-sets\docs-for-ai-remediation\`、`...\cardlite-ai-instructions-and-skills-migration\`（可泛化模式与项目专属边界）
> - Agent 设计一手研究（2026-08）：Anthropic *Building effective agents* (2024-12-19)、*How we built our multi-agent research system* (2025-06-13)、*Effective context engineering for AI agents* (2025-09-29)；OpenAI *A practical guide to building agents*、*Harness engineering* (2026-02)；Cognition 多 writer 实践 (2025-06 / 2026-04)
> Verification command: `pnpm --prefix tools/mission-driver test`

## 决议更新 (2026-08-12,人工裁决,覆盖下文 P2 相应描述)

独立草案复审指出:P2 原设计"draft prompt 内置独立子 agent 审查 + REVIEW_PLANS 降为零调用兼容层"依赖 prompt 措辞级独立性,engine 无 session 隔离保障,可能不满足 plan-authoring-guide 规则 13,且实质将 E5 绕过路径正式化。裁决如下:

- **D4 = 选项 B**:**保留 `REVIEW_PLANS` 为规范独立复审门**(独立 agent-session,fix-forward:直接改 plan 并升 `active`,真 Blocker 则 `Review Hold` 保持 draft)。`DRAFT_PLANS` 内的"独立子 agent 审查"降为**自查/预检**,不 spawn、不自升 `active`。因此下文 P2 表中"REVIEW_PLANS 正常路径零调用""DRAFT_PLANS 通过直接 active"作废;happy-path = DRAFT 1 + REVIEW_PLANS 1 + EXECUTE 1 + BUILD_VERIFY 1(调用数与原 P5 口径一致)。
- **D7 = Roadmap item ↔ plan 一对一**:`draft-from-roadmap.md` 每个 roadmap item 恰好一个 plan;大 item 拆为同一 plan 内多个 Phase,不打包多 item;由 REVIEW_PLANS 校验。audit 来源打包规则本期不变。

执行细节见 `docs/plans/mission-driver-prompt-contract-optimization/2026-08-12-1615-1-prompt-contract-optimization.md`(D4/D7)。

## Purpose / 目标

把 mission-driver 内置 12 个 prompt 从"带项目泄漏和若干死分支的文案"重写为**最小执行契约**，在**快路径延迟不退化**的前提下修正契约缺口。本次工作要：

1. 消除失效模板变量、marker 顺序矛盾、不可达 closure 语义分支、clean audit 仍标 `open`、项目专属泄漏（Maven / Jira / 固定 commit 模板）。
2. 按最新 agent 编排实践把"独立性"与"额外状态机步骤"解耦：**单 writer 默认执行 + 必要时 clean-context reviewer + 确定性 gate 优先**，不为每步叠加独立 reviewer。
3. 修正状态所有权：`EXECUTE` 不提前做独立 closure；`BUILD_VERIFY` 复用其既有 agent 调用同时承担语义 closure，发现代码问题返回 `EXECUTE` 而非自改后宣称完成。
4. 让失败诚实：来源冲突、审查不收敛、证据不足、审计工具失败时**终止当前 flow**，不伪装成 `nothing/clean`。
5. 让自动提交安全：`BUILD_VERIFY` 按 `{{commitFormat}}` 提交且**只纳入本计划拥有的变更**，不卷入 mission 启动前的既有改动。

---

## 一、证据（契约级缺陷，均可核验）

| # | 缺陷 | 证据 |
| --- | --- | --- |
| E1 | `draft-from-audit.md` 使用未注入的 `{{backlogDir}}` | `prompts/draft-from-audit.md:8`；`src/main.js:682-718` 不注入；运行时保留占位符 |
| E2 | `closure-audit.md` 的 "SCRIPT_CHECK_RESULT is PASS — Semantic Verification" 分支正常不可达 | `flows/plan-execution.json:29-45` 脚本 pass 直接进 BUILD_VERIFY |
| E3 | `closure-audit.md` 自相矛盾：开头 "ONLY marker" vs issues 路径必须带 `<REMAINING>` | `prompts/closure-audit.md:3,32-40,63-71` |
| E4 | `closure-audit.md` 复制了一套比 `plan-check.mjs` 实际更强的"strict checker"规则 | `prompts/closure-audit.md:17-21` vs `src/plan-check.mjs:115-139`；预检用 `strict:false`（`src/flow-loader.js:204`） |
| E5 | draft 内置独立子 agent 审查可绕过正式 `REVIEW_PLANS`（扫描 `draft` 计划） | `prompts/draft-from-roadmap.md:25`、`prompts/draft-from-audit.md:20` vs `flows/mission-driver.json:73-83` |
| E6 | `build-verify.md` 允许 closure 后改代码、随后直接完成而不再 closure | `prompts/build-verify.md:18-22` vs `flows/plan-execution.json:57-66` |
| E7 | `build-verify.md` 项目泄漏：硬编码 Maven `-pl … -am`、Jira 模式猜测、固定 commit 模板、字面量 `{timestamp}` | `prompts/build-verify.md:5-9,24-37,33`；`commitFormat` 已注入却未使用（`src/main.js:701`） |
| E8 | clean audit 仍写 `Audit Status: open`，被 `openAudits()` 误识别为待处理 | `prompts/multi-audit.md:5-11`、`prompts/open-audit.md:5-11` vs `src/flow-loader.js:85-107` |
| E9 | audit 文件无机器级产物验证（存在/头部/类型/优先级） | `flows/deep-audit-loop.json:36-59` |
| E10 | `created` 输出顺序矛盾：示例 marker 在 FLOW_VARS 前，又要求 marker 是最后内容 | `prompts/draft-from-roadmap.md:40-50`、`prompts/draft-from-audit.md` 同 |
| E11 | `prompt-check.mjs` 远弱于真实契约：不校验 marker 存在/唯一/末尾、辅助标签、变量可解析；forEach 完全跳过值校验 | `src/prompt-check.mjs:29-59,61-97` |
| E12 | `mission-draft.md` 的 `<AI_STEP_RESULT>created` 是冗余伪契约（`main.js` 只解析 `MISSION_FILE`）；不要求跑 `mission-check.mjs` | `src/main.js:197-249,493-505` |
| E13 | `run-postmortem.md` 强制 "What worked 2–5 项"；`AI_STEP_RESULT` 不被 postmortem parser 消费 | `prompts/run-postmortem.md:8-23,94-95` vs `src/postmortem.mjs:31-35,79-89` |
| E14 | `execute.md` 提前把 roadmap 标 done / 关闭 source audit / 声明独立 closure | `prompts/execute.md:9-12` |

---

## 二、设计依据（agent 编排研究结论）

- **复杂度按可测收益升级**：Anthropic / OpenAI 均建议从最简单方案开始；agent 以延迟和成本换性能，仅在可测改善时增加复杂度。
- **多 agent 成本高、编码并行空间小**：Anthropic 实测多 agent 约消耗普通聊天 15 倍 token；多数编码任务没有研究任务那样多真正可并行工作。结论：默认单 writer + 必要时 clean-context reviewer，不做共享工作区多 writer。
- **确定性 gate 优先**：可机械判断的规则（格式、类型、lint、测试、结构、状态）进入脚本/linter；模型调用留给语义判断。
- **结构证明 ≠ 语义证明**：checker 通过不能单独证明行为或业务正确；但语义审查可由既有的 BUILD_VERIFY agent 调用承担，无需新增独立 reviewer 步骤。
- **失败诚实**：工具失败、证据不足、来源冲突必须产生非成功终态，不得伪装 clean/pass/completed。
- **渐进披露**：每步只加载当前阶段需要的 owner source，删除泛化的"全部读完代码/文档"。

---

## Scope / 范围

设计细节归属后续实施 plan 与 `tools/mission-driver/design/mission-driver-flow-design.md`，本文件定义 what 与验收。

### P1 — 12 prompts 契约优先重写

统一采用最小执行契约（任务、事实来源、状态所有权、工作流、成功证据、停止条件、输出协议），但**不机械套固定章节**。要点：

- **事实来源按问题路由**：意图看 requirement/design，契约形状看 schema/API/model，当前行为看 live code/config/tests，流程状态看 plan/roadmap/audit。
- **冲突处理统一**：同时记录 intended/current；若会改变范围、契约或风险，不自行裁决，返回失败或 hold。
- **结构证明与语义证明分开**；删除"全部读完"式泛化指令，按当前 phase/finding 加载来源。
- **删除项目泄漏**：Maven、Jira、固定 commit 模板等；提交统一用 `{{commitFormat}}`。

### P2 — 步骤职责与状态所有权（快路径优先）

```
CHECK → DRAFT_PLANS(起草+1 个独立子agent审查,≤2 轮) → REVIEW_PLANS(正常为空,仅恢复遗留 draft)
  → EXECUTE(单 writer) → CLOSURE_SCRIPT_CHECK
      pass   → BUILD_VERIFY(独立冷读+语义 closure+最终验证+commit)
      fail   → CLOSURE_AUDIT(只诊断/修复 closure 失败)
                 issues    → EXECUTE
                 approved  → BUILD_VERIFY
  → DRAFT_PLANS / DEEP_AUDIT
```

| 步骤 | 职责 |
| --- | --- |
| `DRAFT_PLANS` | 保留当前独立子 agent 审查；只在新计划时调用，≤2 轮；通过直接 `active` |
| `REVIEW_PLANS` | 崩溃恢复/历史 draft 兼容层；正常路径零模型调用 |
| `EXECUTE` | 唯一写代码 agent；按 phase 读 owner source + focused proof；不提前 done / 关 audit / 宣称 closure；记录 dirty-path baseline |
| `CLOSURE_SCRIPT_CHECK` | 机械通过即跳过 `CLOSURE_AUDIT` |
| `CLOSURE_AUDIT` | 删除不可达 "script PASS 语义审查" 分支；只处理 FAIL；能证明已落地但元数据漂移可修并 `approved`，否则精确 reopen 后 `issues`；禁止伪造证据 |
| `BUILD_VERIFY` | 复用既有调用同时承担语义 closure + 最终命令 + 提交；发现代码问题不自行修改，修 plan 重开精确 phase/gate 后 `fail` 回 `EXECUTE` |
| `MULTI/OPEN_AUDIT` | 不再要求全量 read；按注入 audit spec 有界抽样；clean 写 `Audit Status: clean`，P2-only 写 `triaged`，P0/P1 写 `open` |

### P3 — 输出协议与失败诚实

- 辅助数据在前，唯一结果 marker 是最后一行：`created` 必须有可解析存在的 `PLAN_FILE`；`issues` 必须有非空 `REMAINING`；`pass/approved/clean` 必须建立在指定可观察证据上。
- `mission-brief` / `mission-draft` / `run-postmortem` 只输出其真实 parser 消费的 tags，删除装饰性 marker（`mission-draft` 的 `AI_STEP_RESULT`、postmortem 的 `AI_STEP_RESULT`）。
- 给 `DRAFT_PLANS`、`DRAFT_FROM_AUDITS`、`MULTI_AUDIT`、`OPEN_AUDIT` 接入已有通用值 `fail`：来源冲突 / 审查不收敛 / 证据不足 / 审计工具失败时终止当前 flow。**这是唯一新增的步骤 marker 值，不新增标签类型。**

### P4 — 最小契约修复（flow / loader / linter / test）

- 复用 `roadmapPath` 写 `Follow-up Backlog`，移除失效 `{{backlogDir}}`；**不新增模板变量**。
- `created` 输出顺序：`FLOW_VARS` 在前、`AI_STEP_RESULT` 最后一行。
- `closureScriptCheck` 异常也写 `SCRIPT_CHECK_RESULT/DETAILS`（避免模板变量残留）。
- `BUILD_VERIFY` 注入并使用 `{{commitFormat}}` + closure 反馈；自动提交只纳入本计划拥有且不属于 dirty-path baseline 的文件；同路径已有用户改动则保留未提交并 `fail`。
- 扩展 `prompt-check.mjs`：marker 存在/唯一/末尾、允许值、`FLOW_VARS/PLAN_FILE`、`REMAINING`、已知模板变量；扫描内置 prompt 项目泄漏（Maven/Jira 等）；保留 forEach 值校验缺口的最小兼容。
- 给 `DRAFT_PLANS` / `DRAFT_FROM_AUDITS` / `MULTI_AUDIT` / `OPEN_AUDIT` 增加 `fail` transition 边（`onMaxRetries` 或 `done: "failed"`），承接 P3 的诚实终止；**仅新增 transition 边，不新增 step、不新增标签类型**。
- **不新增 public marker 标签类型、不新增 mission schema 字段、不新增 flow step**。

### P5 — 静态与模拟回归

四层验证（不消耗真实模型长跑）：

1. Prompt 静态契约（见 P4 linter 扩展）。
2. Flow 模拟：happy path（draft 内审后 active，REVIEW 空扫描零调用，script pass 跳过 CLOSURE_AUDIT）；failure path（script fail 才调 auditor，auditor/BUILD_VERIFY `issues/fail` 回 EXECUTE 并重走 closure）；`fail` 不得被当 `nothing/clean/completed`；audit 三态（clean/triaged/open）分别收敛。
3. Prompt 行为场景：计划重复、owner source 冲突、checker 绿但语义证据红、空验证命令、dirty baseline、提交文件重叠、审计工具失败、postmortem 缺 run evidence。每场景断言允许/禁止写入状态与最终 marker。
4. 全套回归：`pnpm --prefix tools/mission-driver test` + `git diff --check` + `gitnexus_detect_changes` 影响复核。

---

## Non-Goals / 非目标

- 不改 mission-driver 总体状态机形状（`CHECK → REVIEW → EXECUTE → DRAFT → DEEP_AUDIT` 保留）。
- 不引入学习型 router、动态 judge、风险评分模型或 mission 风险/预算字段（研究结论：首个优化切片应是可静态审计的契约 + 硬终态 + 模拟器，积累真实轨迹后再评估）。
- 不并行化共享工作区的 EXECUTE；不做多 writer swarm。
- 不把 OPEN_AUDIT 改成无条件并行；不做 risk-adaptive 自动升级（留给后续基于真实轨迹的评估）。
- 不复制 Cardlite 业务事实（V1.10、ABO、Maven、xmeta、skill 名等）进内置 prompt；可泛化模式（幂等去重、P0/P1 不可降级、clean evidence、陌生消费者 probe、source-quality 归因）才吸收。
- 不重写 god-file（`engine.js` / `monitor.js`），仅做 P4 必要最小修改。

## Business Rules / 关键规则

- **失败诚实优先**：`fail` 不被平均分或后续步骤掩盖；工具失败不得折算成 clean/pass。
- **状态单一 owner**：roadmap done / source audit closed / plan `completed` 只在最终门（`BUILD_VERIFY`）翻转，`EXECUTE` 不提前。
- **独立性 ≠ 多步骤**：语义审查由既有 BUILD_VERIFY clean-context 调用承担，不新增独立 reviewer step。
- **确定性优先**：可机械判断的规则进脚本/linter，不留给自然语言碰运气。
- **最小充分**：成功标准是契约完整、延迟不退化、缺陷消除，不是 prompt 字数。

## Edge Cases / 已知边界

- 旧审计报告无 `clean/triaged` 头 → 退化为现有行为（向后兼容，`openAudits()` 仍识别 `open`）。
- dirty-path 与计划目标同路径 → 保留未提交并 `fail`，不冒险混入 commit。
- closure script pass 但 BUILD_VERIFY 发现语义缺口 → 修 plan 重开精确 phase/gate，回 `EXECUTE`，不静默修复。
- draft 内审无法收敛 → 第二轮仅在前轮发现 Blocker/Major 且计划实质修订时触发；仍不收敛则输出 `fail` 终止当前 flow。
- 同一 finding 被 multi/open audit 同时命中 → 在 audit spec / draft 阶段去重到单一 closure surface。

## Acceptance Criteria / 验收标准

- [ ] P1：12 个 prompts 全部按最小执行契约重写，无 E1–E14 残留（静态扫描 + 人工核验）。
- [ ] P2：职责与状态所有权符合 P2 表；`EXECUTE` 不再提前 done / 关 audit / 宣称 closure。
- [ ] P3：所有 flow prompt 输出"辅助数据在前、marker 末尾"；draft/audit 步骤接入 `fail`。
- [ ] P3：`mission-draft` / `run-postmortem` 删除未被 parser 消费的装饰 marker。
- [ ] P4：`{{backlogDir}}` 失效变量消除（复用 `roadmapPath`）；`closureScriptCheck` 异常写 `SCRIPT_CHECK_RESULT/DETAILS`。
- [ ] P4：`BUILD_VERIFY` 使用 `{{commitFormat}}`，自动提交只纳入计划拥有变更，dirty-path 重叠时保留未提交并 `fail`。
- [ ] P4：`prompt-check.mjs` 扩展（marker 存在/唯一/末尾/允许值/辅助标签/变量/项目泄漏）通过，且内置 prompt 全部通过新 linter。
- [ ] P5：Flow 模拟覆盖 happy path 与四类 failure path，断言 agent 调用数：closure-pass 路径不新增模型调用；happy-path 调用数不高于现状（`DRAFT 1 + reviewer 1 + EXECUTE 1 + BUILD_VERIFY 1`）。
- [ ] P5：Prompt 行为场景（≥8 个）断言允许/禁止状态与最终 marker 全绿。
- [ ] 回归基线：`pnpm --prefix tools/mission-driver test` 全绿；`git diff --check` 无Whitespace 错误。
- [ ] 日志：在 `docs/logs/{year}/{month}-{day}.md` 记录本次变更与 full-green 验证状态。

## Unresolved Questions / 待裁决

1. `prompt-check.mjs` 的 forEach 值校验缺口（当前完全跳过）是否在本期补齐，还是单列跟进？建议本期补齐到"值属于 transition alias 并集"。
2. `CLOSURE_AUDIT` `approved → BUILD_VERIFY` 与 `BUILD_VERIFY` 也承担语义 closure 是否冗余？建议 approved 仅用于"元数据已修、实现已证落地"，避免重复语义审查。
3. dirty-path baseline 写入位置：写入 plan 前置 matter 还是 runDir 旁路文件？建议写入 plan 前置（崩溃恢复可读，无需新 engine 字段）。

## Routing / 后续

- Task type: architecture change + implementation（触及 flow 契约、prompt 契约、linter、loader、测试链）——需 plan。
- Plan 目录：`docs/plans/mission-driver-prompt-contract-optimization/`（per-mission 子目录，见 mission-driver skill）。
- Owner docs to update on closure：
  - `tools/mission-driver/design/mission-driver-flow-design.md`（步骤职责与状态所有权）
  - `docs/architecture/mission-driver-baseline.md`（marker 契约补 `fail` 值；linter 能力）
  - `tools/mission-driver/CONTEXT.md`（若 CHECK/BUILD_VERIFY 行为文字描述需同步）
- 建议 plan 拆分：P1 prompts 重写（可按 12 文件分批）→ P2/P3 契约与 marker → P4 linter/loader → P5 回归。每批独立可验证、独立提交。
