# Design · Agents 只读视图

## 1. 数据流

```
列表页  more/agents.tsx
  ├─ useQuery(agentListOptions(wsId))            → Agent[]（含 presence 派生所需的 runtime_* 字段）
  ├─ useQuery(agentTaskSnapshotOptions(wsId))    → AgentTask[]（活跃 + 每人最近一条终态）
  └─ useWorkspacePresenceMap(wsId)               → Map<agentId, AgentPresenceDetail>（内部复用上面两个 query）

详情页  more/agents/[id].tsx
  ├─ useQuery(agentListOptions(wsId))            → 该 agent（列表即详情来源，避免新增 GET /api/agents/{id}）
  ├─ useQuery(agentTasksOptions(wsId, id))       → AgentTask[]（GET /api/agents/{id}/tasks，本页新增）
  ├─ useAgentPresence(wsId, id)                  → AgentPresenceDetail | "loading"
  ├─ useQuery(runtimeListOptions(wsId))          → RuntimeDevice[]（把 runtime_id 解析成机器名）
  ├─ useActorLookup()                            → owner 名称（member 列表）
  └─ useWSSubscriptions(task:*)                  → 失效 agentTasksOptions（本页记录，卸载即退订）
```

### 1.1 为什么详情用列表缓存而不是新增 `GET /api/agents/{id}`

`GET /api/agents` 返回完整 `Agent`（含 `model`、`runtime_id`、`owner_id`、`visibility`、`max_concurrent_tasks`、`created_at`、`archived_at`），
且该列表已被 `use-presence-realtime` 的 `agent:*` 事件失效维护。详情再从列表里按 id 取，得到一个缓存、一条实时链路，零额外请求。
代价：直接深链到列表里不存在的 agent（归档/已删）会得到「找不到」态 —— 这与列表范围一致，不是回归。

新增端点只用于**运行历史**：web 详情页的 Recent work 走 `GET /api/agents/{id}/tasks`，移动端没有任何等价来源
（`agent-task-snapshot` 每人只有一条终态记录，撑不起「最近任务/运行含状态与耗时」）。

## 2. 文件与职责

| 文件 | 类型 | 职责 |
|---|---|---|
| `apps/mobile/lib/agent-runs.ts` | 新增（纯） | 任务分桶/排序、最近活动取数、耗时计算与文案 |
| `apps/mobile/lib/agent-runs.test.ts` | 新增 | 上述纯函数的单测 |
| `apps/mobile/components/agents/agent-presence-line.tsx` | 新增 | 圆点 + availability/workload 英文文案 + `running/capacity` 的横向状态行（列表行与详情头共用） |
| `apps/mobile/components/agents/agent-row.tsx` | 新增 | 列表行（`Pressable` + 头像 + 名称/描述 + 状态行 + 右侧时间列） |
| `apps/mobile/components/agents/agent-detail-header.tsx` | 新增 | 详情身份块（大头像 + 名称 + 描述 + 徽标） |
| `apps/mobile/components/agents/agent-facts-section.tsx` | 新增 | 基本信息 + 当前状态（iOS Settings 风格只读行） |
| `apps/mobile/components/agents/agent-runs-section.tsx` | 新增 | 最近运行两段（Active / Recent），行可跳 issue |
| `apps/mobile/app/(app)/[workspace]/more/agents.tsx` | 重写 | 列表路由（FlatList + 三态 + 下拉刷新） |
| `apps/mobile/app/(app)/[workspace]/more/agents/[id].tsx` | 新增 | 详情路由（ScrollView + 三态 + 下拉刷新 + 本页 WS 订阅） |
| `apps/mobile/data/api.ts` | 追加 | `listAgentTasks(agentId, opts?)` |
| `apps/mobile/data/queries/agents.ts` | 追加 | `agentTasksOptions(wsId, agentId)` |
| `apps/mobile/app/(app)/[workspace]/_layout.tsx` | 追加 | `<Stack.Screen name="more/agents/[id]">` |

`more/agents.tsx` 与 `more/agents/[id].tsx` 共存是 expo-router 的合法形态，本仓已有先例（`more/settings.tsx` + `more/settings/profile.tsx`）。

## 3. 关键决策

1. **presence 唯一来源是 core 派生函数**。不本地重算 availability/workload（`apps/mobile/AGENTS.md`「State enums and transitions must agree」）；
   颜色沿用既有 `PresenceDot`（online→success / unstable→warning / offline→muted）。
2. **`agent.status` 不用来展示当前状态**。它是后端历史字段（idle/working/blocked/error/offline），与 presence 语义重叠且不反映 runtime 可达性；
   UI 统一读派生 presence，避免同一屏出现两套状态。
3. **文案英文硬编码**，与 `availability` / `workload` 的 en locale 一致（Online / Unstable / Offline / Archived / Working / Queued / Idle），
   不引入 i18n 基础设施。
4. **运行行不做取消**。`RunRow`（issue 版）带 Cancel 按钮与 `useCancelTask`，属写操作；本任务只读，故新增 `AgentRunRow` 而非改 `RunRow`。
5. **耗时口径**：终态 = `completed_at - (started_at ?? created_at)`；进行中 = `now - (started_at ?? created_at)`；
   缺 `started_at` 回退 `created_at`；两者都缺则不出耗时文案。格式化复用既有 `formatElapsedMs`（web/移动端同一套 `12s` / `2m 04s` 读法）。
6. **本页实时**用 `useWSSubscriptions` 就地订阅 `task:*` 六个生命周期事件并只失效本页 `agentTasksOptions`：
   不把订阅塞进 `data/realtime/use-presence-realtime.ts`（那会全局订阅本页专属的 key，且该文件不在本任务边界内）。
7. **列表排序**「最近活动倒序」的活动时间取 `agentTaskSnapshot` 里该 agent 任务的 `max(completed_at ?? created_at)`；
   无记录 → 排到最后。与 web 默认排序（Recent activity）语义一致，但不引入 `agent-activity-30d` 端点。

## 4. 状态与错误处理

| 状态 | 列表页 | 详情页 |
|---|---|---|
| 加载中 | 4 行骨架（`Skeleton`） | 骨架块 |
| 空 | `No agents yet` | agent 不存在 → `Agent not found`；运行列表空 → `No runs yet` |
| 错误 | `Couldn't load agents` + Try again（`refetch`） | 列表查询错误 → `Couldn't load this agent` + Try again；**仅运行查询错误** → 运行段内 `Couldn't load runs`（页面其余部分照常显示），403 归此类 |

## 5. 测试策略

移动端 vitest 为 node 环境、只收 `lib/**` 与 `data/**` 的 `.test.ts`，因此把**可测逻辑全部下沉到 `lib/agent-runs.ts`**：
分桶、排序、最近活动、耗时。组件与路由是纯装配，靠 typecheck + lint + 既有约定保证；设备视觉验收交用户。

`data/queries/agents.ts` 追加的 `agentTasksOptions` 以现有 `agents.test.ts` 的方式补一条 queryKey/`enabled` 断言
（与既有 `agentListOptions` 测试同风格，不 mock 网络之外的实现细节）。
