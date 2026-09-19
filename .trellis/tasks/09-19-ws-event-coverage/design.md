# 设计：mobile WS 事件订阅补齐

## 基准与计数

- 事件全集：`packages/core/types/events.ts` `WSEventType` = 79。
- web 覆盖 79/79 = 46 类显式 `ws.on` + 前缀泛化（`refreshMap` 的 21 个前缀：`inbox/agent/member/workspace/skill/project/squad/label/issue_status/pin/daemon/autopilot/github_installation/lark_installation/slack_installation/dingtalk_installation/vcs_connection/wecom_installation/telegram_installation/pull_request/task`），`specificEvents` 里的 33 类跳过前缀路径（含 `daemon:heartbeat`，web 无对应 handler，等价于有意忽略）。
- mobile 补齐前：45 类显式 `ws.on`。差集（web 有、mobile 无）= **34**。
- 本轮补齐 15，明确不补 19 → mobile 覆盖率 60/79。

## 对照表（34 个缺口事件）

| 事件 | web 行为 | mobile 现状（消费方） | 补齐后 |
|---|---|---|---|
| `workspace:updated` | `applyWorkspaceUpdatedToCache` 补丁工作区列表 | 未订阅；`["workspaces"]` 被 settings / select-workspace / switch-workspace / more-dropdown / `[workspace]/_layout` 读取 | 订阅 → invalidate `["workspaces"]` |
| `workspace:deleted` | 清本地存储 + 重定位到其它工作区（自己删的跳过） | 未订阅；`[workspace]/_layout` 已按 `["workspaces"]` 校验成员关系，失配即 `Redirect /select-workspace` | 订阅 → invalidate `["workspaces"]`（重定向由既有布局完成，不加导航代码） |
| `member:added` | 前缀 → members；本人 → 工作区列表 + 待处理邀请 + toast | 未订阅；`["members",wsId]` 供 assignee / mention / project-lead picker 与 `useActorName`；本人入组还会改变 `["workspaces"]`（服务端接受邀请时先播本事件，`invitation.go:597`） | 订阅 → 始终 invalidate members；`member.user_id === 我` 时再加 `["workspaces"]` |
| `member:updated` | 前缀 → members | 未订阅；同上消费方 | 订阅 → invalidate `["members",wsId]` |
| `member:removed` | 前缀 → members；本人 → 清存储 + 重定位/提示 | 未订阅；本人被移出后 `[workspace]/_layout` 依赖 `["workspaces"]` 才能发现失配 | 订阅 → invalidate members；`user_id === 我` 时再加 `["workspaces"]`（布局完成离开） |
| `squad:created` | 前缀 → squads + issues | 未订阅；`["squads",wsId]` 供 assignee / mention picker 与 `useActorName` | 订阅 → invalidate `["squads",wsId]` |
| `squad:updated` | 同上 | 同上（squad 改名后 picker/mention 名称需刷新） | 同上 |
| `squad:deleted` | 同上（注释说明：删除触发 assignee 转移，所以连带 issues） | 同上；issue 的 assignee 可能被服务端转移 | invalidate squads + `issueKeys.all(wsId)`（assignee 转移，web 同口径） |
| `label:created` | 前缀 → labels + issues + agents + skills | 未订阅；`["labels",wsId]`（label picker）+ issue 缓存（`issue.labels` 内联渲染在 issue detail 的 chip 行） | invalidate labels + `issueKeys.all(wsId)`；**不**连 agents/skills（mobile 无 agent/skill 标签渲染，见「不补理由」） |
| `label:updated` | 同上 | 同上（改名/改色要重绘 issue 上的 chip 与 picker） | 同上 |
| `label:deleted` | 同上 | 同上 | 同上 |
| `issue_status:changed` | 只刷 issue status catalog（刻意不拖 issues，`MUL-6458`） | 未订阅；`issueStatusKeys` 被 `useIssueStatuses` 用于 state/priority chip 的 name/color 解析 | invalidate `issueStatusKeys.all(wsId)`（同样不拖 issues：mobile 行只存 status key，渲染时查 catalog） |
| `task:running` | 专项 handler：清掉 `waiting_local_directory` 的 pending 态 + 刷消息 +（task 前缀）刷快照 | 未订阅；presence 的 `["agent-task-snapshot",wsId]` 与 chat 的 `pendingTask` | presence 订阅 → invalidate snapshot；chat 会话 hook 订阅 → invalidate `pendingTask`（+ 保持既有 messages 口径） |
| `task:waiting_local_directory` | 同上（daemon 占用同目录时） | 未订阅；同上 | 同上 |
| `chat:cancel_finalized` | patch pending task；`outcome === "stopped"` 时另刷会话列表 | 未订阅；chat 的 `pendingTask` / `messages` / `sessions` | 会话 hook：invalidate `pendingTask`，`stopped` 时再刷 `messages`；列表 hook：`stopped` 时刷 `sessions`（预览出现 “Stopped.” 行） |
| `daemon:heartbeat` | 在 `specificEvents` 中跳过且无 handler（有意忽略，避免心跳风暴） | 未订阅；`use-presence-realtime.ts` 注释已写明有意跳过 | **不补**（两端一致） |
| `invitation:created` | 刷待处理邀请 + toast | 未订阅；mobile 无 invitation API / query / 路由（`rg -ci invitation apps/mobile` 命中 0） | 不补（无消费方） |
| `invitation:accepted` | 刷邀请列表 + 成员列表；本人 → 刷待处理 | 同上；「我入组」语义已由 `member:added` 覆盖 | 不补（无消费方） |
| `invitation:declined` | 刷邀请列表；本人 → 刷待处理 | 同上 | 不补（无消费方） |
| `invitation:revoked` | 刷待处理邀请 | 同上 | 不补（无消费方） |
| `subscriber:added` | invalidate `issueKeys.subscribers(issue_id)` | 未订阅；mobile 无订阅者查询 / UI（`data/api.ts` 无方法） | 不补（无消费方） |
| `subscriber:removed` | 同上 | 同上 | 不补（无消费方） |
| `property:created` | property catalog + table groups | 未订阅；mobile 无自定义属性 UI / query（`project-properties-section` 只是 status/priority/lead 行） | 不补（无消费方） |
| `property:updated` | 同上 | 同上 | 不补（无消费方） |
| `issue_properties:changed` | patch issue 属性 + property catalog | 同上 | 不补（无消费方） |
| `issue_metadata:changed` | patch issue metadata 缓存 | 未订阅；mobile 不渲染 `issue.metadata`（仅 `data/schemas.ts` 保留类型） | 不补（无消费方） |
| `skill:created` | 前缀 → skills 列表 | 未订阅；mobile 无 skills query / 路由；`Agent.skills` 仅类型、不渲染 | 不补（无消费方） |
| `skill:updated` | 同上 | 同上 | 不补（无消费方） |
| `skill:deleted` | 同上 | 同上 | 不补（无消费方） |
| `github_installation:created` | 前缀 → github installations | 未订阅；mobile 无 GitHub 集成面 | 不补（无消费方） |
| `github_installation:deleted` | 同上 | 同上 | 不补（无消费方） |
| `pull_request:linked` | 前缀 → PR 列表 | 未订阅；mobile 无 PR 面 | 不补（无消费方） |
| `pull_request:updated` | 同上 | 同上 | 不补（无消费方） |
| `pull_request:unlinked` | 同上 | 同上 | 不补（无消费方） |

