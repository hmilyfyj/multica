# Design · Usage / Billing 只读查看

## 1. 数据流

```
Usage  more/usage.tsx
  ├─ range (7/30/90) + tab (usage/errors) + metric (tokens/time/runs)   ← 页面内 useState
  ├─ useQuery(dashboardUsageDailyOptions(wsId, days, tz))       → DashboardUsageDaily[]
  ├─ useQuery(dashboardRunTimeDailyOptions(wsId, days, tz))     → DashboardRunTimeDaily[]
  ├─ useQuery(dashboardUsageByAgentOptions(wsId, days, tz))     → DashboardUsageByAgent[]
  ├─ useQuery(dashboardAgentRunTimeOptions(wsId, days, tz))     → DashboardAgentRunTime[]
  ├─ useQuery(dashboardFailuresDailyOptions(wsId, days, tz))    → DashboardFailureDaily[]
  ├─ useQuery(dashboardFailuresByAgentOptions(wsId, days, tz))  → DashboardFailureByAgent[]
  └─ useQuery(agentListOptions(wsId))                           → agent_id → 名称映射

Billing  more/billing.tsx
  ├─ useQuery(appConfigOptions())                                   → feature flag 判定
  ├─ useQuery(workspaceSubscriptionSummaryOptions(wsId, enabled))   → WorkspaceSubscriptionSummary | null
  ├─ useQuery(issueLimitUsageOptions(wsId, enabled))                → IssueLimitUsage | null
  └─ useQuery(autopilotQuotaUsageOptions(wsId, enabled))            → AutopilotQuotaUsage | null
```

六个 dashboard 查询按 tab 门控（Usage tab 取前四个，Errors tab 取后两个），避免手机上一次性并发六个请求；
切 tab 时懒加载。这与 web「全部预取换瞬时切换」是刻意的移动端取舍，语义（参数、窗口、聚合）不变。

## 2. 文件与职责

| 文件 | 类型 | 职责 |
|---|---|---|
| `apps/mobile/lib/usage-stats.ts` | 新增（纯） | 窗口日期工具（`todayIso` / `addDaysIso` / `windowCutoffIso`）、日序列聚合（tokens / run time / runs）、窗口总量、按智能体聚合、失败 totals / classes / agents 聚合、数量与时长格式化 |
| `apps/mobile/lib/usage-stats.test.ts` | 新增 | 上述纯函数的单测 |
| `apps/mobile/lib/failure-class.ts` | 新增（纯） | 镜像 `packages/core/dashboard/failure-class.ts` 的 7 类 + reason→class 映射 + 英文类名标签（mobile 不能从 `packages/views` / core 的 dashboard index 运行时导入） |
| `apps/mobile/lib/failure-class.test.ts` | 新增 | 映射覆盖：已知 reason 归类、未知 reason → Other、`""`（成功桶）调用点不使用它 |
| `apps/mobile/data/api.ts` | 追加 | 6 个 dashboard 方法 + `getIssueLimitUsage` + `getAutopilotQuotaUsage` |
| `apps/mobile/data/queries/usage.ts` | 新增 | `dashboardKeys` + 6 个 `queryOptions` |
| `apps/mobile/data/queries/usage.test.ts` | 新增 | 键前缀嵌套与 `enabled` 断言（照 `data/queries/agents.test.ts`） |
| `apps/mobile/data/queries/billing.ts` | 追加 | `issueLimitUsageOptions`、`autopilotQuotaUsageOptions`（挂进既有 `workspaceSubscriptionKeys` 前缀） |
| `apps/mobile/components/usage/stat-tile.tsx` | 新增 | KPI 卡片（label / value / hint） |
| `apps/mobile/components/usage/daily-bar-chart.tsx` | 新增 | 按日条形图（纯 `View`，bar 高度按窗口最大值归一，首尾日期标签） |
| `apps/mobile/components/usage/share-row.tsx` | 新增 | 「名称 + 值 + 占比条 + 次行」行（失败构成、两个榜单共用） |
| `apps/mobile/app/(app)/[workspace]/more/usage.tsx` | 新增 | Usage 路由（两 tab + 三态 + 下拉刷新） |
| `apps/mobile/app/(app)/[workspace]/more/billing.tsx` | 新增 | Billing 路由（只读分区 + 状态横幅 + 账单入口） |
| `apps/mobile/app/(app)/[workspace]/_layout.tsx` | 追加 | `<Stack.Screen name="more/usage" \| "more/billing">` |
| `apps/mobile/components/nav/more-tab-dropdown.tsx` | 追加 | `NAV_ITEMS` 追加 Usage / Billing 两项 |

Billing 页的分区/只读行保持为路由文件内的私有子组件，沿用 `more/settings.tsx` 的 `SectionGroup` + `NavRow` 既有形态，不再新增通用原语。

## 3. 关键决策

1. **时区参数**：移动端显式传 `tz = user.timezone?.trim() || Intl 设备时区 || 不发该参数`，与 web `useViewingTimezone()`
   的取值顺序一致；服务端 `resolveViewingTZ` 在缺参数时回退 `user.timezone` → `UTC`，所以设备时区解析失败时省略参数仍得到合理桶。
   `Intl` 已在本仓 `lib/inbox-display.ts` 使用，无需新依赖。
