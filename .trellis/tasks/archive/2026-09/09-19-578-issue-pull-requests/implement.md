# 实施步骤

## 步骤

1. `apps/mobile/lib/pull-requests.ts`（新）：状态文案 / 色调键 / 副行拼装 / 折叠切分等纯函数。
2. `apps/mobile/lib/pull-requests.test.ts`（新）：状态映射（含未知回退）、折叠边界（3 / 4 / 5 条、
   展开后）、副行拼装（作者为 null）的映射单测。
3. `packages/core/package.json`（只追加一行）：`"./github/settings": "./github/settings.ts"`。
4. `apps/mobile/data/api.ts`（追加）：`listIssuePullRequests` + 两个 core schema 导入。
5. `apps/mobile/data/queries/issue-keys.ts`（追加）：`pullRequests` key。
6. `apps/mobile/data/queries/issues.ts`（追加）：`issuePullRequestsOptions`。
7. `apps/mobile/components/issue/pull-request-list.tsx`（新）：区块（门禁 / 空态 / 折叠头 / 行 / 折叠区）。
8. `apps/mobile/components/issue/timeline-list.tsx`：`ListHeader` 插一行 `<PullRequestList />`。
9. `apps/mobile/app/(app)/[workspace]/issue/[id].tsx`：下拉刷新带上 PR 查询。
10. `apps/mobile/app.config.ts`：`android.versionCode` 9 → 10。
11. 写回 spec：`.trellis/spec/mobile/frontend/android-platform.md` 补本轮得到的平台约束
    （Ionicons 无 draft/closed PR 图标 → 图标+色调表达）。

## 验证

- 中途只跑改动直接相关的单测（RED → GREEN 证据）：
  `rtk test -- corepack pnpm exec vitest run --config apps/mobile/vitest.config.ts apps/mobile/lib/pull-requests.test.ts`
- 收尾一次跑完整检查（code-helper 的 rtk 形态）：
  `rtk err -- corepack pnpm --filter @multica/mobile typecheck`、
  `rtk err -- corepack pnpm --filter @multica/mobile lint`、
  `rtk test -- corepack pnpm --filter @multica/mobile test`
  （mobile 无 `pnpm check` 脚本；AGENTS.md 表里 mobile 单独列出，根前端命令不覆盖它）。
- 不启模拟器；真机验收由用户执行，交付里分开写明。
- APK：`expo prebuild -p android --no-install` → `./gradlew assembleRelease
  -PreactNativeArchitectures=arm64-v8a`（`APP_ENV=production` +
  `EXPO_PUBLIC_API_URL=https://fengit-multica.frp.tbxzs.net`），产物按既有命名发 GitHub Release
  `android-v0.1.1-vc10-pull-requests`。

## 回滚

还原 `timeline-list.tsx` / `issue/[id].tsx` / `data/api.ts` / `data/queries/*` /
`packages/core/package.json` / `app.config.ts`，删除新增的 `lib/pull-requests.ts`、
`lib/pull-requests.test.ts`、`components/issue/pull-request-list.tsx` 三个文件即可。
