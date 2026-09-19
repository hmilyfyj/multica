# WS 事件订阅补齐：mobile 缺口事件对照与补齐

来源：Multica FEATURE-564（阶段 7）。目标是减少「别人改了数据、手机端不刷新」的体感问题。

## Goal

以 web/desktop 的实时口径为基准（`packages/core/realtime/use-realtime-sync.ts` 的逐事件 handler + `onAny` 前缀泛化刷新），核对 `apps/mobile/data/realtime/**` 的订阅覆盖，**产出完整对照表**，并补齐 mobile 侧确实存在消费方（query/渲染面）的缺口事件；对没有消费方的事件给出「不补」的证据与理由，而不是造无效订阅。

## 已核实事实（读代码得出，非推测）

- 事件名单：`packages/core/types/events.ts` 的 `WSEventType` 共 **79** 类。
- web 覆盖 **79/79**：46 类显式 `ws.on(...)` + `refreshMap` 前缀泛化（`inbox/agent/member/workspace/skill/project/squad/label/issue_status/pin/daemon/task/pull_request/github_installation/...`），`specificEvents` 中的事件跳过前缀路径。
- origin/main（已含并行任务 FEATURE-563 合并的 inbox hook）现有显式订阅 **47** 类（`ws.on`，分布在 use-inbox/use-issue/use-issues/use-my-issues/use-chat-session/use-chat-sessions/use-project/use-projects/use-pins/use-presence），缺口 **32** 类 —— 任务描述里的「缺 22 类」是粗估，实际按 79 全集差集为 32（明细见 `design.md`）。
- mobile 无 `onAny` 业务分发：`ws.onAny` 只被 `realtime-provider.tsx` 用于「有一帧到达」的取证记录。
- mobile 没有 invitation / skill / subscriber / issue-properties / github-installation / pull_request 的 API、query 与路由（`rg -ci invitation apps/mobile` 命中 0；`data/api.ts` 无对应方法）。
- `member:added` 是「我入组」到达客户端的通道：服务端接受邀请时先播 `member:added` 再播 `invitation:accepted`（`server/internal/handler/invitation.go:597,600`），因此 mobile 只需订阅 `member:added`。
- `[workspace]/_layout.tsx` 已用 `workspaceListOptions()` 校验成员关系，`!matched` 时 `Redirect /select-workspace`；因此「被移出工作区 / 工作区被删」只需失效 `["workspaces"]`，不必新增导航代码。
- `workspace:updated` 不改 slug（`updateWorkspace` SQL 只改 name/description/context/settings/repos/issue_prefix/avatar_url，`server/pkg/db/generated/workspace.sql.go:433`）。

## Requirements

1. 产出一张对照表：`事件名 | web 行为（invalidate 哪些 query） | mobile 现状 | 补齐后`，覆盖 32 个缺口事件。
2. 补齐 mobile 有消费方的缺口：workspace / member / squad / label / issue_status / chat:cancel_finalized（13 类）。
3. 刷新口径复用 web 的域语义（按域 invalidate 对应 mobile key），不自造刷新策略；mobile 已有的 patch 优先约定（`apps/mobile/AGENTS.md` Realtime 段）保持不变。
4. 不做过度刷新：同一事件不得触发全量 `invalidateQueries()` sweep，也不得连带刷新 web 刷新而 mobile 不渲染的域（示例：label 事件在 mobile 不刷 agents/skills）。
5. 无消费方的缺口事件明确「不补」并写明证据（API/query/路由缺失）。`task:running` / `task:waiting_local_directory` 已由 FEATURE-563 合并的 inbox hook 覆盖（同一 `agent-task-snapshot` key），本次不重复订阅，并在对照表注明。
6. 为「事件 → invalidate 映射」补单测（沿用现有 mock `useWSSubscriptions` + 断言 invalidate key 的写法）。

## Boundaries

- 只动 `apps/mobile/data/realtime/**`；不改 `data/api.ts`，不改 UI 组件，不改 `packages/core/**`（web/desktop 行为不变），不新增事件类型。
- **不改 `data/realtime/use-inbox-realtime.ts`**（FEATURE-563「收件箱展示智能体工作状态」并行修改）。
- 例外且已在结论中说明：新增 hook 必须在 `RealtimeSubscriptions`（`app/(app)/[workspace]/_layout.tsx`）挂载，否则订阅不生效；该文件只加 import + 两行调用，符合 `apps/mobile/AGENTS.md`「Add new realtime feature hooks here as they land」。
- 不自行启动模拟器；真机/跨端验收交用户（FEATURE-558 阶段）。

## Acceptance Criteria

- [x] 对照表覆盖全部 32 个缺口事件，其中补齐 13 类、由并行任务已覆盖 2 类、明确不补 19 类（每类给出理由）。核验：`design.md` 对照表 34 行 = 13 补齐 + 2 已由 FEATURE-563 覆盖 + 19 不补，32 = 13 + 19 缺口，每行均给出理由。
- [x] 补齐后 mobile 覆盖率 47 → 60/79；不补的 19 类全部有无消费方证据。核验：`design.md`「基准与计数」段。
- [x] 新订阅全部经 `RealtimeSubscriptions` 挂载，且都带 `onReconnect` 刷新。核验：`app/(app)/[workspace]/_layout.tsx:136-137` 挂载 `useWorkspaceRealtime` / `useCatalogsRealtime`；4 个相关 hook 均含 `onReconnect`。
- [x] 单测覆盖：每个补齐事件 → 精确 invalidate key 集合（同时证明没有多刷其他 key）。核验：4 个 realtime 测试文件共 13 例。
- [x] `pnpm --filter @multica/mobile typecheck` / `lint` / `test` 通过。核验：typecheck 通过、lint 0 error、vitest 476 例通过。
- [x] 结论写清「本地静态验证」与「未做的真机/跨端验证」的边界。核验：`implement.md` 验证命令段与交付记录。

## Notes

- 新增平台/协议约束写回 `.trellis/spec/mobile/frontend/android-platform.md`（本次无新增 Android 平台约束，只有实时层约定，见 implement 记录）。
