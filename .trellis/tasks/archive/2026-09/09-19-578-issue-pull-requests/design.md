# 技术设计

## 数据层

```
GET /api/issues/:id/pull-requests  → { pull_requests: GitHubPullRequest[] }
```

- `data/api.ts`（只追加）：`listIssuePullRequests(issueId, { signal })` → `{ pull_requests }`。
  用既有 `fetchValidated` + core 的 `IssuePullRequestsResponseSchema` /
  `EMPTY_ISSUE_PULL_REQUESTS_RESPONSE`（平台无关 schema，属 mobile 白名单），
  endpoint 串 `GET /api/issues/:id/pull-requests`，与 `listChildIssues` 同形。
  加 `signal` 转发（AGENTS.md「Forward each query's signal」）。
- `data/queries/issue-keys.ts`（只追加）：`pullRequests: (wsId, id) =>
  [...issueKeys.all(wsId), "pull-requests", id]`。
  放在 `issues/<wsId>` 前缀下（previously note 的 workspace 作用域规则），
  而不是抄 web 的 `["github", "pull-requests", id]`——mobile 的 key 工厂一律 workspace 作用域，
  这样才能随 workspace 切换自然失效。
- `data/queries/issues.ts`（只追加）：`issuePullRequestsOptions(wsId, id)`；
  `queryFn` 返回内层数组（与 `issueChildrenOptions` 同风格），`enabled: !!wsId && !!id`。
  不设 `refetchOnMount`：PR 关联由 webhook 写入，用户下拉刷新即可（见 implement.md 的回滚）。

## 纯函数（`lib/pull-requests.ts`，Node 单测可覆盖）

对齐 web `pull-request-list.tsx` 的渲染规则，逐条同源：

- `pullRequestStateLabel(state: string): string` —— open/draft/merged/closed → `Open`/`Draft`/
  `Merged`/`Closed`，其余**原样返回**（对齐 `getStateLabel` 的 fallback）。
- `pullRequestTone(state: string): PullRequestTone` —— 归一成
  `"open" | "draft" | "merged" | "closed" | "unknown"`，供视图查色调表；未知状态走 `unknown`
  （= muted），不会因为后端新增状态而落到某个彩色分支上。
- `pullRequestRef(pr)` —— `` `${repo_owner}/${repo_name}#${number}` ``（对齐副行前缀）。
- `pullRequestAuthorLabel(pr)` —— `author_login` 有值时 `@login`，否则 `null`
  （web 是 `pr.author_login ? ` · @${...}` : null`）。
- `splitPullRequests(prs, expanded)` —— 折叠规则：
  `PULL_REQUEST_FOLD_THRESHOLD = 4`；`prs.length < 4` → 全部可见、无折叠；
  `>= 4` → 可见前 3 条，其余进 `folded`，并给出 `foldedCount` 与
  `showMoreLabel`/`showLessLabel`（`Show N more` / `Show less`）。
  返回结构 `{ visible, folded, useFold, foldedCount }`，视图不自己算下标。

## 视图

`components/issue/pull-request-list.tsx`（新文件）：

- 查询：`issuePullRequestsOptions(wsId, issue.id)`。
- 门禁：`deriveGitHubSettings(workspace).prSidebar`（`workspaceListOptions()` 已由
  `app/(app)/[workspace]/_layout.tsx` 常驻挂载，此处只是复用同一份缓存，不发新请求）。
  不是 `prSidebar` → 返回 `null`；查询未 settle 或 0 条 → 返回 `null`（见 prd「有意为之的差异」）。
- 区块头：`Collapsible`（`open={expanded}`，组件内 `useState(true)`）+ chevron + `Pull requests`
  标题 + 右侧数量角标（`bg-muted` 圆角，与 576 的 `done/total` 同款）。
- 行 `PullRequestRow`：`Pressable`（`accessibilityRole="link"`）→
  `Linking.canOpenURL` / `openURL(pr.html_url)`（照抄 `project-resources-section.tsx` 的写法）。
  内容：状态图标（`Ionicons`，色调来自 `pullRequestTone`）+ 标题（单行截断）+
  副行 `owner/repo#number · {stateLabel} · @author`。draft 行 `opacity-80`（对齐 web）。
- 折叠区：`useFold && foldedCount > 0` 时渲染 `Show N more` / `Show less` 文字按钮
  （组件内 state），行样式与区块内其他行一致。
- 挂载：`components/issue/timeline-list.tsx` 的 `ListHeader`，`<SubIssuesSection>` 之后、
  `Activity` 标题之前（只加一行）。

## 状态 → 图标 / 色调

| state | web 图标 + 色 | mobile 图标（Ionicons） | mobile 色调 |
|---|---|---|---|
| open | `GitPullRequestArrow` / emerald-600 | `git-pull-request-outline` | `text-success` |
| draft | `GitPullRequestDraft` / muted-foreground | `git-pull-request-outline` | `text-muted-foreground` |
| merged | `GitMerge` / violet-600 | `git-merge-outline` | `text-brand` |
| closed | `GitPullRequestClosed` / rose-600 | `git-pull-request-outline` | `text-destructive` |
| 其他 | `GitPullRequest` / 无色调 | `git-pull-request-outline` | `text-muted-foreground` |

图标名已在装好的 `@expo/vector-icons` 的 Ionicons glyphmap 里核对存在
（`git-pull-request-outline` / `git-merge-outline`）。

## 被否掉的方案

1. **从 `@multica/core/github` 直接 import `deriveGitHubSettings`**：
   该 barrel 会连带 `queries.ts`（react-query + core ApiClient）与 `use-github-settings.ts`，
   违反 `apps/mobile/AGENTS.md:7` 的运行时导入白名单。改为在 `packages/core/package.json`
   只追加 `"./github/settings": "./github/settings.ts"`——与仓库既有先例
   `"./billing/recovery"`（mobile 在用）完全同型，只加一条可解析路径，不改任何代码。
2. **mobile 自己重写一份 `prSidebar` 派生**：同一开关出现两套实现，后端默认值一改（现在是
   `!== false` 的三态语义）两边就会漂移，属于「第二个约定」。
3. **不做 `prSidebar` 门禁**：workspace 关掉 PR 侧栏时 mobile 仍显示 PR，与 web 可见性不一致。
4. **空态渲染 `No linked pull requests.`**：见 prd「有意为之的差异」第 1 条。
5. **把 PR 列表做成 `data/queries/github.ts` 新文件**：mobile 的 issue 域查询都集中在
   `data/queries/issues.ts` 且边界允许只追加，新建文件会凭空多一个域文件却没有第二个消费者。
6. **本轮补 CI / merge / 统计行**：issue 已把参考字段限定为「标题、状态、来源分支、作者、链接」，
   次级快照区（`checks_*` / `mergeable` / `additions`）需要 `snapshot_available` 三态门禁与
   六种 merge 状态文案，属独立一轮；本轮不写半套。