2. **窗口裁剪**：服务端按 `days` 返回 N+1 天余量，按日序列（tokens / run time / runs / failures）在客户端用
   `date >= addDaysIso(todayIso(tz), -(days - 1))` 裁回 `days` 天；per-agent rollup（usage/by-agent、agent-runtime、failures/by-agent）
   由服务端按精确 `days` 收口，**不裁**——与 web `dashboard-page.tsx:236-244` 的约束一致，否则 KPI 会比旁边的图宽一天。
3. **成功桶**：`failure_reason === ""` 只进分母。失败构成与责任人聚合只在 `reason !== ""` 时累加失败数；
   类折叠对未知 reason 一律落 `other`，保证类合计与失败总数对得上。
4. **失败 KPI 的口径**：Totals / Classes 从**按日**失败序列（裁剪后）算，Agents affected 从 per-agent 序列算——
   与 web 相同，因为 per-agent 序列没有日期可裁，只有按日序列能裁到与图一致。
5. **不做 Cost**：成本要 `packages/views/runtimes/utils.ts` 的定价表 + 自定义定价偏好（web store），
   移动端没有也不该引入；KPI/趋势/榜单的 metric 集合因此是 `Tokens / Time / Runs`。
6. **`client_os` 等实时层无关**：两页都是纯查询页，不新增 WS 订阅（rollup 由服务端 5 分钟粒度materialize，
   web 也只是 5 分钟重拉 + 手动刷新；移动端用下拉刷新）。
7. **Billing 开关门禁**：与 web 一致 fail-closed —— flag 关闭时不发任何订阅请求，页内给出说明。
   `summary === null` 视为「无订阅信息」空态，不臆造 Free。
8. **账单入口**：web 走 `POST /api/cloud-subscriptions/portal-sessions` 换 Stripe URL（写操作、单次性），
   移动端只读范围内改为系统浏览器打开 web billing 页，复用 inbox 已有写法
   （`EXPO_PUBLIC_WEB_URL` + `/{slug}/settings?tab=billing`）；仅在 `availableActions.portal === true` 时给按钮。

## 4. 纯函数契约（`lib/usage-stats.ts`）

```ts
todayIso(tz: string): string                       // en-CA 格式化 → "YYYY-MM-DD"
addDaysIso(iso: string, days: number): string
windowCutoffIso(days: number, tz: string): string  // addDaysIso(todayIso(tz), -(days - 1))

dailyTokenSeries(rows: DashboardUsageDaily[]): { date: string; value: number }[]   // 按日 input+output+cacheR+cacheW，date 升序
dailyRunTimeSeries(rows: DashboardRunTimeDaily[]): { date: string; value: number }[]
dailyRunSeries(rows: DashboardRunTimeDaily[]): { date: string; value: number }[]
usageTotals(rows: DashboardUsageDaily[]): { tokens: number; cacheTokens: number; runs: number; }   // runs = Σ task_count
runTimeTotals(rows: DashboardAgentRunTime[]): { seconds: number; runs: number; failed: number; }
usageByAgent(rows: DashboardUsageByAgent[]): { agentId: string; tokens: number; runs: number }[]   // tokens 倒序

failureTotals(rows: { failure_reason: string; task_count: number }[]): { failed: number; total: number; rate: number }
failureClassRows(rows: …): { failureClass: FailureClass; count: number }[]           // 倒序、零值丢弃
agentFailureRows(rows: DashboardFailureByAgent[]): { agentId: string; failed: number; runs: number; rate: number }[]  // failed 倒序、无失败丢弃
hasRateSample(row: { runs: number }): boolean      // runs >= MIN_RATE_SAMPLE

formatCompactNumber(n: number): string             // 1.2K / 3.4M / 5.6B
formatPercent(rate: number): string                // 1 位小数
formatDuration(seconds: number): string            // <1m / 45s / 12m 30s / 1h 23m / 2d 5h
```

`windowCutoffIso` 的调用点在页面里对按日数据做一次 filter，per-agent 数据直接用。

## 5. 关键决策：不镜像的部分

| web 行为 | 移动端 | 原因 |
|---|---|---|
| Cost 指标 + 定价表 | 不做 | 需 runtimes 定价表与自定义定价偏好，移动端无 |
| 1d / 180d / weekly 粒度 | 不做 | 手机宽度放不下 weekly 桶，1d 的趋势无信息量 |
| project 过滤 | 不做 | 需额外项目选择器；移动端子集先固定全工作区 |
| error codes 明细展开 | 不做 | 需二级展开 + 原始 reason 文案，先给类聚合 |
| 时区标签 + 手动刷新按钮 | 下拉刷新替代 | 移动端手势已是主路径 |
| 全量预取六个 rollup | 按 tab 门控 | 手机并发/流量取舍，语义不变 |
| Billing prices / 结账 / 加席位 | 不做 | 只读边界 |
