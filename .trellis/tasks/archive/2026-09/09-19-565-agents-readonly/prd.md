# PRD · Agents 只读视图（列表 + 详情）

- 上游 issue：FEATURE-565（阶段 7 第 2 波牵头任务）
- 包：`mobile`；分支：`feature/565-agents-readonly`；目标分支：`main`
- 类型：轻量偏中（1 个新路由 + 1 个新路由目录 + 4 个域组件 + 1 个纯函数模块 + 数据层追加）

## 1. 背景与现状

`apps/mobile/app/(app)/[workspace]/more/agents.tsx` 目前是 12 行占位页，渲染 "Agents coming soon."。
移动端此前只有「消费 agent」的零散表面（issue 的 agent 工作态徽标、聊天页 agent 头、picker 里的 agent 行），
没有「查看 agent 本体」的入口视图。web 端已有完整 Agents 列表页与详情页。

本任务把占位页换成**只读**的 Agents 列表与详情，取 web 的只读子集。

## 2. 目标（可验收行为）

### 2.1 列表页 `more/agents`

- 每行展示：头像（带 presence 圆点）、名称、presence 文案（Online / Unstable / Offline）、workload 文案（Working / Queued / Idle，含 `running/capacity`）、模型名、最近活动时间。
- agent 描述非空时，行内以单行次要文字展示。
- 排序：最近活动时间倒序；无活动记录的排在后面，同组按名称升序。
- 三态：加载（骨架行）、空态（"No agents yet"）、错误态（"Couldn't load agents" + Try again）。
- 下拉刷新。

### 2.2 详情页 `more/agents/[id]`

- 头部身份块：大头像（带 presence 圆点）、名称、描述、`Archived` / `Needs a runtime` 徽标。
- 基本信息（只读行）：Model、Runtime、Owner、Visibility、Created。
- 当前状态：presence（availability + workload + running/queued 计数）、并发上限。
- 最近运行：Active（queued / dispatched / waiting_local_directory / running）与 Recent（终态）两段，每行含状态、触发摘要、相对时间、**耗时**（`started_at` → `completed_at`；进行中为 `started_at` → now）；失败行沿用移动端既有失败原因短文案。
- 关联 issue：运行行有 `issue_id` 时整行可点，跳 `/[slug]/issue/[id]`。
- 三态：加载骨架、空态（"No runs yet"）、错误态（含 403 无权限：`You don't have access to this agent`）、agent 不存在态。
- 下拉刷新；WS `task:*` 生命周期事件到达时刷新本页运行列表（复用 `useWSSubscriptions`，只订阅本页记录）。

### 2.3 非目标（P2，本任务不做）

新建 agent（含 AI 向导）、编辑、调试台/转录、Skills / MCP / Env 绑定管理、归档与恢复、取消运行、
归档 agent 范围切换（`include_archived`）、30 天活动序列与 runs 统计列、Runtime 机器筛选。

## 3. 已核实的事实（编码依据）

| 事实 | 证据 |
|---|---|
| `GET /api/agents` 默认**不含**归档 agent（`include_archived=true` 才含） | `server/internal/handler/agent.go:1114` |
| 移动端 `api.listAgents()` 无参调用 → 列表即 web 默认「Active agents」范围 | `apps/mobile/data/api.ts:582-589` |
| `GET /api/agents/{id}/tasks` 返回**裸数组** `AgentTaskResponse[]`，按 agent 全量任务 | `server/internal/handler/agent.go:2667-2710`、`packages/core/api/client.ts:2507` |
| 该端点对私有 agent 的普通成员返回 403 | `server/internal/handler/agent.go:2677-2681`、`server/internal/handler/agent_access_test.go:386` |
| presence 两维派生是 core 纯函数，移动端已直接 import | `packages/core/agents/derive-presence.ts`、`apps/mobile/lib/use-agent-presence.ts` |
| availability 四态 / workload 三态英文文案 | `packages/views/locales/en/agents.json`（`availability.*` / `workload.*`） |
| 移动端文案为硬编码英文（无 i18n 基础设施） | `apps/mobile/lib/time-ago.ts` 注释、`components/issue/run-row.tsx` |
| 单测仅覆盖 `lib/**`、`data/**` 的 `.test.ts`（node 环境，不测 tsx） | `apps/mobile/vitest.config.ts` |
| `more/agents` 路由已注册；详情路由未注册 | `apps/mobile/app/(app)/[workspace]/_layout.tsx:350-353` |

## 4. 验收条件

1. `more/agents` 不再是占位页：真实列表 + 三态 + 下拉刷新，行内容按 §2.1。
2. `more/agents/[id]` 可打开：身份块 + 基本信息 + 当前状态 + 最近运行，行内耗时与状态正确，可跳相关 issue。
3. 纯函数映射有单测：任务 active/past 分桶与排序、最近活动取数、耗时计算（含缺 `started_at`、进行中、`completed_at` 缺失兜底）。
4. `pnpm --filter @multica/mobile typecheck`、`lint`、`test` 全绿。
5. **不自行启动模拟器**；真机/模拟器视觉验收由用户自测，交付评论中明确区分静态验证与设备验收。
6. 合并进 `main` 后按 issue 交棒要求启动第 3 波（FEATURE-567 / 568；FEATURE-572 仅在 FEATURE-571 已合并时启动）。

## 5. 风险与边界

- **入口可达性**：More 下拉菜单（`components/nav/more-tab-dropdown.tsx`）目前只有 Pinned / Issues / Projects，无 Agents 项；现状唯一入口是聊天页 `no-agent-banner`。菜单文件不在本任务文件边界内，本任务不动它，交付评论中说明（归 FEATURE-569 或后续统一补菜单）。
- **私有 agent 403**：详情页运行列表可能 403，需错误态兜底而非白屏。
- **`agent.status` 字段**（idle/working/blocked/error/offline）仅存档，UI 的当前状态以派生 presence 为准，避免两套语义打架。
