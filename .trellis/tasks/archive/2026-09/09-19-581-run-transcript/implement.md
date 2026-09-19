# 实施步骤

## 步骤（按依赖顺序）

1. `apps/mobile/lib/run-transcript.ts`（新）：五型条目映射 + 开窗 + 摘要 + 脱敏。
2. `apps/mobile/lib/run-transcript.test.ts`（新）：映射单测（见「验证」）。
3. `apps/mobile/data/queries/chat.ts`（追加）：`unionTaskMessagesBySeq` + `taskMessagesOptions`
   的 `structuralSharing`。
4. `apps/mobile/components/issue/use-run-transcript.ts`（新）：query + WS 订阅。
5. `apps/mobile/components/issue/run-transcript.tsx`（新）：时间线渲染（开窗 / 折叠 / 五型）。
6. `apps/mobile/components/issue/run-row.tsx`（改）：整行可点 + 导出 `RunStatusBadge` /
   `RunCancelButton` + Active 行的步骤折叠。
7. `apps/mobile/components/issue/run-steps-fold.tsx`（新）：行内折叠（惰性挂载）。
8. `apps/mobile/app/(app)/[workspace]/issue/[id]/runs/[taskId].tsx`（新）：详情页。
9. `apps/mobile/app/(app)/[workspace]/issue/[id]/runs.tsx`（改）：删掉「Past-row tap is a
   no-op」的过时注释，`RunRow` 传 `wsSlug`。
10. `apps/mobile/app/(app)/[workspace]/_layout.tsx`（改）：注册
    `issue/[id]/runs/[taskId]`（`RUN_DETAIL_OPTIONS`）。
11. `apps/mobile/app.config.ts`：`android.versionCode` +1（每次交付新 APK 都要涨）。
12. 写回 spec：`.trellis/spec/mobile/frontend/android-platform.md` 补本轮平台约束
    （formSheet 从 formSheet 里 push 的实测状态 = 未测；本轮按容器表选 formSheet 单挡）。

## 验证

- 中途只跑改动直接相关的单测（RED → GREEN）：
  `rtk test -- corepack pnpm exec vitest run --config apps/mobile/vitest.config.ts apps/mobile/lib/run-transcript.test.ts`
- 收尾一次跑完整检查（code-helper 的 rtk 形态；mobile 无 `pnpm check`，见 `apps/mobile/AGENTS.md`）：
  `rtk err -- corepack pnpm --filter @multica/mobile typecheck`
  `rtk err -- corepack pnpm --filter @multica/mobile lint`
  `rtk test -- corepack pnpm --filter @multica/mobile test`
- **不启模拟器**：真机验收由用户执行（Runs 列表点历史 run → 步骤与消息 →「显示前面的 N 个
  步骤」→ 运行中实时追加），交付里与本地验证分开写。
- APK：`expo prebuild -p android --no-install` → `./gradlew assembleRelease
  -PreactNativeArchitectures=arm64-v8a`（`APP_ENV=production`，流程见
  `apps/mobile/docs/android-distribution.md`），产物走 GitHub Release。
