# 实施计划

## 步骤

1. **落点判定 + driver 模块**：新增 `apps/mobile/lib/comment-landing.ts`
   - `resolveCommentLanding(rows, commentId)`：行下标 + 锚点 id；删除回复走 `commentLandingTarget` 回退；无 id / 不在时间线里返回 `null`。
   - `startLanding(...)`：`scrollToIndex` 粗定位 → 视口坐标测量-修正 → 深层锚点向下探测 → 帧预算与 cancel。
   - 结构化接口 `LandingList` / `Measurable`，不 import `react-native`。
2. **单测**：`apps/mobile/lib/comment-landing.test.ts`——落点判定 5 例 + driver 4 例（收敛 / 探测 / 取消 / 不空转），用假 list + 假 rAF。
3. **接进时间线**：`components/issue/timeline-list.tsx`
   - 删除 `flashListKey` 重挂与 `startRenderingFromBottom`（不再依赖 initial scroll）。
   - 新落点 effect（放在 `dataWithDivider` 之后）：按 `(commentId, nonce)` 打戳，只落一次；WS 追加不重放。
   - `viewportRef` / `anchorRef` + `cancelLandingRef`（拖动时取消）。
   - 文件头注释与 `HIGHLIGHT_HOLD_MS` 注释按新行为改写。
4. **接进评论卡**：`components/issue/comment-card.tsx`——新增 `landingViewRef`，挂到「根评论气泡 / 该条回复的包装 View / 折叠的已解决线程条」三处，由 `highlightId` 决定挂哪一个。
5. **验证**：`pnpm -C apps/mobile typecheck` / `lint` / `test`。
6. **交付**：commit → push → 打 APK → GitHub Release → squash 合并 main → 归档 trellis 任务。

## 验证命令与判据

```bash
rtk test -- corepack pnpm exec vitest run lib/comment-landing.test.ts   # 9 passed
rtk err -- corepack pnpm -C apps/mobile typecheck                       # no errors
rtk err -- corepack pnpm -C apps/mobile lint                            # 0 errors
rtk test -- corepack pnpm -C apps/mobile test                           # vitest + 脚本用例
```

driver 用例的判据是**行为**而非实现：锚点窗口 y 等于视口顶 + `LANDING_TOP_INSET_PX`；`anchorOffsetInRow = 3000`（约 3.75 屏）时仍收敛；cancel 后 offset 与写入次数都不再变化；锚点恒为 null 时帧队列排空。

## 人工/设备验证（不在本任务执行）

本地不启模拟器（用户硬要求）。真机步骤写进交付结论：

1. 装新 APK（arm64-v8a、production、指向 `https://fengit-multica.frp.tbxzs.net`）。
2. 收件箱点一条**评论**通知 → 该评论顶边落在视口顶部附近并高亮。
3. 点一条**回复**通知 → 落在该回复（而不是线程根评论）起始处并高亮。
4. 点一条 issue 级通知（无 comment id）→ 仍停在顶部，先看到标题/描述。

## 风险与回滚

- 风险：`measureInWindow` 与 rAF 在 device 上的时延导致落点略慢——已在帧预算内收敛，且稳定 3 帧即停。
- 风险：极长线程里回复位于行底部超过 7 屏——探测有上限，超出则停在行顶（仍优于「落到底部」）。
- 回滚点：单一 commit；`git revert` 即可，无数据/协议影响。
