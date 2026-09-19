# 设计：deep-link 落点

## 边界与契约

新增 `apps/mobile/lib/comment-landing.ts`，把「落到哪里」和「怎么落过去」都收在一个模块里，只依赖类型（不 import `react-native`、不 import FlashList 运行时），因此能被 `vitest.config.ts` 的 Node lane 覆盖。

```ts
resolveCommentLanding(rows, commentId) ->
  { rowIndex: number; anchorId: string } | null

startLanding({ list, targetIndex, probeDown, anchorNode, viewport }) -> cancel()
```

- `rows` 是渲染用的行数组（含 `DIVIDER_ID` 分隔行），与 `FlatList` 的 `data` 同源 → `rowIndex` 可直接当 `targetIndex` 用。
- `anchorId`：根评论目标时等于该行的 entry id；回复目标时是该回复 id（经 `commentLandingTarget` 处理过删除回退）。
- 列表与视图通过**结构化接口**（`LandingList` / `Measurable`）注入，`FlashListRef` 与 RN `View` 天然满足，测试给假实现即可。

## 为什么是两段式，而不是单次 `scrollToIndex`

1. `scrollToIndex(index, viewPosition: 0)` 只认**行**：它能精确把一个行顶放到视口顶（FlashList 按自己的 layout model 定位，坐标系自洽），但不知道回复在这行气泡内部的偏移。
2. 回复的偏移只能**量**出来：`anchorNode.measureInWindow()` 给出锚点在窗口坐标下的真实 y，与视口顶相减得到残差 delta，再 `scrollToOffset(当前 offset + delta)` 修正。
3. 同样的回路解决了异步高度：跳转后 Shiki/图片/markdown 仍在改变行高，测量-修正会一直收敛到稳定（连续 3 帧在 1px 容差内）。

## 坐标系（容易搞错的地方）

`scrollToOffset` 的 `offset` 参数默认会**再加一次** `firstItemOffset`（表头高），而 `scrollToIndex` 内部是 `layout.y + firstItemOffset` 再配 `skipFirstItemOffset: true` 提交的。为避开这层换算，driver 全程使用**原生偏移**：

- 读：`getAbsoluteLastScrollOffset()`（= `scrollOffset + firstItemOffset`，即原生 contentOffset）。
- 写：`scrollToOffset({ offset, skipFirstItemOffset: true })` → 原生 contentOffset 就是该值。

两者同一坐标系，delta 直接相加即可；且每次修正都基于新测量，基准偶有一帧陈旧只会多跑一帧，不会过冲。

## 搜索：回复埋在行下方怎么办

回复可能在根评论气泡下方一两屏（长 markdown 的 agent 评论很常见），此时锚点还没进入渲染窗口，`anchorNode()` 为 null。处理：

- 给 `LANDING_PROBE_GRACE_FRAMES`（8 帧）宽限，避免刚滚动完还没提交就误判；
- 之后每帧把视口下移 `0.7 × 视口高` 再找，上限 `LANDING_MAX_PROBES`（10 次 ≈ 7 屏）；
- 一旦锚点出现就进入测量-修正，把探过头的位置拉回来（delta 为负即反向）。
- `probeDown` 只对回复目标为 true：根评论目标时行本身就是锚点，`scrollToIndex` 之后必然在窗口内，往下探只会把正确落点推走。

## 终止与让位

- 帧预算 `LANDING_FRAME_BUDGET = 150`（约 2.5s），锚点始终不渲染（例如折叠的已解决线程）时也会在预算内停手，不会空转。
- 返回的 cancel 在用户 `onScrollBeginDrag` / `onMomentumScrollBegin` 以及组件卸载时调用：用户的拖动永远优先。
- 落点循环期间 MVCP（FlashList 默认开启）负责后续的上方行 resize 补偿，两者不冲突：MVCP 稳定可见内容，落点循环只做收敛。

## 被否掉的方案

- **像 web 那样 deep-link 时关闭虚拟化**（web 的 `isFlatTimeline`）：移动端一屏 30 个 markdown 气泡（Shiki + 图片）全量挂载会明显拖慢每次从收件箱进入的打开速度，代价落在最常见路径上。
- **只靠 `scrollToIndex`**：无法表达「回复在行内的偏移」，也追不上跳转后的异步高度变化。
- **`initialNumToRender = data.length`**：FlashList 仍会回收，不保证目标行常驻，落点仍不可测。

## 兼容性 / 回滚

- 只动 `components/issue/**` 与新增 `lib/comment-landing.ts`；深链参数、`inbox.tsx`、`packages/core` 均未改。
- 回滚 = 还原 `timeline-list.tsx` / `comment-card.tsx` 并删除新模块与用例。
- 无网络/协议改动，无数据迁移。
