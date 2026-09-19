# PRD · Usage / Billing 只读查看

- 上游 issue：FEATURE-568（阶段 7）；包：`mobile`；分支：`feature/568-usage-billing`；目标分支：`main`
- 类型：中等（2 个新路由 + 3 个新域组件 + 2 个纯函数模块 + 数据层追加 8 个方法）

## 1. 背景与现状

web 端有两块「只读」的表面，移动端完全没有：

| web 位置 | 内容 | 数据来源 |
|---|---|---|
| `/{slug}/usage`（`packages/views/dashboard`） | Usage / Errors 两 tab：用量趋势、智能体榜单、失败构成与责任人 | 6 个 `GET /api/dashboard/*` rollup |
| `/{slug}/settings?tab=billing`（`packages/views/settings/components/billing-tab.tsx`） | 当前订阅、席位用量、配额、账单入口 | `GET /api/cloud-subscriptions/summary` 等 |

移动端现状：More 菜单（`apps/mobile/components/nav/more-tab-dropdown.tsx`）只有 Pinned / Issues / Projects；
`data/api.ts` 仅有一个 billing 方法（`getWorkspaceSubscriptionSummary`，被 inbox 的配额提示复用），
dashboard 六个端点一个都没实现。本任务补这两块**只读**视图，不改任何写路径。

## 2. 目标（可验收行为）

### 2.1 Usage 页 `more/usage`

- 顶部时间范围 pills：`7 / 30 / 90` 天（默认 30）。
- 页内 tab pills：`Usage` / `Errors`（默认 Usage）。
- **Usage tab**
  - 3 个 KPI 卡片：Tokens（副行 `Input x · Output y`）、Runs（副行 `n failed`）、Run time（副行 `Across n runs`）。
  - 趋势卡：metric pills `Tokens / Time / Runs`，按日画条形图（纯 `View` 实现，不引图表库），标题随 metric 变化（`Daily tokens` / `Daily run time` / `Daily runs`）；无数据时显示 `No usage in this window.`。
  - 智能体卡：按同一 metric 对智能体排名（取前 10），行内显示名称 + 数值 + 占比条 + 次要行（tokens/runs/时间）。
- **Errors tab**
  - 3 个 KPI 卡片：Failed runs（副行 `Of n runs`）、Failure rate（百分比）、Agents affected（副行 `Worst <name> · n`）。
  - 失败构成卡：7 个展示类（Auth / Rate limit / Timeout / Provider / Runtime / Agent / Other）按数量倒序，含占比条；空窗口显示 `No failed runs in this window.`。
  - 责任人卡：有失败的智能体按失败数倒序（取前 10），行内 `failed / runs / rate`；窗口内总运行数少于 10 的行加 `Fewer than 10 runs in this window — this rate is not meaningful.` 说明。
- 三态：加载（`ActivityIndicator`）、错误（`Couldn't load usage` + Try again）、空态；下拉刷新。

### 2.2 Billing 页 `more/billing`

- 功能开关 `billing_workspace_subscriptions` 关闭时：不请求、页内说明「Billing 未启用」。
- 订阅卡（只读行）：Plan、Status、Members、Billing interval（Monthly / Yearly）、Renews（周期结束日）。
- 状态提示（只读横幅）：`cancelAtPeriodEnd`、`past_due`、`incomplete`、`incomplete_expired`、`paused`、`unpaid`、`canceled`。
- 席位卡：Purchased、Billed / used、Reserved、Available；`overcommitted` 时给警示行。
- 配额卡：Issues（`used / limit`，unlimited 时显示 `Unlimited`）、Autopilot runs（`total / limit` + `used · reserved` 明细 + 重置时间；unlimited 显示 `Unlimited`；接口失败显示 `Usage unavailable` 并可重试）。
- 账单入口：`availableActions.portal === true` 时给一行按钮，用系统浏览器打开 web `/{slug}/settings?tab=billing`；否则显示「由工作区管理员在网页端管理」的说明文案。
- 三态：加载、错误（`Couldn't load billing` + Try again）、summary 为 null 的空态。

