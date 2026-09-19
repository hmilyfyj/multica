# 收件箱深链：定位到目标回复的开始位置

## Goal

从收件箱点一条评论/回复通知进入 issue 详情后，**列表精确落到该评论/回复的起始位置**（目标顶边停在视口顶部附近），而不是让用户自己上翻去找。

来源：FEATURE-571（用户反馈 2026-09-19：「通过收件箱点击进入任务详情之后，期望可以正常跳转到对应回复的开始位置」）。

## 已核实事实（读代码）

- 深链链路本身是通的：`(tabs)/inbox.tsx` 的 `onPressItem` → `getInboxNavigationTarget(item, wsSlug, nonce)`（`lib/inbox-display.ts`）生成带 `highlight`（目标 comment id）与 `h`（nonce）的路由参数 → `app/(app)/[workspace]/issue/[id].tsx` 读取后透传给 `TimelineList` 的 `highlightCommentId` / `highlightNonce`。**深链生成无需改动。**
- 缺陷在时间线侧：`components/issue/timeline-list.tsx` 在 deep-link 时给 FlashList 传 `maintainVisibleContentPosition.startRenderingFromBottom: true` 并用 `key={`hl-${nonce}`}` 重挂列表，于是**列表落在最后一条**（最新评论），目标行只有等用户自己翻到才会闪一下（`HIGHLIGHT_HOLD_MS = 5000` 是这个「等到用户翻过去」的窗口）。即：**从来没有实现过「跳到目标」，只有「落到底部 + 路过时高亮」**。
- 移动端的时间线是**一个根评论一行**，整条回复链内嵌在同一个气泡里（`lib/timeline-thread.ts` 的 `buildTimelineRows`）。因此「回复的位置」不是一个行下标能表达的——这正是 web 上可以用 `#comment-id` 而移动端需要额外信息的原因。
- 已删除的回复不渲染任何东西（`packages/core/issues/comment-deletion.ts` 的 `isDeletedComment`），`commentLandingTarget()` 会把这种 id 回退到它上方最近的可见评论；`comment-card.tsx` 已经用它决定闪哪一个气泡。落点判定必须复用同一条规则，否则「滚动落点」和「高亮气泡」会不一致。
- FlashList v2 的 ref 提供 `getLayout(index)` / `getAbsoluteLastScrollOffset()` / `getFirstItemOffset()` / `getWindowSize()` / `scrollToOffset({ skipFirstItemOffset })`（`node_modules/@shopify/flash-list/src/FlashListRef.ts`）。`scrollToOffset` 在 `skipFirstItemOffset: true` 时参数就是原生 contentOffset，与 `getAbsoluteLastScrollOffset()` 同一坐标系。
- `apps/mobile/vitest.config.ts` 是 Node 环境、只收 `lib/**` 与 `data/**` 的 `.ts` 用例，明确不加载 RN 渲染器与原生模块 → 落点逻辑若想被单测覆盖，就不能 import `react-native`。

## Requirements

1. deep-link 到达后，目标（根评论或回复）的**顶边**停在列表视口顶部附近（留一小段上一行的余量作为定位感）。
2. 回复目标要落到**回复自己**的起始位置，而不是它所在线程根评论的顶部。
3. 异步高度（Shiki 高亮、图片 natural-size、markdown 展开）在跳转后继续改变行高时，落点要跟着收敛，不能停在偏移位置。
4. 三种通知都要有确定行为：根评论、对根评论的回复、issue 级（无 comment id）——后者保持「落在顶部、先看标题描述」的既有行为。
5. 用户自己一拖动，落点循环立即让位，不与用户抢滚动。
6. 保持架构：不加全局 refetch、不改 `(tabs)/inbox.tsx`、不动 `packages/core`、不改深链参数格式。

## Acceptance Criteria

- [ ] `resolveCommentLanding` 单测覆盖：根评论 / 回复 / 无 comment id / 已删除回复回退 / 时间线里没有该 id。
- [ ] `startLanding` 单测覆盖：锚点停在 inset（视口顶 + 12px）；回复深埋在行下方时能被搜到并收敛；取消后不再滚动；锚点始终不渲染时在帧预算内停止（不空转）。
- [ ] `pnpm -C apps/mobile typecheck` / `lint` / `test` 通过。
- [ ] 打新 APK 走 GitHub Release 交付，结论里给文件名、大小、SHA-256、签名证书指纹与真机自测步骤。
- [ ] 结论写清本地验证与真机验收的边界（本地不启模拟器）。

## Boundaries

- **不改 `app/(app)/[workspace]/(tabs)/inbox.tsx`**：FEATURE-563 正在并行改该文件；本次深链生成侧无需改动。
- 不改 `lib/inbox-display.ts`（`getInboxNavigationTarget` 已正确，三种通知都生成了正确的 `highlight`/`h`）。
- 不改 `packages/core`（只复用已有的 `commentLandingTarget`）。
- 不自行启动模拟器（用户对模拟器次数有硬要求）；设备验证由用户按交付里的步骤执行一次。

## Notes

- 落点规则与平台约束（回复内嵌于根评论行、FlashList 坐标系）写回 `.trellis/spec/mobile/frontend/android-platform.md`。
