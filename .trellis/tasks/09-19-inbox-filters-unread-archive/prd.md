# 收件箱：筛选 + 标记未读 + 归档视图

## Goal

`apps/mobile` 收件箱补齐三项管理能力，语义与网页端一致：

1. **筛选**：状态 / 优先级 / 来源（actor）/ 仅未读，含「清除筛选」与「生效计数」。
2. **标记未读**：与既有的标记已读成对（web 的行菜单是 read/unread 切换）。
3. **归档视图**：可切到已归档通知列表，并在其中**取消归档**。

对应 issue FEATURE-577（stage 10 第 1 波，与 FEATURE-576 并行）。交付：新 APK 走 GitHub Release，用户真机自测。

## 已核实事实（读 web 实现 + 后端 handler + mobile 现状）

### 网页端口径（唯一参考）

- 筛选逻辑：`packages/core/inbox/filter-store.ts`
  - 四个维度：`statuses` / `priorities` / `actors` / `unreadOnly`。
  - `inboxActorKey(item)`：member/agent 用 `type:id`；`system` 没有 id（后端写无效 UUID → 序列化成 null），
    只按类型归档成 `"system"` 一个桶；没有 `actor_type` 的行返回 null，永远匹配不上任何选择。
  - `filterInboxItems`：**维度内 OR，维度之间 AND**；每个维度都读「列表实际渲染的那一行」
    （去重后每组的最新一条），所以「按谁筛」=「看到谁」。
  - `unreadOnly` 读的也是渲染行的 `read`（与未读徽标的服务端口径一致）。
  - `inboxPriorityFilterSupport(items)`：**从响应推断能力**——老后端不返回 `issue_priority` 字段，
    此时优先级筛选不该出现；`unknown`（列表为空）保持休眠不清选择，只有确认 `unsupported` 才清。
    archived 视图直接视为 `supported`（facets 端点始终返回 priorities）。
  - `inboxFilterCount` 是四个维度的**选择数之和**，即 web 触发按钮上的生效计数。
- 筛选 UI：`packages/views/inbox/components/inbox-filter-menu.tsx`
  - 计数是**分面**的：每个数字在「应用其它维度、忽略自己这一维」的子集上统计。
  - 主视图的计数在客户端算（列表已全量加载）；**归档视图用服务端 facets**（归档列表分页，
    只有服务端知道全量计数）。
  - 触发按钮：无选择时 ghost，有选择时 `variant=default` + 品牌底色 + 计数文本；
    `activeCount > 0` 时菜单底部出现 `clear`（清除筛选）。
- 行/上下文菜单：`inbox-row-menu.tsx` → `inbox-item-actions.tsx`
  - 分组：①（有 issue 时）打开链接 ②**主视图才有** read/unread 切换 ③archive/unarchive
    （archive 视图里同一个动作变成 unarchive）。
  - 注释明确：归档行里不做 read 切换——归档保留 `read`（取消归档要还原真实状态），
    未读计数也不含归档行，所以切换只会「报成功但画面无变化」。
- 归档视图：`inbox-page.tsx` + `inbox-list.tsx` + `inbox-view.ts`
  - `view: "inbox" | "archived"` 是两个互斥的数据源，不是在同一份列表上叠加过滤。
  - 主视图列表**底部**有一行入口进归档；归档视图**顶部**有一行返回入口（页面标题仍是 Inbox，读作子视图）。
  - 归档视图隐藏批量操作（每个批量入口都是从**主收件箱**归档，放在归档列表里会读成「归档这些」却做反操作）。
  - 归档列表用 `GET /api/inbox/archived/page`（游标分页，limit 50，filters 作为查询参数），
    行内动作是 unarchive，未读标记不渲染（`showUnread = read !== true && !isArchivedView`）。
- 写入的乐观更新：`packages/core/inbox/mutations.ts`
  - `useMarkInboxUnread`：cancel 整个 `inboxKeys.all(wsId)` → 主列表与**所有归档缓存**同时把该行 `read:false`。
  - `useUnarchiveInbox`：先把 group（issue_id）从归档缓存里解析出来 → 所有归档缓存把该行与同 issue 的行
    `archived:false`（于是它立刻从归档列表消失）→ settle 后同时刷新两个列表 + 未读汇总。
- 缓存刷新：`packages/core/inbox/ws-updaters.ts`
  - `patchInboxLists` 同时patch主列表与所有归档缓存（`mapArchivedInboxCache`）；
  - `issue:deleted` 也从归档缓存里删行。

### 后端事实

- `server/internal/handler/inbox_archive.go`：`GET /api/inbox/archived/page` 返回
  `{items, next_cursor, has_more}`（cursor 空 ↔ has_more=false），`GET /api/inbox/archived/facets`
  返回 `{statuses, priorities, actors, unread_count}`；共享的 filters 解析是
  `parseArchivedInboxFilters`（`statuses` / `priorities` / `actors` 逗号分隔，`unread_only=true`）。
- `POST /api/inbox/{id}/unread`、`POST /api/inbox/{id}/unarchive`：web 客户端已在用
  （`packages/core/api/client.ts:2627`、`2678`），**不需要新增端点**。
- schema 已就绪且是纯数据：`packages/core/api/schemas.ts` 的 `ArchivedInboxPageSchema`
  （snake_case → camelCase 并校验 `has_more === (next_cursor !== null)`）与 `ArchivedInboxFacetsSchema`；
  mobile 已有多处 `import { … } from "@multica/core/api/schemas"`（在共享白名单内）。