### 2.3 非目标（不做）

- 不做支付/结账、套餐变更、加席位、portal session 创建等任何写操作。
- Usage 不做 **Cost** 指标（依赖 `packages/views/runtimes/utils.ts` 的定价表与自定义定价偏好，移动端没有）；不做 `1d` / `180d` 范围；不做 weekly 粒度；不做 project 过滤；不做 error codes 明细展开；不做 CSV 导出；不做页面级时区标签与手动刷新按钮（用下拉刷新替代）。
- Billing 不做价格快照（prices）展示与价格重试。

## 3. 已核实的事实（编码依据）

| 事实 | 证据 |
|---|---|
| 六个 dashboard rollup：`GET /api/dashboard/usage/daily`、`usage/by-agent`、`agent-runtime`、`runtime/daily`、`failures/daily`、`failures/by-agent`；参数 `days` / `project_id` / `tz`；返回裸数组，无分页游标 | `packages/core/api/client.ts:2313-2413` |
| 六个响应的 zod schema 已存在且是纯 schema（mobile 白名单内） | `packages/core/api/schemas.ts:1606-1682` |
| 行类型：`DashboardUsageDaily` / `DashboardUsageByAgent` / `DashboardAgentRunTime` / `DashboardRunTimeDaily` / `DashboardFailureDaily` / `DashboardFailureByAgent` | `packages/core/types/agent.ts:995-1095` |
| `tz` 解析顺序：`?tz=` → `user.timezone` → `UTC`（非法值直接跳过） | `server/internal/handler/runtime.go` `resolveViewingTZ` |
| web 的时区取值 = `user.timezone ?? 浏览器时区` | `packages/views/common/use-viewing-timezone.ts:5-9` |
| 服务端按 `days` 返回 **N+1** 天日历余量，web 用 `dailyCutoffIso` 把按日序列裁回 `days` 天；per-agent rollup 由服务端按精确 `days` 收口，**不能再裁** | `packages/views/dashboard/components/dashboard-page.tsx:236-244,281-296` |
| `failure_reason === ""` 是**成功桶**（不是失败），错误率的分母与分子来自同一组过滤 | `packages/core/types/agent.ts:1053-1066`、`packages/views/dashboard/utils.ts:614-630` |
| 失败展示类 7 个及 reason→class 映射（含 `unclassified` 与 pre-MUL-1949 旧值） | `packages/core/dashboard/failure-class.ts:14-107` |
| 失败构成/责任人聚合语义：按数量倒序、零值类丢弃、无失败智能体丢弃、rate = failed/total | `packages/views/dashboard/utils.ts:632-710` |
| 小样本阈值 `MIN_RATE_SAMPLE = 10` 与 `hasRateSample` | `packages/views/dashboard/utils.ts:764-772` |
| 时长文案规则（`<1m` / `45s` / `12m 30s` / `1h 23m` / `2d 5h`，最多两段） | `packages/views/dashboard/utils.ts:504-530` |
| `computeDailyTotals` 的 taskCount 说明：按 (date, model) 求和会跨天重复计同一任务，KPI 只作「大致体量」 | `packages/views/dashboard/utils.ts:151-172` |
| billing summary 已有移动端方法（端点 `GET /api/cloud-subscriptions/summary`） | `apps/mobile/data/api.ts:436-445`、`apps/mobile/data/queries/billing.ts:16-38` |
| issue 配额用量 `GET /api/issues/limit-usage`（返回 `{used,limit}` 或 null） | `packages/core/api/client.ts:1404-1412`、`packages/core/types/billing.ts:242-245` |
| autopilot 配额 `GET /api/autopilots/usage`（`action/used/reserved/total/limit/reached/reset_at`，字段可空） | `packages/core/api/client.ts:4383-4405`、`packages/core/types/autopilot.ts:119-131` |
| autopilot 用量展示分支由 `resolveAutopilotUsage` 决定（unlimited / metered / unavailable，metered 要求 7 个字段全部非 null 且有限） | `packages/views/settings/components/billing-state.ts:22-70` |
| issue 配额文案：unlimited → `Unlimited`；`usage.limit === entitlement.limit` → `used / limit`；否则只显示 entitlement limit | `packages/views/settings/components/billing-tab.tsx:819-827` |
| 账单 portal 行只在 `availableActions.portal === true` 时出现 | `packages/views/settings/components/billing-tab.tsx:1161-1188` |
| 席位卡只在 `seatCapacity != null` 时出现；席位字段 `purchased/used/reserved/available/overcommitted/pendingQuantity` | `packages/views/settings/components/billing-tab.tsx:1284-1290`、`packages/core/types/billing.ts:246-262` |
| 功能开关名 `billing_workspace_subscriptions`；移动端门禁写法（config flag → 查询 enabled） | `packages/core/feature-flags/keys.ts:3-4`、`apps/mobile/app/(app)/[workspace]/inbox/[id].tsx:81-98` |
| 移动端 GET 统一走 `fetchValidated(path, schema, fallback, {signal, endpoint})`；schema 从 `@multica/core/api/schemas` 运行时导入是既有做法 | `apps/mobile/data/api.ts:352-378,64-83` |
| 移动端单测只覆盖 `lib/**` 与 `data/**` 的 node 环境用例 | `apps/mobile/vitest.config.ts` |
| More 菜单入口清单是 `NAV_ITEMS`（Pinned / Issues / Projects），新增入口在此追加 | `apps/mobile/components/nav/more-tab-dropdown.tsx:79-95` |
| `more/*` 路由需在 workspace Stack 注册（含 title / headerBackTitle） | `apps/mobile/app/(app)/[workspace]/_layout.tsx:349-383` |
| 移动端文案为硬编码英文，无 i18n 基础设施 | `apps/mobile/components/nav/more-tab-dropdown.tsx:79-95`、`lib/failure-reason-label.ts` 注释 |

