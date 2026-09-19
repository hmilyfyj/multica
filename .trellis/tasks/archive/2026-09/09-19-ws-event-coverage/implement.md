# 实施计划：mobile WS 事件订阅补齐

前置：worktree `~/workspace/multica.worktrees/FEATURE-564`，分支 `feature/564-ws-event-coverage`，基线 `origin/main@26c8192e3`。

## 步骤

1. [x] 对照：用脚本抽取 `WSEventType` 全集、web 显式 `ws.on` + `refreshMap` 前缀、mobile 显式 `ws.on`，得到 32 个缺口事件（结果见 `design.md` 对照表）。
2. 新增 `apps/mobile/data/realtime/use-workspace-realtime.ts`
   - `workspace:updated` / `workspace:deleted` → invalidate `["workspaces"]`（用 `workspaceListOptions().queryKey`）
   - `member:added` → invalidate members；`member.user_id === 我` 时加 `["workspaces"]`
   - `member:updated` → invalidate members
   - `member:removed` → invalidate members；`user_id === 我` 时加 `["workspaces"]`
   - `onReconnect` → members + workspaces
3. 新增 `apps/mobile/data/realtime/use-catalogs-realtime.ts`
   - `squad:created|updated` → squads；`squad:deleted` → squads + `issueKeys.all(wsId)`
   - `label:created|updated|deleted` → `labelKeys.all(wsId)` + `issueKeys.all(wsId)`
   - `issue_status:changed` → `issueStatusKeys.all(wsId)`
   - `onReconnect` → squads + labels + issue-statuses
4. ~~`use-presence-realtime.ts`：补 `task:running`、`task:waiting_local_directory`~~ —— 合并 origin/main 后发现 FEATURE-563 的 inbox hook 已为同一 `agent-task-snapshot` key 订阅这两个事件，改为不重复订阅（本文件与 main 保持一致）。
5. `use-chat-session-realtime.ts`：补 `task:running`、`task:waiting_local_directory`、`chat:cancel_finalized`
6. `use-chat-sessions-realtime.ts`：补 `chat:cancel_finalized`（`stopped` → sessions）
7. `app/(app)/[workspace]/_layout.tsx`：`RealtimeSubscriptions` 挂载两个新 hook（仅 import + 调用）
8. 单测：`use-workspace-realtime.test.ts`、`use-catalogs-realtime.test.ts`、`use-chat-session-realtime.test.ts` 新建；`use-chat-sessions-realtime.test.ts` 增补

## 验证命令（收尾一次跑完）

```bash
cd <worktree>
rtk err -- corepack pnpm --filter @multica/mobile typecheck
rtk err -- corepack pnpm --filter @multica/mobile lint
rtk test -- corepack pnpm --filter @multica/mobile test
```

（应用 `apps/mobile/AGENTS.md`「Verification」段落给出的三条过滤命令；设备/跨端验证不在本任务内。）

## 提交与回滚

- 单 commit：`feat(mobile): 补齐 WS 事件订阅（workspace/member/squad/label/issue_status/task/chat）`
- 回滚点：该 commit 之前 = 45 类覆盖，无数据迁移、无 schema 变更，`git revert` 即可。
- 交付：推分支 → PR 目标 `main` → squash 合并。
