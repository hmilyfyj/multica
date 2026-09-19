# Implement · Agents 只读视图

按序执行；每步完成后文件可编译。

1. **纯函数模块**：新建 `apps/mobile/lib/agent-runs.ts`
   - `ACTIVE_TASK_STATUSES`（queued / dispatched / waiting_local_directory / running）
   - `splitAgentTasks(tasks)` → `{ active, past }`，active 按 `created_at` 倒序，past 按 `completed_at` 倒序（并列用终态排序权重：failed < cancelled < completed）
   - `latestActivityAt(tasks)` → 该 agent 最近一次活动的 ISO 字符串（`completed_at ?? created_at` 的最大值），无任务 → `null`
   - `runDurationMs(task, now)` / `runDurationLabel(task, now)`（`undefined` 表示无法计算）
2. **单测**：新建 `apps/mobile/lib/agent-runs.test.ts`，覆盖分桶边界（`waiting_local_directory` 属活跃）、终态排序、最近活动取数、耗时（进行中 / 终态 / 缺 `started_at` / 终态缺 `completed_at`）。
3. **数据层追加**（只追加，不动既有方法）：
   - `apps/mobile/data/api.ts`：`listAgentTasks(agentId, opts?)`，用 `fetchValidated` + 既有 `AgentTaskListSchema` / `EMPTY_AGENT_TASK_LIST`，`endpoint: "GET /api/agents/:id/tasks"`。放在 `listAgentTaskSnapshot` 之后。
   - `apps/mobile/data/queries/agents.ts`：`agentTasksOptions(wsId, agentId)`，键 `["agents", wsId, "tasks", agentId]`（挂在既有 `["agents", wsId]` 前缀下，`agent:*` 事件会一并失效）。
   - `apps/mobile/data/queries/agents.test.ts`：补 `agentTasksOptions` 的 queryKey / `enabled` 断言。
4. **域组件**：`apps/mobile/components/agents/` 下新建
   - `agent-presence-line.tsx`：`PresenceDot` + availability/workload 文案 + `running/capacity`（可选 `compact`）
   - `agent-row.tsx`、`agent-detail-header.tsx`、`agent-facts-section.tsx`、`agent-runs-section.tsx`
5. **列表路由**：重写 `apps/mobile/app/(app)/[workspace]/more/agents.tsx`
6. **详情路由**：新建 `apps/mobile/app/(app)/[workspace]/more/agents/[id].tsx`
7. **路由注册**：`apps/mobile/app/(app)/[workspace]/_layout.tsx` 在 `more/agents` 之后追加 `more/agents/[id]`（`title: "Agent"`、`headerBackTitle: "Agents"`，屏幕内用实际名称覆盖）

## 验证

```bash
# 迭代中（仅本条纯模块）
corepack pnpm exec vitest run --config apps/mobile/vitest.config.ts apps/mobile/lib/agent-runs.test.ts

# 收尾一次（改完、commit 前）
rtk err -- ./node_modules/.bin/prettier --check apps/mobile
rtk err -- corepack pnpm --filter @multica/mobile typecheck
rtk err -- corepack pnpm --filter @multica/mobile lint
rtk test -- corepack pnpm --filter @multica/mobile test
```

设备侧视觉验收不自行启动模拟器，交用户真机自测；交付评论写明。
