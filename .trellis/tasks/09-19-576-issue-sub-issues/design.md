# 技术设计

## 数据层

```
GET /api/issues/:id/children          → { issues: Issue[] }                 逐父 issue，父详情页用
GET /api/issues/child-progress        → { progress: [{parent_issue_id,total,done}] }  workspace 级，行的子进度用
```

- `data/api.ts`（只追加）：`listChildIssues(issueId, {signal})` → `Issue[]`；
  `getChildIssueProgress({signal})` → `{ parent_issue_id; total; done }[]`。
  两者都用 `fetchValidated` + core 的 `ChildIssuesResponseSchema` /
  `ChildIssueProgressResponseSchema`（平台无关 schema，属 mobile 白名单），
  返回内层数组（与既有 `listActiveTasksForIssue` 同风格）。
- `data/queries/issue-keys.ts`（只追加）：`children(wsId, id)`、`childProgress(wsId)`。
  不加 `childrenAll` 前缀键——本任务没有批量消费者，knip 会把无消费者的导出当死代码。
- `data/queries/issues.ts`（只追加，按边界要求）：
  - `issueChildrenOptions(wsId, id)`：`queryFn` 去 `.issues`，`refetchOnMount: "always"`
    （对齐 web，理由同 web 注释：别的客户端/agent 可能在别的工作区活跃期建了子 issue，
    全局 staleTime 会复用不完整快照）。
  - `childIssueProgressOptions(wsId)`：`queryFn` 内把数组折成
    `Map<parentId, {done,total}>`（对齐 web 的 `select`）。

## 纯函数（`lib/sub-issues.ts`，Node 单测可覆盖）

- `groupSubIssuesByStage(children)` —— 逐字对齐 web `issue-detail.tsx:421`：stage 升序，
  无 stage 的组**排最后**且只在有内容时出现；组内保持输入顺序。
- `childProgressOf(children)` —— `{done,total}`，done 用 `issueBehavesAs(child, "done")`
  （按生命周期类别，自定义 done 类状态同样计入；cancelled/closed 不计）。
- `subIssueProgressLabel(progress)` —— 行内 `done/total` 文本；无条目或 `total <= 0` 返回 null
  （该行没有子 issue 时不显示角标）。

## 视图

- `components/issue/sub-issues-section.tsx` —— 区块本体：
  - 查询：`issueChildrenOptions` + `childIssueProgressOptions`（后者 `enabled: children.length > 0`，
    叶子 issue 不发这次 workspace 级请求）。
  - 空态：查询成功且 0 个子 issue → `+ Add sub-issues` 文字按钮。
  - 有子 issue：header（`Collapsible` 的 controlled `open` + chevron + `Sub-issues` +
    `done/total` 计数 + `+` 新建按钮）+ 列表；列表按 stage 分组，只有存在 stage 时才画分组头
    （对齐 web）。容器是圆角描边卡片，行间 1px 分隔线。
  - 折叠状态来自 `data/stores/sub-issues-collapse-store.ts`：只记已折叠的 issue id，
    默认展开，**刻意不持久化**（进程内）。放进 store 而不是组件 state，是为了「离开再回来保持原样」。
- `components/issue/sub-issue-row.tsx` —— 不新增行组件：给既有 `IssueRow` 加可选
  `trailing?: ReactNode`（渲染在标题块与指派人之间），子 issue 行用
  `IssueRow(showStatus, trailing=进度文本)`。行的其余部分（状态图标 / 优先级 / 标识 / 标题 /
  自定义状态 chip / 指派人）复用列表页既有实现，避免第二套行样式。
- `components/issue/parent-issue-row.tsx` —— `issue.parent_issue_id` 存在时渲染一行：
  状态图标 + 标识 + 标题 + chevron，点击 push 到父 issue 详情。数据走既有
  `issueDetailOptions(wsId, parentIssueId)`（从父详情进来时通常已在缓存里）。
- `components/issue/timeline-list.tsx` —— `ListHeaderComponent` 里插两处：
  `IssueHeaderCard` 之后、`IssueReactionRow` 之后（子 issue 区块），与 web 的
  「属性 → 父 issue」「描述/反应 → 子 issue → 时间线」相对次序一致。
- `app/(app)/[workspace]/new-issue.tsx` —— 读可选 `parent` 查询参数：创建请求带
  `parent_issue_id`，成功后 invalidate 该父 issue 的 children + childProgress，使返回父详情时
  子 issue 立刻可见；有 parent 时标题显示 `New sub-issue`。表单其余行为不变。
- `app/(app)/[workspace]/issue/[id].tsx` —— 下拉刷新时一并 invalidate children /
  childProgress（时间线以外的子 issue 列表也刷新）。

## 被否掉的方案

1. **新建独立「子 issue 创建」路由**（`issue/[id]/new-sub-issue.tsx`）：
   要在 `components/issue/**` 外复制一整套表单 + 5 个 picker 路由 + 一份 draft store，
   与 web「reuse 创建弹窗、只 seed parent」的做法相反。改为给现有 `new-issue` 加可选参数。
2. **引入 ProgressRing 原语**：只为一个装饰性圆环新增通用原语，违反 AGENTS.md
   「新通用原语需 ≥3 个调用方」；计数文本与 web 完全同源，按文本渲染。
3. **折叠状态用组件局部 state**：离开 issue 再回来会丢失，与 web 的 store 约定不一致；
   持久化则要引 storage 依赖，超出「可仅会话内」的要求。
4. **在实时层补 children 失效**（对齐 web `ws-updaters` 的 `childrenAll` 失效）：
   本轮不做。理由：需求未列实时性；web 的失效逻辑挂在 workspace 级 upsert 钩子上，
   要连带改 `data/realtime/issue-ws-updaters.ts` 与 `use-issues-realtime.ts` 及其测试，
   与「本任务只做子 issue 区块」的边界相比是独立的一块。已用
   `refetchOnMount: "always"` + 下拉刷新 + 创建后显式失效覆盖进入/刷新/自建三条路径，
   差异写进交付说明。
