# 技术设计：停止运行中的任务 + 会话重命名

基线：`origin/main@4e2d1c325`；分支 `feature/579-chat-stop-rename`；包 `mobile`。

## 1. 停止任务

### 现状与差距

| 环节 | web | mobile（改前） |
|---|---|---|
| 入口 | 输入框操作位 `SubmitButton running=` | 已有：`chat-composer.tsx` 的 `renderStop`/`StopButton`（`sending && allowStop`） |
| 请求 | `POST /api/tasks/:id/cancel` **+ `X-Client-Capabilities: chat-draft-restore-v1`** | `api.cancelTaskById` → `fetch<void>`（丢响应体） |
| 乐观 | 先 `removePendingChatTask`，失败回写 `pendingSnapshot` | 先 `removePendingChatTask`，失败只 invalidate |
| 草稿回填 | `cancelled_chat_message.restore_to_input` → 删除消息缓存行 + 回填输入框（仅当草稿为空） | 无 |
| 状态刷新 | success/error 都 invalidate messages + pendingTask | 仅 finally invalidate pendingTask |

### 关键技术约束（决定本轮取舍）

1. **能力头与「延迟判定」绑定**。服务端仅在请求带 `chat-draft-restore-v1` 时才走 #5219 延迟判定
   （`server/internal/handler/chat.go:1868` → `service/task.go:3208`）。带头的**已启动**任务会把
   取消响应里的同步回填**整段去掉**（`MarkChatFinalizeDeferred` + `return nil`），改由**
   durable 行 + `GET /api/chat/sessions/:id/draft-restores` + `DELETE` 消费**取回，
   触发信号是 `chat:cancel_finalized(outcome="restored")`。
2. **因此本轮不带该头**。mobile 没有 durable 回填客户端（`data/queries/chat.ts`、
   `data/realtime/use-chat-session-realtime.ts` 都不在本任务边界内，这两处才放得下
   draft-restores 查询与 `restored` 分支）。只带头不实现取回，等于让服务端把用户输入
   从会话里删掉、再交给一个本客户端永远不会读的地方 —— 静默丢输入，比不做更糟。
   服务端自己的注释也认可这条退路：读不了 durable 回填的客户端落到 legacy 同步分支，
   「strictly better than dropping the input」（`service/task.go:3217`）。
3. **legacy 分支的实际语义**：取消时 transcript 为空 → 删除该用户消息并同步返回
   `cancelled_chat_message{content, restore_to_input:true, attachments}`；
   transcript 非空 → 落一条 `Stopped.` 助手消息。web 只是把同一个空/非空判定延后到
   daemon flush 之后做。**两种客户端的可见结果一致**，差别是 web 判定更可靠。

### 改法

- `data/api.ts`（追加）`cancelChatTask(taskId): Promise<CancelTaskResponse>`：
  `POST /api/tasks/{taskId}/cancel` → `parseWithFallback(raw, CancelTaskResponseSchema,
  EMPTY_CANCEL_TASK_RESPONSE, ...)`（两个符号都从 `@multica/core/api/schemas` 引入，
  属允许的「平台无关 schema」）。**不**带能力头（见上）。
  保留既有 `cancelTaskById`（`data/mutations/issues.ts` 的 issue 任务取消在用）。
- `data/mutations/chat.ts`（追加）`useCancelChatTask()`：`{ taskId, sessionId }` →
  - `onMutate`：取消 pendingTask 查询 → 快照 → `removePendingChatTask`（乐观，与 web 一致）
  - `mutationFn`：`api.cancelChatTask(taskId)`
  - `onSuccess`：`cancelled_chat_message` 存在时，把该 `message_id` 从
    `chatKeys.messages(sessionId)` 里过滤掉（服务端已删该行，等 invalidate 回来会短暂闪回）
  - `onError`：回写 `pendingSnapshot`
  - `onSettled`：invalidate `pendingTask(sessionId)` + `messages(sessionId)`
  - `mutateAsync` 的结果直接交给调用方做草稿回填（hooks 拿不到屏幕态）
- `(tabs)/chat.tsx`：`handleStop` 改为调用该 mutation；成功且
  `restored.restore_to_input && restored.chat_session_id === sessionId` 且**该会话草稿为空**时
  `setDraft(sessionId, restored.content)`；失败静默（任务可能已结束，与 web `handleStop` 一致）。
  `queued` 状态仍然不给停止键（移动端无队列 UI，取消队列任务会把用户输入丢掉）。
  草稿非空时不覆盖（对齐 web：回填只落在空草稿上）。