覆盖外但记录在结论的越界缺口：`inbox:batch-read` / `inbox:batch-archived`（mobile 未订阅，属 `use-inbox-realtime.ts`，本任务禁改，FEATURE-563 并行）。

## 实现形态

新增两个 listing 级 hook（与既有 `use-projects-realtime.ts` 同形），在 `RealtimeSubscriptions` 挂载：

1. `data/realtime/use-workspace-realtime.ts` —— 工作区身份与成员关系：`workspace:updated`、`workspace:deleted`、`member:added`、`member:updated`、`member:removed`；`onReconnect` 刷 members + workspaces（本人相关投影属它自己的责任面）。
2. `data/realtime/use-catalogs-realtime.ts` —— picker 读取的工作区目录数据：`squad:*`、`label:*`、`issue_status:changed`；`onReconnect` 刷 squads + labels + issue-statuses。

改动既有 hook（按域归属，不新建第三个文件）：

3. `use-presence-realtime.ts`：任务生命周期集合补 `task:running`、`task:waiting_local_directory`（仍不含 `task:message` / `task:progress`，保持既有「高频道事件不订阅」的蜂窝数据约定）。
4. `use-chat-session-realtime.ts`：补 `task:running`、`task:waiting_local_directory`（invalidate pendingTask）、`chat:cancel_finalized`（invalidate pendingTask；`stopped` 时加 messages）。
5. `use-chat-sessions-realtime.ts`：补 `chat:cancel_finalized`（`stopped` 时 invalidate `chatKeys.sessions(wsId)`）。

key 来源：有 key factory 的用 factory（`labelKeys`、`issueStatusKeys`、`issueKeys`、`chatKeys`）；members/squads 只导出 `*Options`，用 `memberListOptions(wsId).queryKey` / `squadListOptions(wsId).queryKey` 取 key（既有先例：`data/mutations/issues.ts:353` 用 `appConfigOptions().queryKey`），避免硬编码字面量，也不越界改 `data/queries/**`。

## 权衡

- `squad:updated` 只刷 squads、不刷 issues：mobile 的 assignee 名称由 `useActorName` 从 squads 缓存实时解析，issue 行不内联 squad 名称；只有 `squad:deleted` 会触发服务端 assignee 转移才需要 issues。web 在 squad 前缀上三个事件都刷 issues 是它的缓存形态所需，mobile 收窄属于「不复制无消费方的刷新」。
- `task:running` / `task:waiting_local_directory` 在 chat 侧只刷 `pendingTask`：mobile 的 live timeline 走 `task:message`（按 taskId 缓存），持久消息列表不因状态跃迁而变化；web 多刷一次 messages 是它自身缓存形态，mobile 沿用既有 `task:completed` 的最小口径。
- 不引入 `onAny` 前缀分发：mobile 每个域都有自己的 hook 与 updater，统一前缀表会把域归属打散，且容易与已有专项 handler 重复刷新（正是本任务要避免的过度刷新）。

## 风险与回滚

- 风险：新订阅事件量极低（管理员改配置/换成员/删 squad），且都只在 wsId 作用域内 invalidate，不存在风暴面。
- 回滚：单个 commit 内两个新 hook + 三处 hook 增补 + 挂载 import；`git revert` 即回到 45 类覆盖。
