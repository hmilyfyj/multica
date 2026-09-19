# PRD · Autopilots 只读视图（列表 + 详情 / 立即运行）

- 上游 issue：FEATURE-567（阶段 7 第 3 波牵头任务）
- 包：`mobile`；分支：`feature/567-autopilots-readonly`；目标分支：`main`
- 类型：轻量偏中（2 个新路由 + 4 个域组件 + 1 个纯函数模块 + 数据层追加 + More 菜单入口）

## 1. 背景与现状

`apps/mobile` 已有 issue / 项目 / 收件箱 / 聊天 / agents 只读视图，但没有任何 autopilot（自动化）表面：
列表与详情只存在于 web（`packages/views/autopilots/**`）。More 下拉菜单（`components/nav/more-tab-dropdown.tsx`）
只有 Pinned / Issues / Projects 三项，没有 Autopilots 入口。

本任务补移动端**只读**的 Autopilots 列表与详情，外加 web 已有的「立即运行」。

## 2. 目标（可验收行为）

### 2.1 列表页 `more/autopilots`

- 每行：标题、状态（Active / Paused / Archived 徽标）、启用的触发器类型（Schedule / Webhook / API）、
  下次触发时间（`next_run_at`）、最近一次运行结果（状态圆点 + 相对时间）。
- 状态为 `paused` 的行内联 `Paused` 标记；`pause_reason === "agent_runtime_required"` 时文案说明需要绑定 runtime。
- 排序：有 `next_run_at` 的按下次触发升序在前，其余按最近运行时间倒序在后（手机端无排序控件）。
- 三态：加载（`ActivityIndicator`）、空态（"No autopilots yet"）、错误态（"Couldn't load autopilots" + Try again）。
- 下拉刷新。

### 2.2 详情页 `more/autopilots/[id]`

- 头部：标题、状态徽标、描述、`agent_runtime_required` 暂停横幅、**Run now** 按钮。
- 属性（只读行）：Assignee（头像 + 名称）、Created by、Output mode、Project、Created。
- Triggers：每个触发器一行 —— 类型（Schedule / Webhook / API）、label、disabled 徽标、cron 表达式 + 时区、
  下次触发时间；webhook 触发器展示 `webhook_url ?? webhook_path`。
- Run history：每行状态（Issue Created / Running / Completed / Failed / Skipped）、来源（Schedule / Manual /
  Webhook / API）、失败原因（`failure_reason`，失败态红字）、触发时间（绝对时间）；有 `issue_id` 的行整行可点，
  跳 `/[slug]/issue/[id]`。
- 三态：加载、空态（"No runs yet"）、错误态、autopilot 不存在态（404 / 不在列表）。
- 下拉刷新（头部 + 运行列表一起刷新）。

### 2.3 立即运行（Run now）

- 按钮在 `status !== "active"` 或请求进行中时禁用，文案随状态切换 Running…。
- 结果按 web 的语义分类（`runNowToastKind` 的白名单）：`issue_created` / `running` → 成功提示；
  `skipped` → 警告；`failed` / 未知状态 → 错误。**不得**把「非 skipped/failed」当成成功。
- 失败/被拦截文案按 `reason_code` 映射（`invocation_not_allowed` / `runtime_offline` /
  `agent_runtime_required` / `target_unavailable` / `attribution_blocked` / `already_active` /
  `quota_exceeded` / `issue_limit_reached` / 兜底）。
- HTTP 429（配额）与 4xx 的 `reason_code` 从错误体取，走同一套文案；未分类失败给通用句，不泄露 5xx 内部详情。
- 成功或被拦截后都刷新列表、详情与运行记录。

### 2.4 非目标（本任务不做）

新建 / 编辑 / 删除 autopilot、暂停/恢复开关、触发器的增删改与 token 轮转、协作者（access）管理、
webhook 投递信封（deliveries）审计视图与 payload 预览、cron 预览与可视化编辑器、
配额用量页（Usage/Billing 属 FEATURE-568）、归档范围切换（列表接口本身不含 archived）。

## 3. 已核实的事实（编码依据）

