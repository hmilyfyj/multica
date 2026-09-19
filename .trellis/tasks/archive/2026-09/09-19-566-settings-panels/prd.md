# 设置面板补齐：工作区 / 标签 / issue 状态

## Goal

移动端设置面板（`apps/mobile/app/(app)/[workspace]/more/settings.tsx`）目前只有 Profile 与
Notifications 两个子页。本任务补齐三个移动端可行的工作区管理入口，行为口径以 web
`packages/views/settings/components/{workspace-tab,labels-tab,issue-statuses-tab}.tsx` 为准：
**工作区常规设置**、**标签管理**、**issue 状态管理**。成员 / 邀请 / 集成 / billing / tokens /
repositories / mcp / plugins 与本任务无关。

## 已核实事实（读上游实现 + 后端代码）

1. **工作区设置**（`workspace-tab.tsx` 的 General 段）
   - 字段：logo、name、description、context、slug（只读）、issue_prefix。
   - 权限：`PATCH /api/workspaces/{id}` 在 `server/cmd/server/router.go` 里挂在
     **owner|admin** 组（成员只读）；前端 `canManageWorkspace = role ∈ {owner, admin}`。
   - issue_prefix：`raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)`，空值非法；
     改动前弹确认框（会重编号 `PREFIX-N`），保存后 `invalidate(issueKeys.all(wsId))`
     ——因为 issue 编号是读时按前缀算出来的。
   - web 用 650ms 防抖自动保存（`use-auto-save.ts`）。
   - 危险区（leave / delete workspace）本任务不做。

2. **标签管理**（`labels-tab.tsx` + `server/internal/handler/label.go`）
   - 两个 scope：`issue` / `skill`（`LabelResourceType` 里的 `agent` 产品已不暴露）。
     `GET /api/labels?resource_type=…`，**缺省即 issue**（`defaultLabelResourceType`）。
   - 目录：`GET/POST /api/labels`、`PUT/DELETE /api/labels/{id}`；**无角色门禁**，
     路由挂在 `RequireWorkspaceMember` 组，任何成员可增删改。
   - 校验：name 必填、≤32 runes、不含控制字符；color 必须 `^#?[0-9a-fA-F]{6}$`，服务端归一化为
     小写 `#rrggbb`；重名（跨 resource_type、大小写不敏感）返回 **409**。
   - 描述无长度上限。删除在单个事务里清 issue/agent/skill 三张关联表，并广播 `label:deleted`。
   - 文案键：`packages/views/locales/en/settings.json` 的 `labels.*`。

3. **issue 状态管理**（`issue-statuses-tab.tsx` + `server/internal/handler/issue_status.go`）
   - 目录含 7 个内置态（`is_system`）+ 自定义态，按 4 个 category（`unstarted/started/done/closed`，
     固定顺序）分组；组内按 `position`。
   - 写操作全部 **owner|admin**（handler 内 `requireWorkspaceRole`），读开放给成员。
   - built-in 不可改名 / 改色 / 归档 / 改 category，**但可以在 category 内排序**。
   - 新增：name ≤64、description ≤256、category、color、icon（7 种形状，可留空=默认）；
     `key` 由服务端 `DeriveKey(slugify(name))` 派生，客户端不传。
   - 排序：`PATCH /api/issue-statuses/reorder`，体 `{ category, ids, include_system }`。
     **语义是「整体重写」**：`ids` 必须恰好等于该 category 内全部未归档状态（`include_system=true`
     时含内置态），少一个即 409。响应是完整目录（`include_archived=true`）。
   - 归档：`DELETE /api/issue-statuses/{id}`，**终态、无 restore**；该 key 仍被任何 issue 使用则
     返回 **409 + `{code:"issue_status_in_use", issue_count:N}`**。
   - 文案键：`en/settings.json` 的 `issue_statuses.*`（含 `built_in_dialog`、`archive_dialog`、
     `editor.icon_shapes`、`built_in_descriptions`）。

## Requirements

### R1 设置入口（`more/settings.tsx`）

新增一段 `Workspace settings`，三行导航：General / Labels / Statuses，沿用文件内既有的
`SectionGroup` + `NavRow` 写法。

### R2 工作区常规设置（`more/settings/workspace.tsx`）

- 读当前工作区（`useWorkspaceStore` 的 id/slug + `workspaceListOptions` 缓存）。
- 可编辑：name（必填）、description、context、issue_prefix（大写化、仅 A-Z0-9、≤10）。
- 只读展示：slug。
- 头像：沿用 `profile.tsx` 的 `showActionSheet` + `expo-image-picker` + `api.uploadFile`
  流程，上传后 `PATCH /api/workspaces/{id} { avatar_url }`。
- 保存：显式 Save 按钮（移动端既有形态，`profile.tsx`），非 owner/admin 时全部只读并显示
  `Only admins and owners can update workspace settings.`。
