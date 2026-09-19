# 实施步骤

## 步骤

1. `apps/mobile/lib/sub-issues.ts`：`groupSubIssuesByStage` / `childProgressOf` /
   `subIssueProgressLabel`（纯函数，对齐 web `issue-detail.tsx:421` 与 `issueBehavesAs` 口径）。
2. `apps/mobile/lib/sub-issues.test.ts`：分组映射 + 计数映射 + 行进度映射的单测。
3. `apps/mobile/data/api.ts`（追加）：`listChildIssues` / `getChildIssueProgress` + core schema 导入。
4. `apps/mobile/data/queries/issue-keys.ts`（追加）：`children` / `childProgress`。
5. `apps/mobile/data/queries/issues.ts`（追加）：`issueChildrenOptions` / `childIssueProgressOptions`。
6. `apps/mobile/data/stores/sub-issues-collapse-store.ts`：会话内折叠 store（只记已折叠 id）。
7. `apps/mobile/components/issue/issue-row.tsx`：加可选 `trailing?: ReactNode`。
8. `apps/mobile/components/issue/parent-issue-row.tsx`：父 issue 行（状态图标 + 标识 + 标题 + 跳转）。
9. `apps/mobile/components/issue/sub-issues-section.tsx`：区块（空态入口 / header / 分组列表 / 折叠）。
   子 issue 行不单独建文件：`IssueRow(showStatus, trailing=子进度)` 已覆盖，行组件作为本文件内的
   局部 `SubIssueRow`。
10. `apps/mobile/components/issue/timeline-list.tsx`：`ListHeader` 插入父 issue 行与子 issue 区块。
11. `apps/mobile/app/(app)/[workspace]/new-issue.tsx`：可选 `parent` 参数 → `parent_issue_id` + 缓存失效。
12. `apps/mobile/app/(app)/[workspace]/issue/[id].tsx`：下拉刷新带上子 issue 查询。
13. `apps/mobile/app.config.ts`：`android.versionCode` 8 → 9（侧载覆盖安装用）。
14. 写回 spec：`.trellis/spec/mobile/frontend/android-platform.md` 补本轮得到的平台约束。

## 验证

- 中途只跑改动直接相关的单测（RED → GREEN 证据）：
  `rtk test -- corepack pnpm exec vitest run --config apps/mobile/vitest.config.ts apps/mobile/lib/sub-issues.test.ts`
- 收尾一次跑完整检查（code-helper 的 rtk 形态）：
  `rtk err -- corepack pnpm --filter @multica/mobile typecheck`、
  `rtk err -- corepack pnpm --filter @multica/mobile lint`、
  `rtk test -- corepack pnpm --filter @multica/mobile test`。
- 不启模拟器；真机验收由用户执行。
- APK：`expo prebuild -p android --no-install` → `./gradlew assembleRelease
  -PreactNativeArchitectures=arm64-v8a`（`EXPO_PUBLIC_API_URL` / `APP_ENV=production`），
  产物按既有命名发到 GitHub Release。

## 回滚

还原 `timeline-list.tsx` / `issue-row.tsx` / `new-issue.tsx` / `issue/[id].tsx` /
`data/api.ts` / `data/queries/*` / `app.config.ts`，删除新增的 5 个文件即可。