| 事实 | 证据 |
|---|---|
| `GET /api/autopilots`（无 `status` 参数）返回 active + paused，**不含 archived** | `server/pkg/db/queries/autopilot.sql`（`a.status <> 'archived'`）、`server/internal/handler/autopilot.go:439` |
| 列表行自带派生字段：`trigger_kinds`（仅 enabled）、`next_run_at`（仅 enabled schedule 的最早值）、`last_run_status` | 同上 SQL 注释与子查询 |
| `GET /api/autopilots/{id}` 返回 `{ autopilot, triggers, collaborators? }` | `packages/core/types/autopilot.ts:GetAutopilotResponse`、`packages/core/api/client.ts:4333` |
| 触发器携带 `kind` / `enabled` / `cron_expression` / `timezone` / `next_run_at` / `webhook_url?` / `webhook_path?` | `packages/core/types/autopilot.ts` |
| `GET /api/autopilots/{id}/runs`：默认 `limit=20`、上限 100，返回 `{ runs, total }`，列表**不含** `trigger_payload` | `server/internal/handler/autopilot.go:2256-2295` |
| 运行状态枚举 `issue_created/running/completed/failed/skipped`，来源 `schedule/manual/webhook/api` | `packages/core/types/autopilot.ts` |
| 运行状态与来源的英文文案 | `packages/views/locales/en/autopilots.json`（`run_status` / `run_source` / `trigger_kind` / `status` / `execution_mode`） |
| `POST /api/autopilots/{id}/trigger`：成功与「准入被拦截」都返回 200，body 带 `status` + `reason_code`；配额超限返回 429 + `{ reason_code: "quota_exceeded", reset_at }`；非 active 返回 400 | `server/internal/handler/autopilot.go:2365-2433` |
| web 发送 `Idempotency-Key` 头 | `packages/core/api/client.ts:4374-4381` |
| run-now 成功判定是白名单，未知状态不得当成功 | `packages/views/autopilots/components/run-now-toast.ts` |
| 移动端 `ApiError` 自带 `status` 与 `body`，可读 `reason_code` | `apps/mobile/data/api.ts:179-186`、`apps/mobile/lib/dispatch-reason.ts` |
| 移动端 `data/queries/**` 只放查询，变更放 `data/mutations/**` | `apps/mobile/data/mutations/pins.ts` |
| 单测范围仅 `lib/**`、`data/**` 的 `.test.ts`（node 环境，不渲染组件） | `apps/mobile/vitest.config.ts` |
| 移动端无 autopilot 相关 WS 事件，刷新靠聚焦/重连与下拉 | `apps/mobile/data/realtime/*`（无 autopilot updater）、`packages/core/types/events.ts` |
| More 下拉菜单才有列表入口；`(tabs)/more.tsx` 是重定向占位 | `apps/mobile/components/nav/more-tab-dropdown.tsx`、`apps/mobile/app/(app)/[workspace]/(tabs)/more.tsx` |
| web 的 autopilots 路由图标是 Zap | `packages/core/paths/route-icons.ts:94` |

## 4. 验收条件

1. More 菜单出现 `Autopilots` 项，可进入列表页；列表行内容按 §2.1，三态与下拉刷新可用。
2. 详情页可打开，头部 / 属性 / Triggers / Run history 按 §2.2；有 `issue_id` 的运行行可跳 issue。
3. Run now 全部分支按 §2.3 呈现，且不出现「假成功」。
4. 纯函数映射有单测：状态/来源/触发器类型文案、运行结果分类、`reason_code` 文案、下次触发与运行时间格式化、
   触发器摘要与列表排序。
5. `pnpm --filter @multica/mobile typecheck`、`lint`、`test` 全绿。
6. **不自行启动模拟器**；真机/模拟器视觉验收由用户自测，交付评论中明确区分静态验证与设备验收。
7. 合并进 `main` 后按 issue 交棒要求启动第 4 波（FEATURE-569）。

## 5. 风险与边界

- **时区呈现**：web 在触发器时区渲染 `next_run_at`（`formatInTimeZone`）；移动端只有设备本地时区的
  `Intl.DateTimeFormat`（`lib/inbox-display.ts` 既有写法，Hermes 的 `timeZone` 支持不可靠），
  故本轮按设备本地时间渲染，并把触发器配置的时区作为独立事实行展示；不猜时区换算。
- **`failure_reason` 是开放字符串**：运行行按 web 原样展示，未识别不影响行渲染。
- **More 菜单同文件冲突**：`components/nav/more-tab-dropdown.tsx` 也是 FEATURE-566 可能触碰的文件，
  本任务只加一行 `NAV_ITEMS`，把冲突面降到最小。
- **Agents 入口缺失**：FEATURE-565 已记录 Agents 未进 More 菜单，本任务不越界补。
- **列表无分页**：列表接口一次返回全部（active + paused），与 web 的「all」范围一致，不自行加筛选。
