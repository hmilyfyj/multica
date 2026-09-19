# issue 详情：关联 PR 列表（只读）

## Goal

`apps/mobile` 的 issue 详情页补上**关联 PR 列表**，对齐 web 的
`packages/views/issues/components/pull-request-list.tsx`：列出该 issue 关联的 PR（标题 / 状态 /
来源分支 / 作者），点条目用系统浏览器打开 PR 链接。纯客户端改动，不动后端、不动实时层。

来源：FEATURE-578（stage 10，第 2 波牵头任务）。

## 已核实事实（读代码）

**web 参照实现**

- 组件：`packages/views/issues/components/pull-request-list.tsx`
  - 行（`PullRequestRow`，:95-133）：`pr.title` 为主行；副行是
    `{repo_owner}/{repo_name}#{number} · {stateLabel} · @{author_login}`；整行是一个外链
    `<a href={pr.html_url} target="_blank">`；draft 行加 `opacity-80`。
  - 状态图标与色（`STATE_ICON`，:35-41）：open → `GitPullRequestArrow` / emerald，
    draft → `GitPullRequestDraft` / muted，merged → `GitMerge` / violet，
    closed → `GitPullRequestClosed` / rose。
  - 状态文案（`getStateLabel`，:317-327）：open/draft/merged/closed → `Open`/`Draft`/`Merged`/`Closed`，
    **未知状态回退成原始字符串**。
  - 折叠规则（:46-92）：`PR_LIMIT_BEFORE_COLLAPSE = 4`；数量 ≥ 4 时只显示前 3 行，其余收在
    `Show N more` / `Show less` 后面；< 4 时全部显示。
  - 空态（:52-58）：渲染 `No linked pull requests.`。
- 挂载位置：`packages/views/issues/components/issue-detail.tsx:2552`，在**详情侧栏**里，
  外部门禁是 `githubSettings.prSidebar`；区块折叠开关 `pullRequestsOpen` 默认 `true`（:1204），
  且是**组件内 useState**（不是 store）。
- 该列表**不读 issue 详情自带字段**，而是独立的 PR 接口（见下）。

**数据口径**

- web query：`packages/core/github/queries.ts:36` `issuePullRequestsOptions(issueId)`。
- 实际请求：`packages/core/api/client.ts:4574` `listIssuePullRequests(issueId)` →
  `GET /api/issues/:id/pull-requests` → 用 `IssuePullRequestsResponseSchema`
  （`packages/core/api/schemas.ts:431`）+ `EMPTY_ISSUE_PULL_REQUESTS_RESPONSE` 兜底。
- 响应形状 `{ pull_requests: GitHubPullRequest[] }`；`GitHubPullRequest`
  （`packages/core/types/github.ts:60`）本任务用到的字段：
  `id`、`title`、`state`（`:1` 的 `"open" | "closed" | "merged" | "draft"`）、`html_url`、
  `branch`（来源分支，`string | null`）、`author_login`（`string | null`）、
  `repo_owner` / `repo_name` / `number`。
- 侧栏可见性开关：`packages/core/github/settings.ts:22` `deriveGitHubSettings(workspace).prSidebar`
  （`github_enabled !== false && github_pr_sidebar_enabled !== false`，缺省为 true）。

**mobile 现状**

- 无任何 PR 相关代码：`rg "pull-request|pullRequest" apps/mobile` 无业务命中。
- issue 详情的区块都挂在 `components/issue/timeline-list.tsx` 的 `ListHeaderComponent`：
  `IssueHeaderCard` → 父 issue 行 → `IssueDescription` → `IssueReactionRow` → `SubIssuesSection`（:466）
  → `Activity` 标题。mobile 没有 web 那样的右侧栏。
- `data/api.ts` 是 mobile 自有的 fetch 包装（:1016 `listChildIssues` 可作模板），
  `fetchValidated(endpoint, schema, fallback, {signal, endpoint})` 是既有 GET 惯例。
- `data/queries/issue-keys.ts` 集中管理 issue 域 key；`data/queries/issues.ts` 只放 options。
- 打开外链的既有权：`Linking.openURL`（`components/project/project-resources-section.tsx:42`、
  `lib/markdown/markdown.tsx:169`），native 侧无内置浏览器。
