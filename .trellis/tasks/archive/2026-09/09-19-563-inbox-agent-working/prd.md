# 收件箱展示「智能体正在工作」状态（参考网页端）

## Goal

mobile 收件箱列表按 **web 收件箱行的口径** 展示「智能体正在工作 / 排队中」，深浅两套主题都可读；
状态随 WS 事件收敛，不需要手动刷新。对应 issue FEATURE-563（第 1 波牵头任务）。

## 已核实事实（读 web 实现 + 后端代码）

三件事（字段 / 事件 / 何时结束）：

1. **哪个字段表达「正在工作」**：不是收件箱条目自身的字段，而是 **workspace 级 agent task snapshot**。
   - web 收件箱行渲染 `packages/views/issues/components/issue-agent-activity-indicator.tsx`
     （`packages/views/inbox/components/inbox-list-item.tsx` 里以 `hoverCard={false}` 使用）：
     - `≥1 个 running` → 头像栈 + shimmer 文案 `agent_activity.status_running`（"Working" / "正在工作"）
     - `0 running 且 ≥1 queued` → 半透明头像栈 + 次级色 `status_queued`（"Queued" / "排队中"）
     - 都没有 → 渲染 `null`（不占位）
   - 分组逻辑在 `packages/views/issues/surface/activity.ts` 的 `selectIssueTasks`：`running` 一桶；
     `queued | dispatched | waiting_local_directory` 一桶（后者是 daemon 的「本地目录被占」停放态）；
     **终态（completed / failed / cancelled）丢弃**。
   - 数据来源 `packages/core/agents/queries.ts` 的 `agentTaskSnapshotOptions`（`GET /api/agent-task-snapshot`）。
     后端 `server/pkg/db/queries/agent.sql:2617` 的 `ListWorkspaceAgentTaskSnapshot` 返回
     **全部 active（queued/dispatched/running/waiting_local_directory）+ 每个 agent 最近一条 completed/failed**。
     ⚠ 后半段带 issue_id，因此前端必须按状态过滤，否则历史终态会点亮徽标。
   - 因此：**mobile 的 inbox 查询 / schema / api 无需改字段**，复用已有的
     `apps/mobile/data/queries/agent-task-snapshot.ts` 即可。

2. **哪条 WS 事件驱动它变化**：`task:*` 生命周期事件（`task:queued / dispatch / running /
   waiting_local_directory / completed / failed / cancelled`）→ 失效 snapshot 查询。
   - web：`packages/core/realtime/use-realtime-sync.ts:909` 按 `task:` 前缀失效
     `agentTaskSnapshotKeys.list(wsId)`；`task:progress` / `task:message` 故意不订阅（抖动）。
   - 其中 `task:running` 是关键：后端 `server/internal/service/task.go:4152` 明确写到
     「(dispatched | waiting_local_directory) → running 的广播，就是为了让区分 queued/running 的 UI
     （例如 issue 卡片的 activity 指示器）不至于滞后 30s」。`server/pkg/protocol/events.go:36` 同义。
   - **mobile 现状缺口**：`data/realtime/use-presence-realtime.ts` 订阅了 queued/dispatch/completed/
     failed/cancelled，**唯独没有 `task:running`**（`use-issue-realtime.ts` 也没有）。照现状实现，徽标会
     在整轮运行里停在「排队中」。本任务独占 `use-inbox-realtime.ts`，在该文件内补齐到完整生命周期。

3. **何时结束**：`task:completed / failed / cancelled` 使任务离开 active 集合 → 徽标消失；
   连接断开期间漏掉的帧由 `onReconnect` 补偿。

## Requirements

1. 新增 mobile 侧的纯派生（镜像 web `surface/activity.ts`）：按 issue 过滤 snapshot →
   running / queued 分桶 → 选主桶（优先 running）→ 去重 agent id → 文案映射。
2. `apps/mobile/components/inbox/inbox-row.tsx` 在底部行 `[详情标签] [徽标] [时间]` 位置渲染徽标
   （与 web 一致：徽标在时间之前）；无 active 任务时不渲染任何元素。
3. 视觉：running = 头像栈 + `PulseDot`（mobile 既有的「活着」信号，web 用文字 shimmer，RN 无法做
   background-clip:text）+ 品牌色文案；queued = 半透明头像栈 + 次级色文案。
   颜色只用语义令牌（`text-brand` / `text-muted-foreground`），深浅两套自动成立。
4. 实时：在 `data/realtime/use-inbox-realtime.ts` 订阅 task 生命周期事件失效 snapshot，
   并纳入 `onReconnect`。
5. 不改其它域；不动 `data/realtime/` 其它文件（FEATURE-564 正在改）。

## Acceptance Criteria

- [ ] `apps/mobile/lib/issue-activity.ts` 覆盖：running 优先；dispatched/waiting_local_directory 归排队；
      终态丢弃；空 issue_id（chat/autopilot 任务）与不匹配 issue 不点亮；同 agent 多任务只出一个头像；
      头像上限 3；文案分别等于 "Working" / "Queued"。
- [ ] `pnpm -C apps/mobile typecheck` / `lint` / `test` 通过。
- [ ] 不自行启动模拟器（用户对模拟器次数有明确要求）；设备验收交用户真机自测，交付里写清真机自测步骤
      （含「去 web 触发一次任务 → 观察手机收件箱行从排队中翻到正在工作」的判据）。
- [ ] 结论写清 web 口径三件事的取证位置与 mobile 的差异点。

## Boundaries

- 只做「展示 + 必要的取数 + 该展示自己的实时收敛」；不动收件箱其它交互、筛选、归档。
- 不新增端点、不改 `data/api.ts`、不改 `/api/agent-task-snapshot` 契约。
- 不引入 i18n（mobile 目前英文单语，与 `AgentActivityRow` 的 "Working" 一致）。
- 不改 `packages/core`、不改 web/desktop。

## Notes

- 若后续发现平台约束（例如 PulseDot 在列表内的渲染成本）写回
  `.trellis/spec/mobile/frontend/android-platform.md`。
