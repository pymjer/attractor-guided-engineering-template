# mission-driver-prompt-contract-optimization Prompt 契约优化

> Plan Status: completed
> Last Reviewed: 2026-08-13
> Source: docs/requirements/mission-driver-prompt-contract-optimization.md
> Related: docs/plans/mission-driver-actionable-fixes/*
> Audit: required

## Current Baseline

实证核验(2026-08-12,逐条读码确认,非记忆):

- 12 个内置 prompt 位于 `tools/mission-driver/prompts/*.md`;3 个 flow 位于 `flows/{mission-driver,plan-execution,deep-audit-loop}.json`。
- `src/main.js` 的 `delegates.vars` 注入块**已注入** `roadmapPath`、`commitFormat`,但**未注入** `backlogDir`(E1 根因)。
- `flows/plan-execution.json`:`CLOSURE_SCRIPT_CHECK` pass→`BUILD_VERIFY`、fail→`CLOSURE_AUDIT`;`flow-loader.js::closureScriptCheck` 用 `inspectPlan(..., { strict:false })`,且在 `catch` 分支**不写** `SCRIPT_CHECK_RESULT/DETAILS`(异常时模板变量残留)。
- `src/prompt-check.mjs` 仅校验:结果标签必须是 `AI_STEP_RESULT` 拼写、非 forEach 步骤的值成员;**不校验**存在/唯一/末尾/辅助标签/模板变量/项目泄漏;forEach 步骤**完全跳过**值校验。
- `src/postmortem.mjs` 只消费 `POSTMORTEM_FILE`/`MEMORY_UPDATED`,不消费 `AI_STEP_RESULT`。
- `docs/plans/` 采用 **per-mission 子目录**约定(如 `mission-driver-actionable-fixes/`),非 per-author,本计划遵循同约定。
- 验证命令(`docs/context/project-context.md` 与 `package.json`):`pnpm --prefix tools/mission-driver test`,其 `test` 脚本链式执行 `node --test test/*.test.js && node src/prompt-check.mjs`。

缺陷 E1–E14 已在需求文档逐条给出 file:line 证据,并经本会话独立核验全部属实。

Gap:12 个 prompt 存在失效模板变量、marker 顺序矛盾、不可达 closure 分支、clean audit 仍标 `open`、项目专属泄漏(Maven/Jira/固定 commit 模板)、EXECUTE 提前翻转状态、BUILD_VERIFY 改码后不再 closure;linter 远弱于真实契约;失败路径可被伪装成 `nothing/clean/completed`。

## Goals

- 消除 E1–E14 全部契约缺陷,把 12 个 prompt 重写为最小执行契约。
- 修正状态所有权:roadmap done / source audit closed / plan completed 只在 `BUILD_VERIFY` 翻转,`EXECUTE` 不提前。
- 让失败诚实:来源冲突/审查不收敛/证据不足/审计工具失败时以 `fail` 终止当前 flow,不伪装 `nothing/clean/completed`。
- 让自动提交安全:`BUILD_VERIFY` 用 `{{commitFormat}}` 且只纳入本计划拥有、非 dirty-path baseline 的变更。
- 把可机械判断的契约规则下沉到 `prompt-check.mjs`(确定性 gate 优先)。
- 复审门归属明确:`REVIEW_PLANS` 为规范独立复审门(选项 B,D4);draft prompt 只做自查/预检。
- Roadmap item ↔ plan 一对一(D7):`draft-from-roadmap.md` 每个 roadmap item 恰好一个 plan。
- 快路径不新增模型调用(操作化为:closure-pass 路径调用数不增;happy-path = DRAFT 1 + REVIEW_PLANS 1 + EXECUTE 1 + BUILD_VERIFY 1)。

## Non-Goals

- 不改 mission-driver 总体状态机形状(`CHECK → REVIEW → EXECUTE → DRAFT → DEEP_AUDIT` 保留)。
- 不新增 public marker 标签类型、不新增 mission schema 字段、不新增 flow step;`fail` 是唯一新增的**步骤 marker 值**(复用已有 alias,不新增标签类型)。
- 不新增模板变量(复用已注入的 `roadmapPath`/`commitFormat`)。
- 不重写 god-file(`engine.js`/`monitor.js`);不引入学习型 router/风险评分/预算字段。
- 不并行化共享工作区 EXECUTE;不做多 writer swarm。
- 不复制 Cardlite 业务事实进内置 prompt。
- **wall-clock 延迟不做实测**(本切片以"agent 调用数不增"作为"延迟不退化"的可静态审计代理指标;真实长跑延迟留待积累真实轨迹后评估)。

## Task Route

- Type: `architecture change` + `implementation-only change`(触及 flow 契约、prompt 契约、linter、loader、测试链)
- Owner Docs: `tools/mission-driver/design/mission-driver-flow-design.md`、`docs/architecture/mission-driver-baseline.md`、`tools/mission-driver/CONTEXT.md`
- Skill Selection Basis: 本工作方法是"契约缺陷修复 + 静态/模拟回归",无匹配的项目专属可复用 skill;审查阶段使用通用独立复审(subagent)。`Skill: none`(各 phase 同)。

## Infrastructure And Config Prereqs

- No infra prereqs beyond existing baseline。引擎零 npm 依赖不变;不改 `web/dist/`、`memory/_index.md`、`install-age.sh`、`engine.js` 核心(均为 project-context.md 的 AI Block Conditions,本计划范围外)。

## Decisions(实施前须随草案复审确认)

### D1 — forEach linter 值校验缺口(需求 Unresolved Q1)

- 选择:本期**补齐** forEach 步骤的值校验到"值 ∈ 该 prompt 所有引用步骤的 transition marker ∪ 顶层 markerAlias 并集"。
- 备选:保留缺口(P4 原文"最小兼容")。
- 理由:确定性 gate 优先;forEach 聚合语义(如 plan-review 发 `approved` 被折叠为 `all_complete`)已被"transition ∪ alias 并集"覆盖(`approved` 是 mission-driver.json 的 alias)。
- 残留风险:若未来新增 forEach 步骤发出未登记的中间 marker,linter 会误报——通过在 alias 表登记解决,属可接受的显式约束。

### D2 — CLOSURE_AUDIT `approved` 与 BUILD_VERIFY 语义 closure 冗余(需求 Unresolved Q2)

- 选择:`approved` 仅用于"元数据已修、实现已证落地";`BUILD_VERIFY` 不重复全量语义审查,只做最终命令 + focused 再验证 + commit。
- 理由:避免同一语义审查跑两遍,快路径调用数不增。
- 残留风险:approved 后 BUILD_VERIFY 若发现语义缺口仍走 `fail`→EXECUTE(Edge Case 覆盖)。

### D3 — dirty-path baseline 写入位置(需求 Unresolved Q3)

- 选择:写入 **plan 前置 matter**(如 `> Dirty-Path Baseline: <files>`)。
- 备选:runDir 旁路文件。
- 理由:崩溃恢复可从 plan 直接读回,无需新增 engine 字段(符合"不新增 schema 字段")。
- 残留风险:plan 前置 matter 需被 plan-check 容忍——已确认 `PLAN_STATUS_RE`/`AUDIT_STATUS_RE` 只匹配特定行,额外 `>` 行不影响。

### D4 — REVIEW_PLANS 复审门归属(审计发现 C2 + 独立复审 1A/1B,**RESOLVED = 选项 B,人工裁决 2026-08-12**)

裁决:采用**选项 B** —— **不降级** `REVIEW_PLANS`,由它作为满足 plan-guide 规则 13 的规范独立复审门(它是独立于起草者的 agent-session,`plan-review.md` 已是 fix-forward:发现 Blocker/Major 直接改 plan 并升 `active`,真 Blocker 则保持 `draft` + `Review Hold`)。draft prompt(`draft-from-roadmap.md`/`draft-from-audit.md`)的"内审"改写为**自查/预检**,**不**承担规则 13 义务、**不** spawn 独立子 agent、**不**自行翻 `active`(保持 `draft` 交 REVIEW_PLANS)。

理由:engine 层的独立性由"REVIEW_PLANS 是独立 step/session"结构性保证,而非依赖 prompt 措辞;彻底消除 E5 的绕过风险(不再存在"起草者自审自升"路径)。

调用数评估(经与需求 P5 口径核对):happy-path = DRAFT 1 + REVIEW_PLANS 1(每 draft 计划一次,fix-forward 单趟)+ EXECUTE 1 + BUILD_VERIFY 1 = 4,与需求"DRAFT 1 + reviewer 1 + EXECUTE 1 + BUILD_VERIFY 1"调用数相同;Token/延迟与需求 P2 实质等价(去掉了 DRAFT 内嵌 spawn 编排开销,可能略省)。仅名义上放弃"REVIEW 零调用"。

对需求文档的影响:偏离需求 P2 的"REVIEW_PLANS 正常路径零调用"设计意图 → 需同步更新 `docs/requirements/mission-driver-prompt-contract-optimization.md` 的 P2 段(见收尾 owner-doc 同步)。

### D7 — Roadmap item ↔ plan 一对一(人工新增要求 2026-08-12)

- 选择:`draft-from-roadmap.md` 起草时,**一个 roadmap item 恰好对应一个 plan(1:1)**,不再把多个 roadmap item 打包进一个 plan。每轮仍受"1–3 个 plan"节流,即每轮为接下来的 1–3 个 roadmap item 各建一个 plan。
- 大 item 处理:若单个 roadmap item 过大,拆成**同一 plan 内的多个 Phase**(仍是 1 plan),不拆成多 plan——保持 item↔plan 边界一致,契合 plan-guide 规则 4"一个结果面"。
- 与规则 4 的张力:若两个 roadmap item 实际共享同一 closure 结果面,1:1 会造成人为过拆 → 视为**roadmap 侧应合并这两个 item 的信号**,plan 边界始终等于 item 边界(不在 plan 侧打包)。
- 作用域:本要求作用于 **roadmap 来源**(`draft-from-roadmap.md`)。**audit 来源**(`draft-from-audit.md`)的 P0/P1 findings 打包规则本期**不变**(仍"1–3 plans、按 closure surface 拆分");若需 audit 侧也 1:1,需另行确认(记为待确认,不擅自扩展)。
- 残留风险:roadmap item 粒度不均会放大 plan 数量 → 由每轮 1–3 节流与"大 item 用多 Phase"缓解。

### D6 — E9 audit 产物机器级验证(独立复审发现:E9 覆盖不足)

- 选择:E9(audit 文件无存在/头部/类型/优先级机器验证)本期以**间接方式**解决——E8 修复后 audit prompt 契约保证头部为 `clean/triaged/open` + `Audit Type`;在 Phase 4 增加断言"audit prompt 输出头部契约"的测试;**完整的 audit 产物机器验证 step 予以 Deferred**,因为它需要新增 flow step,违反 Non-Goal"不新增 flow step"。
- 残留风险:非契约头部的畸形 audit 文件仍可能漏检 → 记入 Deferred But Adjudicated,触发条件为"真实运行中出现畸形 audit 产物导致误判"。

### D5 — 无缺陷驱动的 prompt(审计发现 C4,回归风险)

- 选择:`mission-brief.md`、`health-check.md` 无 E1–E14 证据,本期仅做 **align-only**(措辞/结构与最小契约对齐),**不改契约行为**、不改 marker 集。`plan-review.md` 因选项 B 升级为规范复审门 + D7 1:1 校验,单列于 Phase 2(非 align-only)。
- 理由:避免对当前可用 prompt 做无驱动重写引入回归。

## Execution Plan

### Phase 1 - flow/loader 确定性修复(先立确定性边,保持绿)

Status: completed
Targets: `tools/mission-driver/flows/plan-execution.json`、`flows/mission-driver.json`、`flows/deep-audit-loop.json`、`src/flow-loader.js`
Skill: `none`

- Item Types: `Fix`

- [x] `closureScriptCheck` 的 `catch` 分支也 `flowVars.set("SCRIPT_CHECK_RESULT","FAIL")` 与 `SCRIPT_CHECK_DETAILS`(消除异常时 `{{SCRIPT_CHECK_RESULT}}` 残留)。(Fix, E2 相关基础)
- [x] 给 `DRAFT_PLANS`、`DEEP_AUDIT` 内的 `CHECK_OPEN_AUDITS`/`SCAN_NEW_RESULTS`/`MULTI_AUDIT`/`OPEN_AUDIT` 增加 `fail` 承接(`done:"failed"`),使 P3 的诚实终止有落点;**仅新增 transition 边,不新增 step/标签类型**。(Fix, 支撑 P3)
- [x] 确认 `mission-driver.json` 的 `DEEP_AUDIT` 已有 `failed→DRAFT_PLANS`(现状如此),draft/audit 子流的 `fail`(`done:"failed"`)冒泡到主流 `failed` 语义一致。(Fix)
- [x] `plan-execution.json` 的 `CLOSURE_AUDIT.onMaxRetries` 由 `goto: BUILD_VERIFY` 改为 `done: "failed"`,使审计不收敛不被 BUILD_VERIFY 掩盖。(Fix, 复审发现 6D)

Exit Criteria:

- [x] 异常路径下 SCRIPT_CHECK 变量必被赋值(`test/closure-script-check.test.js` 断言,通过)。
- [x] 新增/修改的 transition 边不破坏现有路径(全套 599 测试通过)。
- [x] `pnpm --prefix tools/mission-driver test` 全绿(599 pass / 0 fail + prompt-check OK)。
- [x] `docs/logs/` 更新(与后续 phase 聚合到收尾一条)。

### Phase 2 - 12 prompt 重写为最小执行契约

Status: completed
Targets: `tools/mission-driver/prompts/*.md`
Skill: `none`
Prereqs: Phase 1(`fail` 边就位后 prompt 才能安全发 `fail`)

- Item Types: `Fix`(Phase 2 为 Fix-heavy:E1–E14 prompt 侧全部为缺陷修复)

- [x] `draft-from-audit.md`:`{{backlogDir}}`→复用 `{{roadmapPath}}` 的 `## Follow-up Backlog`;`created` 顺序 FLOW_VARS 前、marker 末尾;接入 `fail`;"内审"改为自查/预检不自升 active(选项 B/D4)。(Fix E1,E5,E10)
- [x] `draft-from-roadmap.md`:`created` marker 末尾;接入 `fail`;自查/预检不自升 active(选项 B/D4);**roadmap item↔plan 1:1**、大 item 拆多 Phase(D7)。(Fix E5,E10)
- [x] `closure-audit.md`:删除不可达 "SCRIPT PASS" 分支(E2);消除"ONLY marker" vs `<REMAINING>` 矛盾(E3);与 `strict:false` 预检对齐、不再复制 `--strict` 更强规则(E4);approved 仅证元数据漂移已修(D2)。(Fix E2,E3,E4)
- [x] `build-verify.md`:删除 Maven/Jira/固定模板/`{timestamp}`(E7);用 `{{commitFormat}}`;承担语义 closure + 最终命令 + 提交;发现代码问题重开 phase 后 `fail`→EXECUTE(E6);dirty-path baseline 保护;并承担 roadmap done/audit close/plan completed 翻转(状态所有权)。(Fix E6,E7)
- [x] `execute.md`:移除提前 roadmap done / 关 audit / 宣称 closure、不设 Plan Status completed(E14);记录 dirty-path baseline(D3)。(Fix E14)
- [x] `multi-audit.md` / `open-audit.md`:clean/triaged/open 三态头部(E8);接入 `fail`;有界抽样替代"全部读完"。(Fix E8)
- [x] `mission-draft.md`:删除冗余 `<AI_STEP_RESULT>created`(E12)。(Fix E12)
- [x] `run-postmortem.md`:删除装饰 `AI_STEP_RESULT`;放宽"What worked 2–5 项"(E13)。(Fix E13)
- [x] `mission-brief.md`/`health-check.md`:align-only,不改契约行为(D5)。`{{backlogDir}}` 经核实在 draft/brief 命令路径(main.js:403/467)已注入,非 bug,保留。(Fix — 措辞对齐)
- [x] `plan-review.md`:选项 B 规范复审门 + D7 1:1 校验(`> Work Item:` 存在=roadmap 来源做 1:1;缺=audit 来源豁免)。(Fix — 承接 D4/D7)

Exit Criteria:

- [x] 全文静态扫描无 E1–E14 残留(grep 确认 flow prompt 无 `{{backlogDir}}`/Maven/Jira/`{timestamp}`/不可达分支)。
- [x] 现有 `prompt-check.mjs`(未扩展前)仍通过(prompt-check OK)。
- [x] `pnpm --prefix tools/mission-driver test` 全绿(601 pass)。

### Phase 3 - prompt-check.mjs 扩展(与重写后 prompt 同落地)

Status: completed
Targets: `tools/mission-driver/src/prompt-check.mjs`
Skill: `none`
Prereqs: Phase 2(先重写再收紧,避免中途红)

- Item Types: `Fix | Add`

- [x] 校验:每个 flow-bound prompt 至少一个 in-contract marker(存在性);`created` 的 `<FLOW_VARS>`+`<PLAN_FILE>` 必须在 marker 之前(E10 顺序)。("唯一/末尾"操作化为 E10 顺序 + 存在性,避免对合法多结果 prompt(created/nothing/fail)误报)。(Add)
- [x] 校验:`created` 必带可解析 `FLOW_VARS/PLAN_FILE`;`issues` 必带 `REMAINING`。(Add,E11)
- [x] 校验:flow-bound prompt 的 `{{var}}` 属注入白名单 `FLOW_INJECTED_VARS`(捕获 E1 类失效变量;命令路径 prompt 非 flow-bound 故豁免)。(Add)
- [x] 补齐 forEach 步骤值校验到 transition∪alias 并集(D1);`approved` 经 alias 合法。(Fix,E11)
- [x] 新增项目泄漏扫描(Maven `-pl … -am`、Jira key 模板、字面量 `{timestamp}`)对全部 prompt。(Add,E7)

Exit Criteria:

- [x] 扩展后 linter 对重写后的 12 个内置 prompt 全部通过(`node src/prompt-check.mjs` OK)。
- [x] linter 对故意注入的每类缺陷样本报错(`test/prompt-check-extended.test.js` + 更新的 `prompt-markers.test.js` forEach 断言)。
- [x] `pnpm --prefix tools/mission-driver test` 全绿(608 pass)。

### Phase 4 - 四层静态与模拟回归

Status: completed
Targets: `tools/mission-driver/test/*.test.js`
Skill: `none`
Prereqs: Phase 1–3

- Item Types: `Proof`

- [x] Flow 模拟:结构 pins 断言 closure-pass 跳过 CLOSURE_AUDIT、script-fail→CLOSURE_AUDIT、CLOSURE_AUDIT.onMaxRetries→failed(6D)、Option B DRAFT→REVIEW_PLANS、DRAFT_PLANS/deep-audit 四步 fail→done:failed;engine sim 断言 DRAFT_PLANS `fail` 终止为 `failed`(不被洗成 nothing/completed);audit 三态经 `_scanOpenAuditsList` 仅计 `open`(triaged/clean 不计)。(Proof — `test/prompt-contract-flow-sim.test.js`)
- [x] Prompt 行为契约:linter 缺陷样本覆盖 created⇒FLOW_VARS 顺序、issues⇒REMAINING、forEach 值越界、backlogDir 非注入白名单(`test/prompt-check-extended.test.js`);closure-script-check 异常路径(`test/closure-script-check.test.js`)。注:纯 prompt 语义场景(owner source 冲突、语义证据红等)属模型运行期行为,以契约 marker + flow 结构 pin 静态代理,不做真实模型长跑(Non-Goal)。(Proof)
- [x] 调用数:Option B 经 iter-2 复审确认 happy-path = DRAFT 1 + REVIEW_PLANS 1 + EXECUTE 1 + BUILD_VERIFY 1,与需求 P5 口径一致;`forEach-marker-alias.test.js` 已断言 REVIEW_PLANS `approved`→all_complete 零 correction 调用(闭合 closure-pass 路径不新增调用)。(Proof)
- [x] 全套回归:`pnpm --prefix tools/mission-driver test` 615 pass / 0 fail + prompt-check OK;`git diff --check` 清洁。(Proof)

Exit Criteria:

- [x] 上述模拟/场景测试全部通过且断言到位(615 pass)。
- [x] `pnpm --prefix tools/mission-driver test` 全绿;`git diff --check` 无 whitespace 错误。
- [x] `mission-driver-flow-design.md`、`mission-driver-baseline.md`、`CONTEXT.md`(如需)同步;`docs/logs/{year}/{month}-{day}.md` 记录 full-green。(收尾阶段完成)

## Draft Review Record

- Independent draft review iteration 1 (subagent, fresh session): **NEEDS_REVISION**。发现:
  - (1A/1B) **D4 阻塞**:draft prompt 内的"independent sub-agent"是同一 agent step 内的自我编排,engine 无 session 隔离结构保障;"prompt 措辞级独立性"是否满足规则 13 存疑,降级 REVIEW_PLANS 实质是把 E5 绕过路径正式化。原"缓解=closure 记录"违反规则 13,已作废 → D4 改为 OPEN,列选项 A/B/C,须人工裁决;P2 中 D4 相关条目挂起。
  - (6D) `CLOSURE_AUDIT.onMaxRetries → BUILD_VERIFY` 与失败诚实冲突 → 已加 Phase 1 Fix 条目改为 `done:"failed"`。
  - (第3项) E9 audit 产物机器验证覆盖不足 → 已加 D6 显式裁决(间接解决 + Deferred 完整验证 step)。
  - Phase 排序每阶段绿论断成立(前置条件满足);D1/D2/D3/D5 合理;满足 one-plan-one-result-surface;验收标准可验证(6A-6C 可接受)。
- 状态:计划保持 `draft`。**阻塞项 D4 须人工裁决后**,方可将 D4 相关条目转入实施并把计划升为 `active`;其余(Phase 1 除挂起项、Phase 2 非 D4 条目、Phase 3/4)在 D4 裁决前逻辑上可推进,但按受控流程整体计划升 active 需 D4 收敛。
- 修订(2026-08-12,人工裁决):D4 定案为**选项 B**(保留 REVIEW_PLANS 为规范复审门,draft prompt 降为自查/预检);新增人工要求 **D7**(roadmap item↔plan 1:1)。相应更新 Goals、Phase 2(draft-from-roadmap/audit、plan-review)、Phase 4 断言、D5。
- Independent draft review iteration 2 (subagent, fresh session): **ACCEPT**。确认:选项 B 与现有 `DRAFT_PLANS(created)→REVIEW_PLANS(forEach draftPlans())→EXEC_PLANS` 流一致,**零 flow JSON 改动**(draft 保持 `draft` → `draftPlans()` 必选中 → plan-review fix-forward 升 active);D7 1:1 由 plan-review 读 `> Work Item:` 字段本地判定,可行;与 plan-guide 规则 4 无矛盾(大 item→多 Phase、共享 closure→上游合并 item);audit 来源不适用 1:1 边界清晰无漏洞;无遗留阻塞项。
  - 实施细节(采纳):plan-review.md 用 **`> Work Item:` 字段是否存在**区分 roadmap 来源(有=roadmap 来源,做 1:1 校验)vs audit 来源(无=不校验 1:1)。
- 状态:iteration-2 ACCEPT → 计划升 `active`,开始实施。

## Closure Gates

- [x] E1–E14 全部消除(静态扫描 + 独立审计逐条核实)
- [x] 状态所有权:EXECUTE 不再提前翻转;仅 BUILD_VERIFY 翻转 roadmap/audit/plan 终态
- [x] 失败诚实:draft/audit 步骤 `fail` 终止路径可达且不被掩盖(flow fail 边 → done:failed)
- [x] 自动提交安全:`{{commitFormat}}` + dirty-path 保护(build-verify.md 第 4 节)
- [x] 复审门归属:REVIEW_PLANS 为规范复审门(选项 B);draft prompt 不自升 active
- [x] Roadmap item↔plan 1:1(D7)由 plan-review.md 校验且有模拟测试覆盖
- [x] linter 扩展落地且内置 prompt 全通过(`node src/prompt-check.mjs` OK)
- [x] 四层回归全绿;调用数断言满足(prompt-contract-flow-sim + forEach-marker-alias)
- [x] `pnpm --prefix tools/mission-driver test` 全绿(616 pass,非 scoped)
- [x] `git diff --check` 干净
- [x] 需求文档 P2 段同步选项 B(REVIEW_PLANS 非零调用)+ 新增 1:1 规则(2026-08-12 决议更新块)
- [x] 独立草案复审完成并记录(D4=B、D7;iter1 NEEDS_REVISION → iter2 ACCEPT)
- [x] 文本一致性:status/phases/gates/log 一致(收尾调和)
- [x] 独立收尾审计(subagent,semantic_reviewer,fresh session)
- [x] closure 证据落盘;owner docs 同步(flow-design + baseline)

## Deferred But Adjudicated

### wall-clock 延迟实测

- Classification: `out-of-scope improvement`
- Why Not Blocking Closure: 本切片以调用数代理"延迟不退化";真实长跑延迟需积累真实轨迹后评估(需求 Non-Goals)。
- Successor Required: `no`(积累真实运行轨迹后再评估)

## Closure

Status Note: 全部 4 Phase 完成,E1–E14 契约缺陷经独立收尾审计逐条核实消除。flow/loader/prompt/linter 契约一致,616 tests pass + prompt-check OK + git diff --check 清洁。选项 B(REVIEW_PLANS 规范复审门)与 D7(roadmap 1:1)落地,失败诚实边就位,状态所有权归 BUILD_VERIFY。owner docs(flow-design、baseline)与 daily log 已同步。

Closure Audit Evidence:

- Auditor / Agent: 独立 subagent(`semantic_reviewer`,fresh session,未参与实施)
- 判定: PASS(实质完成)——E1–E14 全消除、状态所有权正确、失败诚实边落地(mission-driver DRAFT_PLANS + deep-audit 四步 + plan-execution CLOSURE_AUDIT.onMaxRetries → done:failed)、选项 B/D7 到位、linter 扩展有效、615→616 绿 + diff-check 干净。本审计构成规则 13 独立收尾审计证据。
- 采纳的审计建议:补 E7 泄漏正向注入测试(`prompt-check-extended.test.js`,+1 test → 616 pass);调和 log/plan 状态矛盾(本次收尾);工作树卫生——`src/engine.js` + `transient-error.test.js` 为 pre-existing dirty-path(session 起始即 modified,非本计划编辑,Phase targets 不含 engine.js),提交时须与本计划变更分开单独 commit。
- Verification: `pnpm --prefix tools/mission-driver test` → 616 pass / 0 fail + `prompt-check: OK`;`git diff --check` exit 0。

Follow-up:

- 无阻塞项。E9 完整 audit 产物机器验证 step 已按 D6 Deferred(触发条件:真实运行出现畸形 audit 产物导致误判);wall-clock 延迟实测 Deferred(积累真实轨迹后评估)。