- 导入白名单（`apps/mobile/AGENTS.md:7`）：`import type` 取 core 类型；运行时只允许**纯工具**与
  **平台无关 schema**。`@multica/core/github` 是 barrel，`github/index.ts` 会连带
  `queries.ts`（react-query + core api）与 `use-github-settings.ts`，不能整体导入。
- 图标只有 `@expo/vector-icons` 的 Ionicons；glyph 清单里 PR 语义只有 `git-pull-request`(-outline)、
  `git-merge`(-outline)、`git-branch`、`git-compare`、`git-network`，**没有** web 用的
  「draft / closed 变体 PR 图标」。
- 单测只跑 Node 环境，收 `lib/**`、`data/**` 的 `.test.ts`（`apps/mobile/vitest.config.ts`），
  不加载 RN 渲染器 → 可测的映射逻辑必须落在 `lib/`。

## Requirements

1. issue 详情出现**关联 PR 列表**区块：每条 PR 显示标题、状态（图标 + 颜色 + 文案）、
   来源分支、作者、`owner/repo#number`。
2. 点条目用**系统浏览器**打开 `html_url`（不做内置浏览器）。
3. 状态语义对齐 web：open / merged / closed（含 draft）的图标族与颜色分组一致，
   文案用同一套词，未知状态回退成原始字符串。
4. 数量 ≥ 4 时按 web 规则折叠：前 3 条可见，其余收在 `Show N more` / `Show less` 后面。
5. 作品集/租户门禁与 web 一致：`prSidebar` 为 false 的 workspace 不显示该区块。
6. 区块自身可折叠（默认展开），与 web 的区块折叠开关一致。
7. 空态不显示区块（web 显示空文案；见「有意为之的差异」）。

## Acceptance Criteria

- [x] `pnpm --filter @multica/mobile typecheck` 通过。核验：`rtk err -- corepack pnpm --filter
      @multica/mobile typecheck` → ok（合并 `origin/main` 后复验同样 ok）。
- [x] `pnpm --filter @multica/mobile lint` 通过（0 error）。核验：`rtk err -- corepack pnpm --filter
      @multica/mobile lint` → 0 errors；改动文件单独 `eslint` 亦无输出。
- [x] `pnpm --filter @multica/mobile test` 通过，且新增单测覆盖字段映射：
      - [x] 状态映射：open/draft/merged/closed → 文案与色调键；未知状态回退原始字符串。
      - [x] 折叠映射：3 条不折叠、4 条折叠出 3 行 + `Show 1 more`、5 条 → `Show 2 more`、
        展开后全部可见。
      - [x] 副行拼装：`owner/repo#number`、作者为 null 时不出现 `@`。
      核验：`apps/mobile/lib/pull-requests.test.ts` 13 例通过；合并后在 worktree 内全量 vitest
      = 62 文件 / 543 例全过，`apps/mobile` 的 4 个 shell 脚本用例
      （ios-run / android-run / android-keystore / android-release）亦全过。
      变异验证：把 `pullRequestTone` 的未知回退改成 `"open"`、把折叠可见数改成 `slice(0, 阈值)`
      后 → 3 例失败（RED，`3 failed | 10 passed`），改回后全绿。
- [x] 打完新 APK 走 GitHub Release 交用户真机自测；交付里**分开写明**本地验证与真机验收。
      核验：Release `android-v0.1.1-vc12-pull-requests`，资产
      `haier-mall-android-0.1.1-vc12-arm64-v8a-pull-requests.apk`，48,761,563 字节（与本地
      `assembleRelease` 产物字节数一致），sha256 `3f7c6183…2072710d`，签名证书
      `267600f2…b25ccf`（与 vc9 / vc10 同证书，可覆盖安装）；`aapt2 dump badging` 确认
      `com.ehaier.zgq.shop.mall` / versionCode 12；包内只有 `lib/arm64-v8a/`；
      bundle 内 `fengit-multica.frp.tbxzs.net` 出现 1 次、`api.multica.ai` 0 次、
      `Pull requests` 与 `Show … more` 各 1 次（本区块确实进包）。
      构建起点 `103a68e39`，与合并后的 `origin/main`(`3ce65c683`) **树完全相同**
      （`git diff --stat` 空输出），所以该 APK 就是 main 上的代码。
