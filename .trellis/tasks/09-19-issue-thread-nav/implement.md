# 实施步骤

## 步骤

1. `apps/mobile/lib/thread-nav.ts`：`MIN_THREADS` / `ThreadNavItem` / `buildThreadNav` / `threadIndexAtRow` / `threadPreview`。
2. `apps/mobile/lib/thread-nav.test.ts`：线程索引与映射的单测。
3. `apps/mobile/data/stores/thread-nav-store.ts`：`jumpRequest` + `currentThreadId` + `requestJump` / `consumeJump` / `setCurrentThreadId`。
4. `apps/mobile/components/issue/comment-card.tsx`：新增可选 `anchorCommentId`，三处 `landingViewRef` 注册改用它（`anchorId = anchorCommentId ?? highlightId`）。
5. `apps/mobile/components/issue/timeline-list.tsx`：
   - `buildThreadNav(dataWithDivider)` 派生线程索引；
   - viewability 回调里额外把「视口顶所在线程」写进 store（不进 state）；
   - 落点 effect 统一处理深链与 `navJump`（navJump 只落点、不闪烁），并把 `anchorCommentId` 传给对应行；
   - 渲染 FAB（`threads.length >= MIN_THREADS` 时）。
6. `apps/mobile/components/issue/thread-nav-fab.tsx`：上/下一线程 + 打开清单入口。
7. `apps/mobile/components/issue/thread-nav-sheet.tsx`：清单行 + 虚拟化列表 + 当前线程标记。
8. `apps/mobile/app/(app)/[workspace]/issue/[id]/threads.tsx`：formSheet 路由 body（取数 + 渲染 sheet）。
9. `apps/mobile/app/(app)/[workspace]/_layout.tsx`：注册 `<Stack.Screen name="issue/[id]/threads" options={SHEET_OPTIONS} />`。
10. 写回 spec：`.trellis/spec/mobile/frontend/android-platform.md` 补本任务得到的平台约束（无 hover / 命中区 / formSheet 回传）。

## 验证

- 中途只跑改动直接相关的单测：`rtk test -- corepack pnpm exec vitest run --config apps/mobile/vitest.config.ts apps/mobile/lib/thread-nav.test.ts`。
  （vitest include 只收 `lib/**`、`data/**` 的 `.test.ts`，跑全量 test 会连 iOS/Android 脚本用例一起跑，放到收尾一次跑完。）
- 收尾一次跑完整检查：`pnpm --filter @multica/mobile typecheck` / `lint` / `test`（按 code-helper 的 rtk 形态）。
- 不启模拟器；真机验收由用户执行（交付里给步骤与 APK）。

## 回滚

还原 `timeline-list.tsx` / `comment-card.tsx` / `_layout.tsx`，删除新增的 5 个文件即可。