## 4. 验收条件

1. More 菜单出现 `Usage` 与 `Billing` 两项，可分别打开两个页面；深链 `/{slug}/more/usage`、`/{slug}/more/billing` 也能打开（route 已注册、标题正确）。
2. Usage 页按 §2.1 渲染：范围/页签/metric 切换生效，KPI 与趋势、榜单数值来自对应 rollup，窗口按 `days` 裁剪后的按日序列计算（与服务端 N+1 余量对齐）。
3. Errors 页数据结构正确：`failure_reason === ""` 计入分母不计入失败；7 类折叠完整（未知 reason 落到 Other）；责任人列表按失败数倒序且小样本有说明。
4. Billing 页按 §2.2 渲染；开关关闭时不发请求；portal 不可用时给出替代文案；账单入口用系统浏览器打开 web billing 页。
5. 纯函数有单测：窗口裁剪（`todayIso` / `addDaysIso` / cutoff 过滤）、token/时长/任务聚合、失败 totals/classes/agents 聚合（含成功桶、未知 reason）、时长与数量格式化。
6. `pnpm --filter @multica/mobile typecheck`、`lint`、`test` 全绿；**不自行启动模拟器**，真机/模拟器视觉验收交用户自测，交付评论中明确区分静态验证与设备验收。

## 5. 风险与边界

- 同阶段 FEATURE-566（in_progress）同样改 `apps/mobile/app/(app)/[workspace]/_layout.tsx` 与 `data/api.ts`：本任务只做**尾部追加**与相邻注册，冲突面限定在这两处，合并时按 main 现状解决。
- 本任务不引入新依赖；条形图用 `View` 宽度百分比实现，避免 `react-native-svg` 之类的额外原生依赖。
- More 菜单项目变多（+2）后仍要保持 `w-72` 内的可读性（现 3 项 → 5 项）。
