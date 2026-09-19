# issue 详情：评论线程快速跳转（对齐 web ThreadMinimap）

## Goal

issue 详情的评论线程一多就不好找。给 `apps/mobile` 的 issue 详情加**线程级导航**：一个悬浮入口 → 列出全部线程（含被折叠的已解决线程）→ 点一行跳到该线程起始位置；同一入口提供「上一线程 / 下一线程」。

来源：FEATURE-572（阶段 7）。纯客户端改动，不涉及后端/接口。

## 已核实事实（读代码）

- web 唯一定义在 `packages/views/issues/components/thread-minimap.tsx`（rail + 完整线程清单，`MIN_THREADS = 2`）+ `thread-utils.ts`（分组/排序权威实现：`collectThreadReplies` 按时间序、`deriveThreadResolution`、`collectThreadParticipants`）。web 的 rail 在移动端**被主动隐藏**（`issue-detail.tsx`：`{!isMobile && <ThreadMinimap …/>}`，注释写明「no hover, and the gutter is too tight」）。
- 移动端的时间线是**一个根评论一行**，整条回复链内嵌在同一个气泡里（`lib/timeline-thread.ts` 的 `buildTimelineRows`）。线程 = 一行根评论（`type === "comment"` 的行）；activity 行不是线程。
- 落点机制已由 FEATURE-571 建好并合并（`c0b8ccf40`）：`lib/comment-landing.ts` 的 `resolveCommentLanding(rows, commentId)` + `startLanding({list, targetIndex, probeDown, anchorNode, viewport})`，`timeline-list.tsx` 里的 effect 驱动。**本任务只复用，不改落点算法。**
- 锚点必须由 `CommentCard` 通过 `landingViewRef` 注册，而它只在「该行是当前 highlight 目标」时注册（`comment-card.tsx` 的 `ref={highlightId === entry.id ? landingViewRef : undefined}`）。因此**任何跳转都必须走 highlight 通道**，否则 `startLanding` 拿不到锚点、在帧预算内空转到放弃。
- 同一通道有副作用：`setHighlightedId` 会闪一次高亮环，且 `comment-card.tsx` 的 effect 会把「已解决线程」**自动展开**。web 的清单跳转是跳到折叠 bar 本身、不展开 → 需要把「落点锚点」与「闪烁/展开目标」拆开。
- 服务端 `ListTimeline`（`server/internal/handler/activity.go:149`）**不做折叠**（`foldResolvedThreads` 只用于 `ListComments`），并把 `resolved_at` 原样下发；注释写明「Timeline clients derive resolution bars, author lists, and folded counts」。线程「已解决」= 根评论 `resolved_at` **或任一回复** `resolved_at`（web `deriveThreadResolution`；服务端 `comment.go:180` 确认回复可被 resolve）。
- 已知既有缺口（本轮不改、只在结论里说明）：移动端 `comment-card.tsx` 只按根的 `resolved_at` 折叠，回复级 resolution 在移动端目前不折叠。
- 容器选型按 `apps/mobile/AGENTS.md` 的「Sheets and navigation」表：长列表 → expo-router `presentation: "formSheet"` 路由；同屏同类先例是 `app/(app)/[workspace]/issue/[id]/runs.tsx`（Agent Runs sheet）。
- 跨路由回传的既有模式：`data/stores/chat-session-picker-store.ts`（formSheet 写一次性 request，宿主 screen 读后 `consume()`）。
- `apps/mobile/vitest.config.ts` 是 Node 环境、只收 `lib/**` 与 `data/**` 的 `.test.ts`，不加载 RN 渲染器 → 纯函数导航索引必须放 `lib/`。

## Requirements

1. issue 详情出现线程导航入口，**线程数 ≥ 2 才出现**（对齐 web `MIN_THREADS`）。
2. 入口可打开线程清单 sheet：列出**全部线程**（含已解决），每行给作者头像 + 首行摘要 + 回复数 + 是否已解决，并标出**当前所在线程**。
3. 点清单某行 → 跳到该线程起始位置（根评论行的顶边），**已解决线程也一样**（落到折叠 bar 的位置，不展开它）。
4. 入口提供「上一线程 / 下一线程」，相对当前视口位置移动；到边界时按钮不可用。
5. 分组口径与 web 一致：按 `parent_id` 归并、时间序、嵌套回复计入所属线程；**不另造一套分组规则**。
6. 线程清单要能承受大 issue（虚拟化渲染）。
7. 不改落点算法、不改收件箱与实时层。

## Acceptance Criteria

- [ ] 线程索引单测覆盖：activity 行/分隔行不计入、嵌套回复计入根线程、已删除回复不计入回复数、根与回复两种已解决判定、行下标 → 当前线程映射（含列表顶部在第一线程之前的情况）。
- [ ] `pnpm --filter @multica/mobile typecheck` / `lint` / `test` 通过。
- [ ] 打新 APK 走 GitHub Release 交付，结论给文件名、大小、SHA-256 与真机自测步骤（线程 ≥2 出现入口、点某线程落到该线程起始、已解决线程也能跳、上/下一线程）。
- [ ] 结论写清本地验证与真机验收的边界（本地不启模拟器）。

## Boundaries

- 独占 `apps/mobile/components/issue/**`、`apps/mobile/app/(app)/[workspace]/issue/[id].tsx`，以及本任务新建的线程导航组件/store/纯函数。
- 需要新增一个 formSheet 路由（`issue/[id]/threads.tsx`）并在 `app/(app)/[workspace]/_layout.tsx` 注册一行 `SHEET_OPTIONS`（AGENTS.md 强制）；该文件只做追加，不动既有行。
- 不改 `(tabs)/inbox.tsx`、`lib/inbox-display.ts`、`packages/core`、实时层与落点算法。
- **本任务不做**「未解决线程手动折叠」（用户 2026-09-19 决定暂不排期）。
- 不自行启动模拟器；真机验收由用户执行。

## Notes

- 轨迹条（issue 第 3 项，可选）：本任务**不做**，理由见 design.md「被否掉的方案」——web 自己就在移动端隐藏该 rail（gutter 只有 16px，装不下 24px 命中区），清单 sheet + 上/下一线程已覆盖「找」与「移动」。
- 平台约束（无 hover、命中区 ≥24px、formSheet 在 Android 的语义）写回 `.trellis/spec/mobile/frontend/android-platform.md`。
