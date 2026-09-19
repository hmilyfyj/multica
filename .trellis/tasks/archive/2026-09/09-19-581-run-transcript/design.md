# 技术设计

## 数据层（只读 + 一处追加）

`GET /api/tasks/:taskId/messages?since=<seq>` → `TaskMessagePayload[]`（按 `seq` 升序）。

mobile 侧的取数面已经齐了，本任务**不新增接口、不新增 api.ts 方法**：

- `data/queries/chat.ts`：`taskMessagesOptions(taskId)`（已存在，key `["task-messages", taskId]`）。
- `data/realtime/chat-ws-updaters.ts`：`appendTaskMessage(qc, payload)`（已存在，`seq` 去重 + 升序）。

**唯一改动（追加）**：给 `taskMessagesOptions` 加 `structuralSharing`，用新导出的
`unionTaskMessagesBySeq(existing, incoming)` 合并——server 数据在冲突时胜出、**响应没提到的行保留**。
原因：`staleTime: Infinity` 下，挂载时的补拉与 WS 帧会赛跑（帧先进缓存、响应后到），
普通 replace 会丢掉那些 `seq`，而 Infinity 意味着再也不会补回来。这正是 web
`packages/core/chat/queries.ts:280 unionTaskMessagesBySeq` 的规则，mobile 之前只有
`appendTaskMessage` 的单向合并、没有这层保护。

**实时订阅**：WS 只有 `auth` 帧、没有按事件订阅，`use-chat-session-realtime` 的
`task:message` 处理器 gate 在 `chat_session_id`（issue run 被丢弃）。因此详情页/展开的行
**自己挂订阅**（记录级订阅，属于「Record subscriptions belong to the owning screen」）：

```
ws.on("task:message", p => { if (p.task_id === taskId) appendTaskMessage(qc, p); })
ws.onReconnect(() => invalidate(taskMessages(taskId)))   // 重连补拉，heal WS 缺口
```

不在 `RealtimeSubscriptions` 里全局订阅 `task:message`（蜂窝数据规则）。

## 纯函数 `lib/run-transcript.ts`（新，node 单测覆盖）

对齐 web `build-timeline.ts` + `redact.ts` + `trace-event-presenter.ts` 的映射：

- `buildRunTranscript(messages)` → `RunTranscriptEntry[]`
  - 按 `seq` 升序排序（web 同源）；相邻同类 `text` / `thinking` 合并成一条（`content` 首尾相接）；
  - 保留全部五型；`output_truncated` 原样带出（三态，`undefined` ≠ 完整）；
  - `content` / `output` 过 `redactSecrets`。
- `redactSecrets(text)`：13 条正则，逐字对齐 `packages/views/common/task-transcript/redact.ts`
  （服务端是主脱敏方，这里是显示兜底）。
- `runEntryToolSummary(entry)`：`query` → `file_path`/`path`（`.../parent/leaf`）→ `pattern` →
  `description` → `command`/`cmd`（剥 `bash -lc '…'` 外壳、截 120）→ `prompt` → `skill` →
  第一个短字符串。非 `tool_use` 返回 `""`。
- `runEntryTitle(entry)`：`text`→`Agent`、`thinking`→`Thinking`、`error`→`Error`、
  `tool_use`/`tool_result`→工具名（缺省 `Tool`/`Result`）。
- `transcriptWindow(total, visibleCount)` → `{ start, hiddenCount }`；`RUN_TRANSCRIPT_PAGE_SIZE = 20`。
- `transcriptPreview(text, max)`：空白折叠 + 截断（对齐 web `collapseWhitespace` + `clip`）。

`key` 用 `` `${task_id}-${seq}` ``（web 的 React key 同款），跨任务共享缓存也不串。

## 视图

`components/issue/run-transcript.tsx`（新）

- `RunTranscript({ entries, isStreaming, compact })`
  - 开窗：组件内 `useState(RUN_TRANSCRIPT_PAGE_SIZE)`；`transcriptWindow` 决定
    `hiddenCount > 0` 时在**列表头部**渲染「显示前面的 N 个步骤」（`Pressable`，`+PAGE`）。
  - 行渲染（`TranscriptRow`）：thinking / tool_use / tool_result / error / text 五型，
    折叠用既有 `components/ui/collapsible.tsx`（与 `chat-timeline.tsx` 同一套交互语言：
    `bulb-outline` 思考、`chevron-forward` 可展开、`alert-circle` 错误）。
  - `text` 型：`compact` 时退化成截断纯文本，非 compact 用 `lib/markdown` 的 `Markdown compact`
    （transcript 面要读最终回答；聊天气泡里那份由气泡负责，这里不重复）。
  - 列表引擎：非 compact 用 `FlashList` + `maintainVisibleContentPosition`
    （`autoscrollToBottomThreshold: 0.2, startRenderingFromBottom: true`，与聊天同一组参数：
    「在底部就跟、翻历史不被拽」）；`compact` 用普通 `View` 映射——行内折叠嵌在
    `runs.tsx` 的 `ScrollView` 里，嵌套 VirtualizedList 会告警且更慢，开窗已经控住了行数。
