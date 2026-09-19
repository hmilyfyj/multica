# 581 运行详情（transcript）：从 Runs 列表进入 + 实时追加

## Goal

`apps/mobile` 的 Runs 列表（`issue/[id]/runs` sheet）现在点历史 run 是 no-op（`runs.tsx` /
`run-row.tsx` 顶部注释都写着 *"transcript drilldown is deferred"*）。本任务补齐**运行详情页**：
点任一条 run（含 Past）打开该 run 的完整执行时间线（思考 / 工具调用 / 工具结果 / 文本 /
错误，按 `seq` 顺序），运行中的 run 实时追加，长 transcript 用「显示前面的 N 个步骤」逐页开窗。

对齐 web `packages/views/common/task-transcript/` 的条目语义；纯客户端改动，不动后端。

来源：FEATURE-581（stage 10）。

## 已核实事实（读代码，非推测）

**web 参照实现**

- 条目语义在 `packages/views/common/task-transcript/build-timeline.ts`：`TimelineItem`
  五型 `tool_use | tool_result | thinking | text | error`；`buildTimeline` 按 `seq` **升序**
  排序（不是 created_at），并把**相邻同类 `text` / `thinking` 片段合并**成一条（流式 flush
  产生的碎片）；`content` / `output` 落库后先过 `redactSecrets`。
- 详情体（`trace-event-presenter.ts`）：`tool_use` / `tool_result` 的单行摘要是
  「最有信息量的那个参数」——`query` → `file_path`/`path`（长路径缩成 `.../parent/leaf`）→
  `pattern` → `description` → `command`/`cmd`（剥掉 `bash -lc '…'` 外壳、截 120）→ `prompt` →
  `skill` → 第一个短字符串。
- `error` 行、`tool_result` 的 `output_truncated` 三态（`undefined` = 未知，不等于「完整」）。
- 客户端脱敏兜底 `redact.ts`：13 条正则（AWS / GitHub / GitLab / Google / OpenAI / Slack /
  JWT / Bearer / 连接串 / 通用 KV），对 `content` 与 `output` 生效；服务端是主脱敏方。
- **「查看更早」不在 dialog 里**：`agent-transcript-dialog.tsx` 是纯展示组件，一次性渲染传入的
  全部条目，自己不发请求、无分页。唯一的渐进显示在
  `packages/views/issues/components/inline-comment-run.tsx:192`：
  `visibleCount` 初始 12，点一次 `+12`，渲染 `slice(-visibleCount)`，文案
  `show_earlier: "Show {{count}} earlier steps"`（`packages/views/locales/*/issues.json`）。
- issue 内嵌的执行日志区 `packages/views/issues/components/execution-log-section.tsx` 只做
  Active/Past 分桶 + 「Show past runs (N)」折叠，每行挂 `TranscriptButton` 打开 dialog；
  它本身不渲染步骤。

**数据层**

- `GET /api/tasks/{taskId}/messages`（`server/internal/handler/daemon.go:5548`
  `ListTaskMessagesByUser`）：**无分页参数**，只支持可选 `?since=<seq>`（`seq > since`）；
  SQL `ListTaskMessages` 无 LIMIT，一次返回整条 run 的全部消息。
  → 服务端没有「更早一页」可拉，开窗只能客户端做。
- mobile 已有全部数据面：`data/queries/chat.ts` 的 `taskMessagesOptions`（key
  `["task-messages", taskId]`，`staleTime: Infinity`，`enabled` 卡 UUID）、
  `data/realtime/chat-ws-updaters.ts` 的 `appendTaskMessage`（按 `seq` 去重 + 升序插入）、
  `data/schemas.ts` 的 `TaskMessagePayloadSchema`（未知 `type` 降级成 `text`）。
- **实时缺口**：`use-chat-session-realtime.ts:140` 的 `task:message` 处理器用
  `isMine()`（gate 在 `chat_session_id`）过滤，issue run 没有 `chat_session_id`，**目前被丢弃**。
  WS 只有 `auth` 帧、没有按事件订阅，所以「订阅」= 在本端 `ws.on` 注册处理器。

**mobile 现状**

