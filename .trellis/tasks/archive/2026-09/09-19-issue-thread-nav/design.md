# 设计：线程快速跳转

## 边界与契约

新增三个部分 + 改两个文件：

```ts
// apps/mobile/lib/thread-nav.ts —— 纯函数，Node lane 可测（不 import react-native）
export const MIN_THREADS = 2;

export interface ThreadNavItem {
  rootId: string;      // 线程根评论 id（= 跳转目标）
  rowIndex: number;    // 该行在渲染数组里的下标（含 unread 分隔行）
  entry: TimelineEntry;// 根评论
  replyCount: number;  // 非删除回复数（已删除回复不渲染，不计）
  resolved: boolean;   // 根或任一回复 resolved_at（web deriveThreadResolution 口径）
}

buildThreadNav(rows: readonly TimelineRow[]): ThreadNavItem[]
threadIndexAtRow(nav: readonly ThreadNavItem[], topRowIndex: number): number  // 视口顶所在线程；-1 = 在第一个线程之前
threadPreview(entry: TimelineEntry): string   // 首行摘要（stripMarkdown + 首行；删除的根用占位文案）
```

```ts
// apps/mobile/data/stores/thread-nav-store.ts —— 跨路由回传（照 chat-session-picker-store 形态）
jumpRequest: { rootId: string; nonce: number } | null   // sheet 写、TimelineList 读后 consume
currentThreadId: string | null                          // TimelineList 写、sheet 读（标出当前线程）
```

```ts
// 组件
components/issue/thread-nav-fab.tsx    // 悬浮控件：上/下一线程 + 打开清单
components/issue/thread-nav-sheet.tsx  // 清单本体（路由 body 渲染它）
```

## 复用落点：跳转必须走 highlight 通道，但要与「闪烁」解耦

`startLanding` 的锚点由 `CommentCard` 在「本行是当前目标」时通过 `landingViewRef` 注册。所以跳转一定得让目标行知道自己是目标；但复用 `highlightedCommentId` 会带两个不需要的副作用：

1. 闪一次高亮环；
2. `comment-card.tsx` 的 effect 把**已解决线程自动展开**——而验收要求「跳到折叠 bar 的位置」，即保持折叠。

因此在 `TimelineList` 里把「落点目标」和「闪烁目标」拆成两路，共用同一个落点驱动：

- 收件箱深链：`highlightCommentId`/`highlightNonce`（props，既有路径不变）→ 落点 **且** 闪烁、已解决线程可自动展开。
- 线程跳转：新增 state `navJump = { rootId, nonce }` → 只落点。

`CommentCard` 新增可选 prop `anchorCommentId`，优先级高于 `highlightId`，只用于 `landingViewRef` 注册：

```tsx
const anchorId = anchorCommentId ?? highlightId;
<View ref={anchorId === entry.id ? landingViewRef : undefined}>   // 折叠 bar / 展开卡 / 回复各一处
```

## 当前线程 = 视口顶落在哪个线程

用 FlashList 已有的 `onViewableItemsChanged`（`timeline-list.tsx` 里已有一份，用于 unread 分隔行的「划过去了」判定），取**最小可见行下标**，再 `threadIndexAtRow`：

- 最小可见行是 activity 行或分隔行 → 归到它上方最近的那个线程（用户看到的是那个线程的尾部）；
- 顶部在第一线程之前（正在读标题/描述）→ `-1`，于是「上一线程」不可用、「下一线程」= 第一个线程。

写入分两处，各取所需：

- store 的 `currentThreadId`：给 sheet 标当前行（sheet 打开时列表不动，值就是打开时的位置）；
- 组件内的 ref：给 FAB 算上/下一目标。

**故意不进 React state**：`onViewableItemsChanged` 在滚动中频繁触发，若 setState 会重建 `renderItem`、带动可见 cell 重渲染。FAB 自己订阅 store，滚动只重渲染 FAB 这个小兄弟组件。

## 上一/下一线程

`current = nav.findIndex(rootId === currentThreadId)`（未命中 = -1）：

- 下一：`current + 1`（`-1 → 0`，即「先跳到第一个线程」）；
- 上一：`current - 1`，`current <= 0` 时不可用；
- 到最后一个线程时「下一」不可用。

边界用 FAB 自己的组件态渲染（禁用=降透明度），不额外查行布局。

## sheet：路由 + 虚拟化列表

- 路由 `app/(app)/[workspace]/issue/[id]/threads.tsx`，在 `_layout.tsx` 注册 `SHEET_OPTIONS`（照 `issue/[id]/runs.tsx`）。
- body 自己取数：`issueTimelineOptions(wsId, id)`（与详情页同一个 react-query 缓存，不额外请求）→ `coalesceTimeline` → `buildTimelineRows` → `buildThreadNav`，**与时间线同一条管线**，保证清单顺序 = 页面顺序。
- 行 = 头像（`ActorAvatar`）+ 首行摘要（`numberOfLines={1}`）+ `N replies` + 已解决勾选；当前线程行加高亮底色。
- 点行 → `requestJump(rootId)` → `router.back()`：清单先行关闭，时间线（一直在后面挂着）收到 request 后落点；落点在 sheet 关闭动画期间就完成，结束时位置已对。
- 用 `FlashList` 渲染（大 issue 几百个线程不全量挂载）。

## 入口（FAB）形态

右下角竖排两个控件（避开居中显示的「↓ N new」chip）：

- 上：`︿ ﹀` 两半的胶囊（上一/下一线程）；
- 下：圆形按钮（打开清单）。

线程数 < `MIN_THREADS` 时整块不渲染（对齐 web）。面板/胶囊用既有 chip 的阴影做法，不给窄屏（320px）造成与 chip 的重叠。

## 被否掉的方案

- **轨迹条 rail（issue 第 3 项，可选）**：不做。web 自己就在移动端隐藏它（`issue-detail.tsx` 注释：no hover，gutter 太窄）；移动端行内容横向 gutter 只有 `px-4` = 16px，装不下 24px 命中区，硬塞会抢气泡右缘（反应、链接）的点击。清单 sheet 已提供「找」与位置感，上/下一线程提供「移动」。若后续确认要，加在既有索引之上即可（无需改分组）。
- **底部 Modal 面板代替 formSheet**：`apps/mobile/AGENTS.md` 的容器表按内容类型指定了 Long list → formSheet 路由，且同屏已有 `runs.tsx` 先例。
- **sheet 自己算线程、跳转不回落点算法**：会与时间线渲染顺序漂移（web 的清单刻意与渲染数组同源）。
- **把 `navJump` 也塞进 props 走路由参数**：跳转发生在 sheet 内，路由参数回不到已挂载的时间线；跨路由回传用 `chat-session-picker-store` 同款 store。
- **用 `highlightedCommentId` 直接承担线程跳转**：会展开已解决的线程，违背「跳到折叠 bar」。

## 兼容性 / 回滚

- 只动 `components/issue/**`、`app/(app)/[workspace]/issue/[id]/threads.tsx`（新）、`_layout.tsx`（追加一行路由注册）+ 新增 `lib/thread-nav.ts`、`data/stores/thread-nav-store.ts`。
- 收件箱深链行为不变（那条路径的 prop 与 effect 语义保持原样）。
- 回滚 = 还原改动文件 + 删除新文件（无数据/协议/迁移）。