### mobile 现状缺口

- `data/mutations/inbox.ts` 只有 mark-read / archive / 四个批量归档 —— 无标记未读、无取消归档。
- `data/api.ts` / `data/queries/inbox.ts` 没有 archived page / facets / unread / unarchive。
- 无筛选状态、无归档视图；`inbox-ws-updaters.ts` 只 patch 主列表；`use-inbox-realtime.ts` 里
  `inbox:unarchived` 的注释与注释里「mobile 没有归档视图」都已过期。
- 可复用的既有 mobile 模式：`app/(app)/[workspace]/issues-filter.tsx`（formSheet 筛选面板）、
  `data/stores/issues-view-store.ts`（zustand 视图 store）、`lib/use-clear-filters-on-workspace-change.ts`、
  `lib/inbox-display.ts`（去重）、`components/ui/action-sheet.tsx`（长按菜单）、
  `lib/issue-status.ts` 的 `statusOptions` + `lib/use-issue-statuses.ts`、
  `data/use-actor-name.ts` 的 `useActorLookup`。

## Requirements

1. **筛选状态**：新增 mobile 视图 store（`view` + 四维筛选），workspace 切换时清空（与 my-issues 一致）。
2. **筛选面板**：formSheet 路由，复用 issues-filter 的布局：仅未读 / 来源 / 状态 / 优先级四段，
   每行显示 checkbox 与**分面计数**；优先级段只在能力为 supported 时出现；顶部 Reset 清空全部。
   计数来源：主视图按 web 在客户端算；归档视图用服务端 facets。
3. **生效计数**：收件箱头部筛选按钮在有选择时显示生效计数（数字），无选择时不显示。
4. **标记未读**：行菜单（长按）在主视图提供 read ↔ unread 切换；归档视图不提供（web 同）。
5. **归档视图**：头部/列表提供互相切换的入口；归档列表用游标分页（滚到底续拉）；行内动作是
   取消归档（滑动 + 长按菜单）；归档行的未读标记不渲染；归档视图隐藏批量归档菜单。
6. **乐观更新与回滚**：mark-unread 与 unarchive 与既有 mark-read/archive 同一套
   （`onMutate` 打补丁、`onError` 回滚、`onSettled` 刷新列表 + 未读汇总）；unarchive 同时 patch
   归档分页缓存，让行立即从归档列表消失。
7. **实时与缓存一致性**：`refreshInboxList` 覆盖归档缓存（含 facets）；`issue:updated` / `issue:deleted`
   的 patch 也要覆盖归档缓存（web 的 `patchInboxLists` 同）。
8. **筛选为空与归档为空**：有筛选但无命中 → 提示 + 「清除筛选」；归档为空 → 归档空态文案。

## Acceptance Criteria

- [ ] `lib/inbox-filters.test.ts` 覆盖：维度内 OR / 维度间 AND；三个维度各自为空时不参与；
      status/priority 为 null 的行匹配不上该维度的任何选择；actor key 的 system 折叠与 null 返回；
      `unreadOnly` 只放 `read !== true`；`inboxFilterCount` 计数；`inboxPriorityFilterSupport` 的
      unknown / supported / unsupported 三分支与「unknown 不清选择、unsupported 才清」。
- [ ] `lib/inbox-display.test.ts` 增加：`deduplicateArchivedInboxItems` 只保留 `archived` 行、
      按 issue 分组取最新、comment_id 锚点保留、按时间倒序（与主列表同一套分组规则）。
- [ ] `data/mutations/inbox.test.ts` 覆盖**状态流转**：mark-unread 把行改回未读并在失败时回滚；
      unarchive 从归档分页缓存移除该行（同 issue 的行一起）并在失败时回滚；两者 settle 后刷新
      列表与未读汇总。
- [ ] `pnpm --filter @multica/mobile typecheck` / `lint` / `test` 全过（收尾一次跑完）。
- [ ] 不自行启动模拟器；打新 APK 走 GitHub Release，交付里给文件名、大小、SHA-256、签名证书指纹
      与真机自测步骤（筛出仅未读 → 标记未读 → 归档 → 归档视图里取消归档）。
- [ ] 结论写清本地验证（静态检查）与真机验收的边界。

## Boundaries

- 独占 `apps/mobile/app/(app)/[workspace]/(tabs)/inbox.tsx`、`apps/mobile/components/inbox/**`、
  `apps/mobile/data/mutations/inbox.ts`、`apps/mobile/data/queries/inbox.ts`。
- 只追加：`data/api.ts`、`app/(app)/[workspace]/_layout.tsx`（不动别人的内容、不重排）。
- 新增 inbox 专属文件（视图 store、筛选路由、纯函数与其测试）不与 FEATURE-576（issue 详情）/ FEATURE-579（聊天）重叠。
- 不改 issue 详情与聊天；不改 `packages/core`（只复用纯 schema 与类型）；不改后端。
- 不自行启动模拟器。

## Notes

- 与 web 的有意差异（交付里说明）：web 的筛选状态按 workspace 分桶保存；mobile 沿用 my-issues 的
  做法在切换 workspace 时清空（移动端单工作区会话，`useClearFiltersOnWorkspaceChange`）。
- web 行菜单的「Open in new tab」是桌面 affordance，手机点击行本身就是打开，不搬运。
- 平台约束（长按与滑动共存、formSheet 回传、无 hover）写回
  `.trellis/spec/mobile/frontend/android-platform.md`。