## 2. 会话重命名

- `data/api.ts`（追加）`updateChatSession(id, { title }): Promise<void>`：
  `PATCH /api/chat/sessions/{id}`，`fetch<void>` —— 写操作响应体不被使用（乐观改 + settle
  invalidate），符合 mobile「raw fetch 留给响应体不用的写操作」约定。
- `data/mutations/chat.ts`（追加）`useRenameChatSession()`：`{ sessionId, title }` →
  `onMutate` 快照 `chatKeys.sessions(wsId)` 并就地改 title；`onError` 回滚；`onSettled`
  统一 invalidate。与 `useUpdateChatSession`（web）逐条对应。
- `lib/chat-session-rename.ts`（新增，纯函数）：
  - `CHAT_SESSION_TITLE_MAX_LENGTH = 200`（web 的 `maxLength`）
  - `resolveChatSessionRename(raw, currentTitle): string | null` —— trim 后为空或与旧标题
    相同返回 `null`（不写请求），否则返回要提交的标题
  纯函数放 `lib/` 是因为 mobile 的 vitest 只跑 `lib/**` + `data/**`（Node 环境，不渲染 RN 组件）。
- `app/(app)/[workspace]/chat-sessions.tsx`：行**长按** → `showActionSheet`
  （`Rename` / `Delete` / `Cancel`，复用 `components/ui/action-sheet.tsx`）→ 选 Rename 进入
  该行就地编辑。选 Delete 仍走原来的 `Alert.alert` 二次确认。
  - 就地编辑用 RN `TextInput`（`autoFocus` + `selectTextOnFocus` + `maxLength` +
    `returnKeyType="done"`），`onSubmitEditing` / `onBlur` 提交，一次性 ref 防重复提交。
  - **不用 `Alert.prompt`**：它是 iOS 专有（RN 的 `Alert.android.js` 没有该 API），
    Android 上直接抛错。这条写回 android-platform.md。
  - 选行内编辑而不是「点行 → formSheet 表单」（labels 的范式）：chat-sessions 本身就是
    formSheet，重命名只有一个字段，web 的重命名也是就地内联；新建路由还要改
    `app/(app)/[workspace]/_layout.tsx`（本任务边界之外）。
  - 提交后缓存乐观更新，列表行与聊天头部副标题同源（都读 `chatKeys.sessions`），自动跟着变。

## 3. 契约与兼容

- 无服务端改动、无新路由、无新依赖。
- `data/api.ts` 只追加两个方法；既有 `cancelTaskById` / `deleteChatSession` 等签名不动。
- 失败路径都有回滚；取消与改名都不新增 toast（与 web `handleStop` 的静默一致）。
- 已知差异（在结果里写明）：
  1. 停止的草稿回填是**同步 legacy** 路径，不带 durable 能力头（原因见 1.2）；
  2. 被取消消息的**附件**不回填（mobile 草稿只存文本）；
  3. 重命名入口是长按行（web 是标题点击 + ⋯ 菜单；移动端标题点击已用于打开会话列表）。

## 4. 验证

- 单测（新增 `apps/mobile/data/mutations/chat.test.ts` + `apps/mobile/lib/chat-session-rename.test.ts`）：
  - 取消：乐观清 pendingTask；成功回填响应里的 `cancelled_chat_message`；被取消消息从消息缓存移除；
    失败回滚 pendingTask 快照。
  - 改名：乐观改标题；失败回滚为旧标题；settle invalidate。
  - 纯函数：空 / 全空格 / 与旧值相同 → `null`；超长截断到 200；正常 trim。
- 收尾一次跑 `pnpm --filter @multica/mobile typecheck | lint | test`。
- 真机验收由用户执行；本任务构建 arm64-v8a Release APK 并发 GitHub Release（versionCode 11）。

## 5. 回滚

`git revert` 本分支 squash 提交即可：改动只落在
`data/api.ts`（追加）、`data/mutations/chat.ts`（追加）、`lib/chat-session-rename.ts(+test)`（新增）、
`components/chat/` 与 `chat.tsx`、`chat-sessions.tsx`、spec 追加段。
