# 聊天：停止运行中的任务 + 会话重命名

## Goal

`apps/mobile` 聊天补齐两项、语义对齐网页版：

1. **停止运行中的任务** —— 在运行中提供停止入口，取消语义、停止后的状态展示、草稿回填与
   失败回滚与 web `use-chat-task-actions.ts` / `use-chat-controller.ts#handleStop` 一致。
2. **会话重命名** —— 会话标题处可进入重命名（空值 / 超长输入有确定处理），成功后就地更新标题，
   乐观更新 + 失败回滚。对齐 web `session-rename-input.tsx` + `useUpdateChatSession`。

来源：FEATURE-579（stage 10）。纯客户端改动，不动服务端。

## 已核实事实（读代码，基线 `origin/main@4e2d1c325`）

### 停止任务

- **入口已存在**：`components/chat/chat-composer.tsx` 的 `renderStop` → `StopButton`，
  `chat.tsx` 的 `sending = !!pendingTask?.task_id` 时替换发送键；`allowStop`（`status !== "queued"`
  时为 true）控制是否给停止按钮。位置与 web 一致（web 的 Stop 在输入框操作位，
  `chat-input.tsx:735-765` 的 `SubmitButton running=`）。
- **缺口 1 —— 草稿不回填**：web 的 `cancelChatTask` 读 `CancelTaskResponse.cancelled_chat_message`，
  当 `restore_to_input` 为真时把被取消的用户消息从消息缓存移除并把内容回填输入框
  （`use-chat-task-actions.ts:88-104`）。mobile 的 `api.cancelTaskById` 返回 `void`，
  `chat.tsx#handleStop` 只做「乐观删 pendingTask → POST → invalidate」，草稿丢失。
- **缺口 2 —— 缺少能力头**：服务端只在收到 `X-Client-Capabilities: chat-draft-restore-v1`
  时才走同步回填（`server/internal/handler/chat.go:1868` 读头 →
  `service.CancelTaskOptions.ClientSupportsDraftRestore` → `server/internal/service/task.go:3208`）。
  mobile 不带该头，等于被服务端当成旧客户端，`cancelled_chat_message` 根本不返回。
- **缺口 3 —— 失败不回滚**：web 在 `onError` 里把 `pendingSnapshot` 写回再 invalidate；
  mobile 失败时只 `invalidatePendingTask`。
- **不在 iOS 才有的语义**：`status === "queued"` 时 mobile 不渲染停止键（`allowStop=false`），
  且 `handleStop` 直接 return —— 队列里等待的任务本轮不做取消（web 的队列编辑/移除属于队列 UI，
  移动端没有队列 UI），保持现状。
- `data/mutations/issues.ts` 的 `useCancelTask`（issue 详情用）是另一条路径，本轮不动。

### 会话重命名

- web：`chat-session-header.tsx` 标题点击进 `editing` 内联输入（`maxLength=200`，
  Enter/blur 提交，Escape 取消），提交时 `trim()`，**空值或与旧标题相同则不写**；
  `useUpdateChatSession` 乐观改标题、失败回滚、settle 时 invalidate。
  另一入口 `SessionRenameInput`（历史下拉）语义相同。
- API：`PATCH /api/chat/sessions/:id` body `{title}`，返回 `ChatSession`（core `client.ts:3476`）。
- mobile 现状：完全没有重命名（`rg rename apps/mobile` 只命中 labels/settings 文案），
  `data/api.ts:1561` 明确写着 v1 砍掉了 `updateChatSession`。
- mobile 既有改名范式是「点行 → formSheet 表单」（`more/settings/label-form.tsx`）；
  但 web 自己的重命名是**就地内联**，且新建一条 `_layout.tsx` 注册的 sheet 路由会踩到本任务
  边界之外的文件（见「边界」），故选在会话列表 sheet 内就地内联编辑。
- `Alert.prompt` 是 iOS 专有 API（Android 上不存在），本任务不得用它做文本输入。

## Requirements

1. 停止入口（已存在的 composer Stop）在运行中可点；点击后：乐观移除 pendingTask →
   请求取消 → 成功且服务端要求回填时，把被取消消息从消息缓存移除并把内容写回该会话草稿 →
   失败时回滚 pendingTask；无论成败都 invalidate pendingTask + messages。
2. mobile 的取消请求必须带上 `X-Client-Capabilities` 能力头，才能真正拿到服务端的同步回填。
3. 取消响应解析走 zod（`CancelTaskResponseSchema`），形状漂移时退化为空响应，不炸 UI。
4. 会话列表 sheet 的每一行可从标题处进入重命名：就地输入，自动聚焦并全选，
   `maxLength` 200；提交时 `trim()`，空值或与旧标题相同不写；成功后乐观就地更新标题
   （列表行与聊天头部副标题同源，自动跟着变）；失败回滚并在列表里保留旧标题。
5. 两处都要有「乐观更新 + 失败回滚」的单测。
6. 静态检查（typecheck / lint / test）通过；不自行启动模拟器。

## Acceptance Criteria

- [ ] 运行中发送一条消息，输入框出现停止键；点击后状态行消失、pendingTask 清空，
      服务端取消成功后草稿（被取消的那条消息文本）回到输入框；消息列表里被取消的用户气泡消失。
- [ ] 取消请求带 `X-Client-Capabilities: chat-draft-restore-v1`（单测断言请求头）。
- [ ] 取消失败（服务端 4xx/网络错）时不炸 UI、不静默丢状态：pendingTask 回滚并 invalidate。
- [ ] 会话列表 sheet 行内改名：空输入 / 只输空格 → 不写请求、保持旧标题；
      超过 200 字被截断；正常改名 → 行标题就地更新；服务端拒绝 → 回滚为旧标题。
- [ ] `pnpm --filter @multica/mobile typecheck` / `lint` / `test` 全绿。
- [ ] 新 APK 发布到 GitHub Release（versionCode 10），真机自测步骤写进发布说明。

## 边界（只碰这些文件）

- 独占：`apps/mobile/components/chat/**`、`apps/mobile/app/(app)/[workspace]/(tabs)/chat.tsx`、
  `apps/mobile/app/(app)/[workspace]/chat-sessions.tsx`、`apps/mobile/data/mutations/chat.ts`、
  `apps/mobile/lib/chat-session-rename.ts`(+ 其测试)、`.trellis/**`
- 只追加：`apps/mobile/data/api.ts`
- 不改：issue 详情、收件箱、服务端、`app/(app)/[workspace]/_layout.tsx`（不新增路由）

## Non-goals

- 队列（queued）任务的移除 / 编辑 / 立即发送 —— 移动端没有队列 UI，本轮不做。
- 会话归档 / 置顶 / 项目上下文（web 的 ⋯ 菜单里还有这些）。
- 重启后仍存的草稿（移动端草稿是内存态）、被取消消息附件的回填（移动端草稿只能存文本）。