- issue_prefix 变更走 `Alert.alert` 确认；保存成功后失效 `issueKeys.all(wsId)`。
- 缓存：`updateWorkspace` 成功后把返回的 workspace 写回 `workspaceListOptions` 列表。

### R3 标签管理（`more/settings/labels.tsx` + `more/settings/label-form.tsx`）

- scope 切换（issue / skill）+ 顶部搜索（按 name/description 客户端过滤）。
- 列表：色点 + name + description + `{{count}} used`；空态区分「本 scope 还没有标签」与
  「没有匹配」。
- 行点击 → 编辑 formSheet；formSheet 内含 name/description/color，编辑态底部有
  destructive 删除（`Alert.alert` 确认，文案带 usage_count）。
- 色板：镜像 web 的 `COLOR_PICKER_PRESETS` 十个预设 + hex 文本输入（`#rrggbb`）。
- 文案用 `en/settings.json` 的 `labels.*`。

### R4 issue 状态管理（`more/settings/issue-statuses.tsx` + `more/settings/status-form.tsx`）

- 按 category 分组；组标题 = `category_labels` + 描述（`categories`），组头带 `Add status`
  （写入该 category）。
- 行：状态图标 + 名称 + 描述；自定义态用目录里的 name/description/color/icon，内置态用
  `lib/issue-status.ts` 的 `STATUS_LABEL` / `built_in_descriptions`。
- 归档态默认隐藏，有归档项时顶部出现 `Show archived (N)`；归档行带 `Archived` 徽标，
  下方 `archived_hint`。
- 行点击：自定义态 → 编辑 formSheet；内置态 → `built_in_dialog` 提示框。
- 排序：**分类内**上下移动（web 是拖拽）。每次移动发一次 `reorder`（`ids` = 该 category 全部
  未归档状态的新顺序，`include_system=true`），响应整体写回缓存。
- 新增/编辑表单：name、category（编辑时锁定并显示 `category_locked`）、description、color、
  icon（Default + 7 形状）；编辑自定义态时底部 destructive `Archive`，走 `Alert.alert` 确认；
  409 `issue_status_in_use` 时用 `archive_dialog.in_use` 文案展示计数。
- 非 owner/admin：全部只读（无 Add、无排序控件、行不可点）。
- 文案用 `en/settings.json` 的 `issue_statuses.*`。

### R5 数据层

- `data/api.ts` **只追加**：`updateWorkspace`、`updateLabel`、`deleteLabel`、
  `listLabels` 增加可选 `resourceType`、`createIssueStatus`、`updateIssueStatus`、
  `reorderIssueStatuses`、`archiveIssueStatus`。
- `data/queries/labels.ts`：key 增加 resource_type 维度（`["labels", wsId, resourceType]`）。
- `data/mutations/labels.ts`：补 `useUpdateLabel` / `useDeleteLabel`。
- `data/mutations/issue-statuses.ts`（新）：create / update / archive / reorder。
- `data/mutations/workspaces.ts`（新）：`useUpdateWorkspace`。
- `lib/label-color.ts`（新）：预设色板 + hex 归一化/校验。
- `lib/issue-status.ts`：补排序比较器、分类分组、移动后顺序、归档冲突计数等纯函数。

## Acceptance Criteria

- [ ] `pnpm --filter @multica/mobile typecheck` / `lint` / `test` 通过。
- [ ] 标签：新建 / 改名 / 改色 / 删除 的 mutation 单测覆盖（api 入参 + 缓存结果 + 失效）；
      重名 409 的错误路径可见。
- [ ] issue 状态：新增 / 改名 / 归档 / 分类内排序 的 mutation 单测覆盖（含 reorder 的
      「ids 必须是该 category 全部未归档状态」契约、归档 409 冲突计数）。
- [ ] `lib/label-color.ts` 与排序纯函数有单测。
- [ ] 不自行启动模拟器；设备验收交用户真机自测，交付里写清真机自测步骤。
- [ ] 结论写清与 web 的差异点（无拖拽排序、无防抖自动保存、无 leave/delete workspace、
      无归档行「View issues」、无 skill 之外的其它 tab）。

## Boundaries

- 不做成员、邀请、集成、billing、tokens、repositories、mcp、plugins 等 tab。
- 不做 leave workspace / delete workspace。
- 不改 `packages/core`、不改 web/desktop、不改 server。
- 不改 `data/realtime/`（不在本任务文件边界内）；目录的实时收敛依赖 5 分钟 staleTime 与写入后
  的本地缓存更新，差异写进结论。
- `_layout.tsx` 只加本任务的路由条目。

## Notes

- 新发现的平台约束写回 `.trellis/spec/mobile/frontend/android-platform.md`。
- 标签 scope 为 skill 时移动端没有其它技能入口，属于「管理面」而非「使用面」，与 web 一致。