- 导出 `RunTranscriptRows`？不需要——一个组件用 `compact` 区分两种密度。

`components/issue/use-run-transcript.ts`（新）

```
useRunTranscript(taskId) → { entries, messageCount, isStreaming, isLoading, isError, refetch }
```

- `useQuery({ ...taskMessagesOptions(taskId), refetchOnMount: "always" })`
  （`refetchOnMount: "always"` 只在详情面加：缓存热但 `staleTime: Infinity` 时也要补一次，
  对齐 web `useTaskMessages`；不写进共享 options，避免聊天每条 assistant 气泡重挂都补拉）。
- `useWSSubscriptions(...)` 注册上面两条。
- `isStreaming` 由调用方传入任务是否 active（`lib/agent-runs.ts` 的 `isActiveTask`），
  这个 hook 只管数据。

`components/issue/run-row.tsx`（改）

- 整行包 `Pressable` → `router.push('/${wsSlug}/issue/${issueId}/runs/${task.id}')`；
  trailing Cancel 按钮仍是独立热区。
- 把私有 `StatusBadge` / `CancelButton` 改成导出 `RunStatusBadge({ task })` /
  `RunCancelButton({ taskId, issueId })`，详情页头部复用同一套状态文案与色调
  （不再写第二份状态表）。
- Active 行下方加「步骤」折叠（新组件 `run-steps-fold.tsx`）：**展开才挂载** `useRunTranscript`，
  展开内容就是 `RunTranscript compact`。终态 run 默认不拉数据（与 web「historical collapsed
  runs don't fetch transcripts」一致）。

`components/issue/run-steps-fold.tsx`（新）：`RunStepsFold({ taskId, defaultOpen })`
——折叠触发器 + 惰性挂载内部组件（`Collapsible` + 一个 mounted-only 的子组件读数据）。

`app/(app)/[workspace]/issue/[id]/runs/[taskId].tsx`（新）

- 自绘表头（sheet body 惯例）：返回/关闭 + 标题 + 一行摘要。
- 摘要行：`ActorAvatar` + agent 名（`useActorLookup`）+ `RunStatusBadge` + 时长
  （`runDurationLabel`）+ `trigger_summary`；失败时补 `runFailureBadgeLabel`。
- 数据：任务记录从 `issueTasksOptions(wsId, id)` 里按 `taskId` 找（Runs sheet 已填同一缓存，
  进详情零请求）；找不到（深链直达）时头部退化成不显示摘要，transcript 照常拉。
- 主体：`RunTranscript`。Active run 显示「Cancel」按钮（`RunCancelButton`）。
- 深链：`unstable_settings.anchor = "(tabs)"` 已保证栈底有 tabs；本路由只依赖
  `id` / `taskId` 两个参数，不假设 issue 详情已挂载。

## 路由注册

`app/(app)/[workspace]/_layout.tsx`（改一行区块）：`issue/[id]/runs/[taskId]` 用
`SHEET_OPTIONS` 的本地覆盖 `RUN_DETAIL_OPTIONS = { ...SHEET_OPTIONS, sheetAllowedDetents: [0.95] }`
——transcript 是「长列表读数面」，按 `apps/mobile/AGENTS.md` 的容器表属 formSheet；
单挡 0.95 是因为 0.6 挡放不下 transcript 且嵌套滚动要用户先拖一次。
覆盖写在路由注册处（AGENTS.md：*document necessary overrides at the route*）。

## 被否掉的方案

1. **详情页用 `presentation: "modal"`**：与「长列表 → formSheet」的容器表冲突；且
   `formSheet → modal` 这一叠放在 Android（RNS BottomSheet）与 iOS 都没有实测先例，
   而 formSheet 家族本身是本仓库唯一被实测过的叠放路径（new-issue modal → picker sheet）。
2. **详情页用默认 card push**：iOS 上从 formSheet 里 push 的 card 会落在 sheet 的
   容器内（60% 高度里渲染整份 transcript），Android 同样未实测。
3. **新增服务端 `?limit=&before=` 分页**：改后端、改 schema、两个客户端都要对齐，
   而 web 至今是一次性全量；本轮开窗只需解决渲染规模。
4. **直接复用 `ChatTimeline`**：它刻意丢掉 `text`、没有开窗、没有 `output_truncated`、
   没有脱敏；改它等于同时改聊天（`components/chat/**` 不在本任务边界内，且会给聊天加上
   它不需要的 Markdown/脱敏开销）。
5. **在 `RealtimeSubscriptions` 全局订阅 `task:message`**：违反蜂窝数据规则
   （每个客户端会收到并缓存它永远不会看的 run 的 transcript），web 也是用
   `isTaskMessageTimelineHeld` 把写入限定在「已经被打开过」的 task 上。
6. **移动端照抄 web 的 `build-steps` / `RunOutcome` / `RunTimeline`**：step 配对、分组折叠、
   泳道图、diff 高亮是 web dialog 的深层能力，本轮验收只需要「条目类型与顺序 + 开窗 + 实时」，
   照抄会带进 `diff-highlight` / `detail-surfaces` 一大片渲染面。
