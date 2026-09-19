# 实施步骤

## 步骤

1. `apps/mobile/lib/inbox-filters.ts`（新）：镜像 `packages/core/inbox/filter-store.ts` 的
   `InboxFilters` / `EMPTY_INBOX_FILTERS` / `isEmptyInboxFilters` / `inboxActorKey` /
   `inboxActorKeyParts` / `filterInboxItems` / `inboxFilterCount` / `inboxPriorityFilterSupport` /
   `inboxFiltersForPrioritySupport`，外加 web filter-menu 里的分面计数派生
   （`inboxStatusCounts` / `inboxPriorityCounts` / `inboxActorCounts` / `inboxUnreadCountIn`）。
2. `apps/mobile/lib/inbox-filters.test.ts`（新）：维度内 OR / 维度间 AND / 空维度 / null 字段 /
   actor key（system 折叠、无 actor 返回 null）/ unreadOnly / 计数 / 优先级能力四分支。
3. `apps/mobile/lib/inbox-display.ts`：加 `deduplicateArchivedInboxItems`（与主列表同一套分组，只留 archived）。
4. `apps/mobile/lib/inbox-display.test.ts`：补 archived 去重用例。
5. `apps/mobile/data/stores/inbox-view-store.ts`（新）：zustand `view` + 四维筛选 + toggle/clear
   （`clearPriorityFilters` 保留其它维度，避免误清用户选择）。
6. `apps/mobile/data/api.ts`（只追加）：`archivedInboxParams` + `listArchivedInboxPage`（infinite，带 signal）
   + `getArchivedInboxFacets` + `markInboxUnread` + `unarchiveInbox`，读端点走 `fetchValidated`
   配 `ArchivedInboxPageSchema` / `ArchivedInboxFacetsSchema`（core 纯 schema）。
7. `apps/mobile/data/queries/inbox.ts`：加 `archived` / `pages` / `facets` 三个 key 与
   `archivedInboxPagesOptions`（infiniteQueryOptions，limit 50）/ `archivedInboxFacetsOptions`。
8. `apps/mobile/data/mutations/inbox.ts`：加 `mapArchivedInboxCache` + `patchArchivedInboxCaches`，
   `useMarkInboxUnread`、`useUnarchiveInbox`（乐观 + 回滚 + settle 刷新），文件头注释补两段。
9. `apps/mobile/data/realtime/inbox-ws-updaters.ts`：`refreshInboxList` 放宽到 `inboxKeys.all(wsId)`；
   `patchInboxIssueStatus` / `dropInboxItemsByIssue` 覆盖归档缓存；注释同步（archive 视图已存在）。
10. `apps/mobile/components/inbox/inbox-row.tsx`：加 `onLongPress`（可选）与 `archivedView`（可选，
    抑制未读点/加粗，与 web 的 `showUnread` 同）。
11. `apps/mobile/components/inbox/swipeable-inbox-row.tsx`：把右侧动作参数化（archive / unarchive
    的图标、文案、颜色），默认仍为 archive。
12. `apps/mobile/components/inbox/inbox-filter-chips.tsx`（新）：四维 chip 行（含「仅未读」），
    点 chip 取消该项，与 my-issues 的 chip 视觉一致。
13. `apps/mobile/app/(app)/[workspace]/inbox-filter.tsx`（新，formSheet body）：仅未读 / 来源 / 状态 /
    优先级四段 + 分面计数；优先级段受能力控制；顶部 Reset；计数主视图本地算、归档视图读 facets。
14. `apps/mobile/app/(app)/[workspace]/(tabs)/inbox.tsx`：接 view/store/筛选/分页/长按菜单/入口行/空态。
15. `apps/mobile/app/(app)/[workspace]/_layout.tsx`：注册 `<Stack.Screen name="inbox-filter" options={SHEET_OPTIONS} />`。
16. `apps/mobile/data/mutations/inbox.test.ts`（新）：mark-unread / unarchive 的状态流转与回滚。
17. `.trellis/spec/mobile/frontend/android-platform.md`：补平台约束（长按 + 滑动共存、formSheet 回传、无 hover）。
18. `apps/mobile/app.config.ts`：`versionCode` +1（分发要求，与既有发版一致）。

## 验证

- 中途只跑改动直接相关的用例：
  `rtk test -- corepack pnpm exec vitest run --config apps/mobile/vitest.config.ts apps/mobile/lib/inbox-filters.test.ts apps/mobile/lib/inbox-display.test.ts apps/mobile/data/mutations/inbox.test.ts`
- 收尾一次跑完整检查（code-helper 形态）：`rtk err -- corepack pnpm --filter @multica/mobile typecheck`、
  lint、`rtk test -- corepack pnpm --filter @multica/mobile test`。
- 不启模拟器；真机验收由用户按 Release 说明执行。

## 回滚

删除新增的 5 个文件（lib/inbox-filters.ts + .test.ts、data/stores/inbox-view-store.ts、
components/inbox/inbox-filter-chips.tsx、app/.../inbox-filter.tsx、data/mutations/inbox.test.ts），
还原 `inbox.tsx` / `inbox-row.tsx` / `swipeable-inbox-row.tsx` / `data/api.ts` / `data/queries/inbox.ts` /
`data/mutations/inbox.ts` / `data/realtime/inbox-ws-updaters.ts` / `lib/inbox-display.ts` / `_layout.tsx`。
