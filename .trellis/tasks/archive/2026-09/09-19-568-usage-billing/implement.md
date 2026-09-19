# Implement · Usage / Billing 只读查看

按序执行；每步完成后文件可编译。

1. **纯函数模块**：新建 `apps/mobile/lib/usage-stats.ts`
   - 日期窗口：`todayIso(tz)`（`Intl.DateTimeFormat("en-CA", { timeZone: tz })`，非法时区回退 UTC）、`addDaysIso`、`windowCutoffIso(days, tz)`
   - 聚合：`dailyTokenSeries` / `dailyRunTimeSeries` / `dailyRunSeries`（date 升序）、`usageTotals`、`runTimeTotals`、`usageByAgent`
   - 失败：`failureTotals`（`""` 进分母）、`failureClassRows`、`agentFailureRows`、`hasRateSample`（`MIN_RATE_SAMPLE = 10`）
   - 格式化：`formatCompactNumber`、`formatPercent`、`formatDuration`（规则照 `packages/views/dashboard/utils.ts:504-530`）
2. **纯函数单测**：新建 `apps/mobile/lib/usage-stats.test.ts`，覆盖窗口裁剪边界（含跨月/跨年、时区差）、按日聚合排序、总量、失败成功桶、类折叠与倒序、责任人过滤与排序、小样本阈值、格式化边界（0 / <1 / <60 / 小时 / 跨天）。
3. **失败分类镜像**：新建 `apps/mobile/lib/failure-class.ts`（`FAILURE_CLASSES` / `FailureClass` / `failureClassOf` / `FAILURE_CLASS_LABEL`），映射逐条照抄 `packages/core/dashboard/failure-class.ts:38-95`，并在文件头说明为何镜像（core 未导出该子路径，且 mobile 不引 `packages/views`）。配套 `failure-class.test.ts`：每类至少一个 reason、未知 reason → `other`、旧值 `agent_error`/`manual` → `other`。
4. **数据层追加**（只追加）：
   - `apps/mobile/data/api.ts`：`getDashboardUsageDaily` / `getDashboardUsageByAgent` / `getDashboardAgentRunTime` / `getDashboardRunTimeDaily` / `getDashboardFailuresDaily` / `getDashboardFailuresByAgent`（`fetchValidated` + `@multica/core/api/schemas` 的对应 List schema + `[]` fallback），
     `getIssueLimitUsage`（`IssueLimitUsageSchema`）、`getAutopilotQuotaUsage`（`AutopilotQuotaUsageSchema` + 全 null fallback）。
     查询串用 `URLSearchParams` 构造，`days` 必传，`project_id` / `tz` 有值才带。
   - `apps/mobile/data/queries/usage.ts`：`dashboardKeys`（`["dashboard", wsId, kind, days, tz]`）+ 6 个 `queryOptions`，`enabled: !!wsId`，`staleTime: 60_000`，`refetchInterval: 300_000`。
   - `apps/mobile/data/queries/usage.test.ts`：断言 key 前缀嵌套、`enabled` 开关、`days`/`tz` 进入 key。
   - `apps/mobile/data/queries/billing.ts`：`issueLimitUsageOptions(wsId, enabled)`、`autopilotQuotaUsageOptions(wsId, enabled)`（挂 `workspaceSubscriptionKeys` 前缀）。
5. **域组件**：`apps/mobile/components/usage/` 新建 `stat-tile.tsx`、`daily-bar-chart.tsx`、`share-row.tsx`。
6. **Usage 路由**：新建 `apps/mobile/app/(app)/[workspace]/more/usage.tsx`
   - range pills（7/30/90）+ tab pills（Usage/Errors）+ metric pills（Tokens/Time/Runs，仅 Usage tab）
   - Usage tab：3 KPI + 趋势卡 + 智能体卡；Errors tab：3 KPI + 失败构成卡 + 责任人卡
   - 三态（加载 / 错误重试 / 空态）+ `RefreshControl`
7. **Billing 路由**：新建 `apps/mobile/app/(app)/[workspace]/more/billing.tsx`
   - flag 门禁 → summary / issue limit / autopilot quota 三个查询
   - 状态横幅、订阅卡、席位卡、配额卡、账单入口（`Linking.openURL`）
   - 三态 + `RefreshControl`
8. **路由注册**：`apps/mobile/app/(app)/[workspace]/_layout.tsx` 在 `more/pins` 之后追加 `more/usage`（`title: "Usage"`）与 `more/billing`（`title: "Billing"`），`headerBackTitle: "Back"`。
9. **More 菜单入口**：`apps/mobile/components/nav/more-tab-dropdown.tsx` 的 `NAV_ITEMS` 追加
   `{ label: "Usage", sf: "chart.bar", ion: "bar-chart-outline", path: "/more/usage" }`、
   `{ label: "Billing", sf: "creditcard", ion: "card-outline", path: "/more/billing" }`。

## 验证

```bash
# 迭代中（仅新增纯模块与数据层）
rtk test -- corepack pnpm exec vitest run --config apps/mobile/vitest.config.ts apps/mobile/lib/usage-stats.test.ts apps/mobile/lib/failure-class.test.ts apps/mobile/data/queries/usage.test.ts

# 收尾一次（改完、commit 前）
rtk err -- ./node_modules/.bin/prettier --check apps/mobile
rtk err -- corepack pnpm --filter @multica/mobile typecheck
rtk err -- corepack pnpm --filter @multica/mobile lint
rtk test -- corepack pnpm --filter @multica/mobile test
```

设备侧视觉验收不自行启动模拟器，交用户真机自测；交付评论写明区分。