- `components/chat/chat-timeline.tsx` 已有同一套五型的渲染（`Collapsible` 折叠 + `N steps`
  触发器 + tool 摘要），但它**只渲染非 text 的「过程步骤」**（最终文本由父级 Markdown 渲染），
  且没有开窗、没有 `output_truncated`、没有脱敏。
- `components/issue/run-row.tsx` 的 `RunRow` 目前整行不可点；状态文案/色调表、失败原因徽标
  （`lib/run-failure-badge.ts`）、时长（`lib/agent-runs.ts` 的 `runDurationLabel`）都已存在。
- 长列表引擎：`FlashList` v2（`@shopify/flash-list`），`chat-message-list.tsx:240` 用
  `maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 0.2, startRenderingFromBottom: true }}`
  实现「在底部就跟着新内容走，翻历史时不被打断」。
- 路由：`app/(app)/[workspace]/issue/[id]/runs.tsx` 是 formSheet；同层「文件 + 同名目录」的
  嵌套先例是 `more/agents.tsx` + `more/agents/[id].tsx`。

## Requirements

- **R1 详情页**：从 Runs 列表点任一条 run（Active / Past 都算）进入
  `issue/[id]/runs/[taskId]`，展示该 run 的完整时间线。
- **R2 条目类型与顺序**：严格按 `seq` 升序；相邻同类 `text` / `thinking` 合并；
  五型各自可读——`thinking` 单行斜体预览 + 展开全文；`tool_use` 工具名 + 参数摘要 +
  展开原始 `input`；`tool_result` 预览 + 展开 `output`（`output_truncated === true` 时明示截断）；
  `error` 红行；`text` 用 Markdown 渲染。
- **R3 「查看更早」**：默认只渲染最后 20 条；列表顶部出现
  「显示前面的 N 个步骤」，点一次再放 20 条，直到全部可见。
- **R4 实时追加**：运行中的 run 打开后，WS `task:message` 按 `task_id` 过滤后追加进同一缓存
  （`seq` 去重）；重连后补拉；流式中列表跟底，用户往上翻历史时不打断。
- **R5 入口**：Runs 列表行整行可点进详情；Active 行额外提供行内「步骤」折叠（惰性挂载），
  复用同一渲染与订阅——这是 web `inline-comment-run` 在 mobile 的最小等价物。
- **R6 脱敏**：`content` / `output` 走客户端兜底脱敏（与服务端同规则的 13 条正则）。

## 非目标

- 不做 web dialog 的筛选、搜索、泳道图（`run-timeline.tsx`）、`RunOutcome` 汇总、
  step inspector 的 diff 语法高亮 / `show_all` 详情体。
- 不改后端、不加服务端分页参数、不改收件箱。
- 不订阅全局 `task:message`（蜂窝数据规则：只有详情页/展开的行挂订阅）。

## 有意为之的差异（记录来源行为）

1. **开窗分页放客户端**：web 是一次性渲染全部条目；服务端没有 `limit` / `before`，
   `GET .../messages` 只能整条拉。mobile 仍整条拉（与 web 同源数据），但只渲染最后 20 条、
   按 20 递增——控的是渲染规模，不是网络。
2. **折叠入口的位置**：web 的「Show earlier steps」在评论内联 run 行上；mobile 的 issue 评论
   卡没有 run 行（`components/issue/comment-card.tsx` 不含运行信息），因此把行内折叠放在
   Runs 列表行（R5），详情页另有同一套开窗。
3. **`text` 条目**：web dialog 把 `text` 渲染成 Markdown 段落；mobile 历史 `ChatTimeline`
   刻意不渲染 `text`（聊天里最终回答由气泡负责）。详情页是纯 transcript 读数面，**要**渲染
   `text`（Markdown，`compact`）。

## Acceptance Criteria

- [x] 静态检查：`typecheck` / `lint` / `test` 全绿；`lib/run-transcript.ts` 的条目映射有单测
      （排序、合并、不跨类合并、摘要优先级、开窗边界、脱敏）—— 63 文件 568 例通过，新增 25 例。
- [x] 构建产物：APK（vc13）走 GitHub Release 交付。
- [ ] 真机验收（用户执行）：Runs 列表点历史 run 进入详情，能看到步骤与消息，
      「Show N earlier steps」逐页展开，运行中实时追加。
      —— 本任务**不自行启动模拟器**，此项由用户在 Release APK 上完成。
