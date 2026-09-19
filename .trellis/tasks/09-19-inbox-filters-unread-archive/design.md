# 设计

## 1. 状态与数据流

```
                       ┌──────────────────────────── data/stores/inbox-view-store.ts
                       │  view: "inbox" | "archived"
                       │  statuses[] / priorities[] / actors[] / unreadOnly
                       └───────────────┬───────────────────────────────
        (formSheet) inbox-filter.tsx   │ 读写           inbox.tsx 读
                                       ▼                        ▼
                        ┌──────────────────────────┐   ┌───────────────────────────┐
                        │ 筛选面板：四段 + 计数      │   │ 列表：按 view 选数据源      │
                        │ 计数：主视图本地 / 归档facets│   │  主：inboxListOptions      │
                        └──────────────────────────┘   │  归档：archivedInboxPages  │
                                                       └──────────────┬────────────┘
                                                                      ▼
                                                      lib/inbox-filters.ts（纯函数）
                                                      filterInboxItems / count / actor key
```

- 归档视图的 filters **同时**进服务端查询参数（分页端点自带筛选）与本地 `filterInboxItems`，
  与 web 一致；本地那次是幂等的收紧，不会与服务端结果打架。
- 主视图不做服务端筛选（`GET /api/inbox` 无参数，与 web 相同），只本地过滤。

## 2. 缓存键与失效

```
["inbox", wsId, "list"]                 main list
["inbox", wsId, "archived", "pages"]    infinite query（分页，key 里带归一化 filters）
["inbox", wsId, "archived", "facets"]   归档筛选计数（仅面板打开 + 归档视图时请求）
["inbox", "unread-summary"]             账号级未读汇总（不动）
```

- `refreshInboxList(qc, wsId)` 由 `inboxKeys.list(wsId)` 放宽为 `inboxKeys.all(wsId)`
  （`["inbox", wsId]`）：一个 inbox 事件可能同时改变主列表与归档列表（web 的
  `onInboxNew` 注释：「归档 issue 上的新通知会把该 issue 放回主收件箱，也就是说它必须离开归档列表，
  这个归属由服务端决定」）。前缀失效天然覆盖 list / pages / facets 三个 key。
- `data/realtime/inbox-ws-updaters.ts` 的 `patchInboxIssueStatus` / `dropInboxItemsByIssue`
  从「只 patch 主列表」扩到「主列表 + 所有归档缓存」，需要一个 mobile 版的
  `mapArchivedInboxCache`（区分 array / `{items}` / `{pages}` 三种缓存形态）。
- 归档分页 key 里的 filters 归一化（数组排序后入 key），与 web 的 `normalizedInboxFilters` 同：
  否则同一次选择的不同顺序会cache miss 出两个条目。

## 3. 乐观更新

| 动作 | 打什么补丁 | 回滚 | settle |
|---|---|---|---|
| mark read | 主列表行 `read:true`（同步，导航快照要求，已有） | 快照 | 刷新列表 + 未读汇总 |
| mark unread | 主列表 + **所有归档缓存** 行 `read:false` | 快照 | 同上（未读汇总要重新变高） |
| archive（已有） | 主列表该行与同 issue 行 `archived:true` | 快照 | 同上 |
| unarchive | 先解析 group 的 issue_id → 所有归档缓存把该行与同 issue 行 `archived:false` | 快照 | 同上（两个列表 + 汇总） |

- mark-unread 要 care 归档缓存：`read` 与 `archived` 是正交字段，归档行也带 `read`（web 注释：
  归档保留 read，取消归档时还原真实状态）。手机端目前没有从归档里 mark read 的入口，
  但 WS 事件/其它端会改，补丁必须一致，否则归档里取消归档后未读点会闪错。
- unarchive 不打主列表补丁：主列表是服务端 `GET /api/inbox` 的全量结果，行归属由服务端算
  （archive 的既有实现同理只 patch 会让行消失的那一侧）；行重新出现在主列表靠 settle 刷新。

## 4. UI 结构（手机适配，保留 web 语义）

```
inbox.tsx
├─ Header title="Inbox"（归档视图标题不变，子视图靠列表顶部返回行表达）
│   right = [FilterButton(生效计数)] [ellipsis 批量菜单（仅主视图）] [HeaderActions]
├─ InboxFilterChips（有选择时：仅未读 / 状态 / 优先级 / 来源 的 chip，点 chip 取消该项）
├─ archived 视图：顶部「‹ 归档」返回行
├─ FlatList
│   ├─ SwipeableInboxRow（action = archive 或 unarchive，滑动后需点击）
│   ├─ 行 onLongPress → showActionSheet（主视图：标记未读/已读 + 归档；归档视图：取消归档）
│   └─ 主视图 ListFooter：底部「归档」入口行
└─ 空态：无筛选→Inbox zero；有筛选无命中→提示 + 清除筛选；归档空→归档空态
```

- **为什么不把筛选做成头部下拉**：mobile 没有 hover/popover，多维度 + 计数在下拉里会溢出；
  `issues-filter.tsx` 已经是本项目「多维度筛选」的既有容器（AGENTS.md 的表格：长列表/表单 → formSheet）。
- **长按与滑动共存**：`ReanimatedSwipeable` 占横向 pan，`InboxRow` 的 `Pressable` 长按占「按住不动」，
  两者手势不冲突（RN 的长按在移动超过阈值时自动取消）。滑动仍要求「露出后点击」，不自动执行
  （沿用 `swipeable-inbox-row.tsx` 的既有约定 + 一次性触感）。
- **归档入口的位置**：主视图放列表底部（滚动后可达），归档视图放列表顶部（返回），与 web 同。

## 5. 有意差异（写进交付）

1. 筛选状态的生命周期：web 按 workspace 分桶；mobile 切换 workspace 时清空（my-issues 既有约定）。
2. web 行菜单的「Open in new tab」不搬运：手机上点击行就是打开。
3. i18n：mobile 目前英文单语，文案取 web `locales/en/inbox.json` 的对应措辞。

## 6. 风险

- 归档分页 + 乐观 unarchive 的 key 形态有三种（array / `{items}` / `{pages}`）；补丁函数必须
  对形态做穷尽处理，否则会静默漏掉一种缓存。测试用 `{pages}` 形态覆盖（产品里真实存在的形态）。
- `useInfiniteQuery` 在 mobile 是首次使用：`FlatList` 的 `onEndReached` + `fetchNextPage`
  要加 `hasNextPage && !isFetchingNextPage` 守卫，避免反复触发同一页。
- 归档视图的 filters 进 key：切换筛选会重新请求（页码从头开始），这是 web 的行为，不是缺陷。