- [x] squash 合并进 `main`，合并后本 issue 置 `done`。
      核验：PR #68 squash 合并；合并前 main 已前进（577 / 579 已合入），
      冲突仅 `app.config.ts`（versionCode）与 spec 文档两处，已解：
      versionCode 顺延为 **12**（vc10 已被 577 的 Release 占用），spec 两节并存；
      解后重跑 typecheck / lint / test 全过并**重新打 APK**（vc12）。
- [x] 合并后启动第 3 波两个任务（FEATURE-580 / FEATURE-582），先确认没有在跑的 run。
      核验：`multica issue runs FEATURE-580/582 --active` 均为空后指派。

## Boundaries

- 独占：`apps/mobile/components/issue/**`（本任务只新增 PR 区块文件）、
  `apps/mobile/lib/pull-requests.ts` + `.test.ts`、`apps/mobile/data/queries/issues.ts`（只追加）、
  `apps/mobile/data/api.ts`（只追加）。
- 只追加一行导出：`packages/core/package.json` 的 `"./github/settings"` 子路径
  （理由见 design.md「被否掉的方案」1；仓库既有先例 `"./billing/recovery"` 就是为 mobile 加的）。
- 不改收件箱与聊天相关文件；不改实时层；不改 web/desktop 行为。
- **本任务不做**：PR 行的 CI / merge 状态徽章（`deriveChecksStatus` / `deriveMergeStatus`）、
  变更行数统计（additions/deletions/changed_files）、`snapshot_stale` 灰显提示、
  按 updated_at 的时间排序以外的排序改动、PR 的实时订阅。
  依据：issue 的「参考与现状」把 web 组件的字段明确列为「PR 标题、状态、来源分支、作者、链接」，
  上述项属于该行的**次级快照区**，不在本轮口径内。

## Notes

### 有意为之的差异（每条都保留它替换掉的 web 行为）

- **空态不渲染区块**：web 在侧栏固定位置渲染 `No linked pull requests.`（它的侧栏每个 issue
  都有这一栏）。mobile 的区块只承载 PR 一件事，没有 PR 时整块零信息，只会在每条 issue 详情里
  占屏；issue 明确允许「空态不显示或显示「无关联 PR」」。选择不显示，与 576 的「查询未落地
  不渲染空态」同一取向。查询未 settle 时同样不渲染。
- **状态图标用「同族 + 色调」表达**：Ionicons 没有 draft / closed 变体 PR 图标（见「已核实事实」）。
  open / draft / closed 共用 `git-pull-request-outline`，靠色调（success / muted / destructive）
  与副行文案区分；merged 用 `git-merge-outline`，与 web 同形。web 的图标形状差异
  （PR 带叉 = closed、虚线 = draft）在 mobile 由文案承担——副行的状态词与 web 逐字一致。
- **色调走 mobile 主题令牌**：web 用 raw `emerald-600 / violet-600 / rose-600`；mobile 用
  `success` / `brand` / `destructive`（`global.css` ↔ `tailwind.config.js` ↔ `lib/theme.ts` 一套），
  与 `autopilot-status-badge.tsx` 的既有约定一致（raw 色在深色模式下不自适应）。色调→状态的
  **分组**与 web 相同（绿=进行中、紫=已合并、红=已关闭、灰=草稿）。
- **区块折叠用组件内 state**：与 web 的 `pullRequestsOpen`（`useState(true)`）一致；
  不用 576 那种会话 store——web 这里也不是 store，没必要为它引入跨页面存活语义。
- **位置在头部区块内**：web 在详情侧栏；mobile 没有侧栏，PR 区块放在 `SubIssuesSection`
  之后、`Activity` 标题之前，与「关联实体区块集中在 description/反应之下」的既有排布一致。

### 边界说明（写进交付）

本轮的 CI/merge/统计区域不做，用户真机自测时看到的行是「标题 + `owner/repo#number · 状态 · @作者`」。
