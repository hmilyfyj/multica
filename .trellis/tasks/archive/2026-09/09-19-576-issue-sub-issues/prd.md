# issue 详情：子 issue 区块（列表 / 新建 / 折叠）

## Goal

`apps/mobile` 的 issue 详情页补上**子 issue 区块**，对齐 web 的
`packages/views/issues/components/issue-detail.tsx`：列表（标题 / 状态 / 指派人 / 进度）、
新建子 issue 入口、折叠展开、父 issue 展示与跳转。纯客户端改动，不涉及后端。

来源：FEATURE-576（stage 10）。

## 已核实事实（读代码）

- web 的区块结构（`issue-detail.tsx:3121-3233`）：
  - **无子 issue** 时只渲染一个 `+ Add sub-issues` 文字按钮（`childIssues.length === 0`）；
  - **有子 issue** 时渲染 header（折叠 chevron + `Sub-issues` + `done/total` 进度环与数字 +
    `+` 新建按钮）+ 列表，列表**按 stage 分组**（`groupSubIssuesByStage`，stage 升序、无 stage 的排最后，
    只有存在 stage 时才画分组头）。
  - 行 = `SubIssueRow`：状态图标 / 标识 / 标题 / 该行自己的子进度 / 指派人（web 还带内联编辑与
    属性显示开关，见「边界」）。
- 折叠状态：`packages/core/issues/stores/sub-issues-collapse-store.ts` —— **只存已折叠的 issue id**，
  默认展开，**刻意不持久化**（与 `resolved-expand-store` 同约定），放在 store 而不是组件 state，
  是为了「离开 issue 再回来还是原样」。
- 计数口径：`doneCount = childIssues.filter((c) => issueBehavesAs(c, "done")).length`，即**按状态类别**
  判定完成，不是 `status === "done"` 的字面比较；取消 / 关闭类别不计入。
- 每行自己的子进度来自 workspace 级 `GET /api/issues/child-progress`（web `childIssueProgressOptions`，
  `select` 成 `Map<parentId, {done,total}>`），不是逐行请求。
- 父 issue：web 在侧栏单独一栏（`section_parent_issue`），行内是「状态图标 + 标识 + 标题」的链接，
  点击跳到父 issue 详情（`parentIssue` 由 `issueDetailOptions(wsId, parent_issue_id)` 取）。
- 新建入口：web 的 `openCreateSubIssue` 打开 create-issue 弹窗并 seed `parent_issue_id`
  （另 seed 父 issue 的 project / assignee，见「边界」）。
- 数据接口（`packages/core/api/client.ts:1371-1400`）：
  `GET /api/issues/:id/children` → `ChildIssuesResponseSchema`（`{issues: Issue[]}`）；
  `GET /api/issues/child-progress` → `ChildIssueProgressResponseSchema`
  （`{progress: [{parent_issue_id,total,done}]}`）。两个 schema 都在 `@multica/core/api/schemas`，
  属于 mobile 允许的「平台无关 schema」。
- mobile 现状：`apps/mobile` 完全没有子 issue 相关代码（`rg "sub-issue|subIssue"` 无命中）；
  `data/api.ts` 没有 children / child-progress 方法；`data/queries/issue-keys.ts` 无对应 key。
- mobile 的 issue 详情 = `components/issue/timeline-list.tsx` 的 `ListHeaderComponent`
  （HeaderCard → Description → ReactionRow → Activity 标题）。web 的子 issue 区块位于
  description + reactions 之后、时间线之前 → 对应插在 `IssueReactionRow` 与 Activity 标题之间。
- 列表页都用 `issue.id`（UUID）导航到 issue 详情（`(tabs)/my-issues.tsx:174` 等），不是 identifier。
- mobile 没有 ProgressRing 原语；`components/ui/status-icon.tsx` 的饼图只用于 in_progress 状态图标。
- vitest（`apps/mobile/vitest.config.ts`）是 Node 环境，只收 `lib/**`、`data/**` 的 `.test.ts`，
  不加载 RN 渲染器 → 分组/计数等纯函数必须放 `lib/`。

## Requirements

1. issue 详情出现子 issue 区块，位置对齐 web（description + reactions 之后、时间线之前）：
   - 无子 issue：只显示 `+ Add sub-issues` 入口；
   - 有子 issue：header（折叠开关 + `Sub-issues` 标题 + `done/total` 计数 + 新建入口）+ 列表。
2. 列表行展示：状态图标、标识（MUL-NN）、标题、指派人、"该行自己的子进度"（有子 issue 时才显示）。
   列表按 stage 分组（stage 升序、无 stage 最后；只有存在 stage 时才画分组头）。
3. 点击行进入子 issue 详情。
4. 折叠 / 展开：默认展开，状态**仅会话内**（进程内 store，按 issue id 记录折叠的 id），
   离开再进入保持原样；不持久化、不加依赖。
5. 新建子 issue：入口打开现有新建 issue 表单，并把 `parent_issue_id` 交给创建请求；
   创建成功后父 issue 的子 issue 列表即时可见。
6. 有父 issue 时展示父 issue 行（状态图标 + 标识 + 标题），点击跳到父 issue 详情。

## Acceptance Criteria

- [x] `pnpm --filter @multica/mobile typecheck` 通过。核验：收尾轮 `rtk err -- corepack pnpm --filter
      @multica/mobile typecheck` → ok（期间修掉一次 schema 导入放错模块的错误）。
- [x] `pnpm --filter @multica/mobile lint` 通过（0 error）。核验：`rtk err -- corepack pnpm --filter
      @multica/mobile lint` → 0 errors；改动文件单独 eslint 亦无输出。
- [x] `pnpm --filter @multica/mobile test` 通过，且新增单测覆盖：
      - [x] stage 分组映射：stage 升序、无 stage 最后、组内保持输入顺序、全无 stage 时只有一组。
      - [x] 完成计数映射：按状态类别判定 done（自定义 done 类状态计入、cancelled/closed 不计入）。
      - [x] 每行子进度映射：`Map` → 计数文本，无条目 / total 为 0 时不显示。
      核验：`apps/mobile/lib/sub-issues.test.ts` 13 例通过；全量 `test` = vitest 489 例 / 56 文件 +
      4 个 shell 脚本用例全过。变异验证：把计数改回 `child.status === "done"` 时
      「自定义 done 类状态」用例失败（RED，1 failed / 12 passed），`git checkout --` 恢复后全绿。
- [x] 打 arm64-v8a / production / `EXPO_PUBLIC_API_URL=https://fengit-multica.frp.tbxzs.net` 的
      Release APK，走 GitHub Release 交付。核验：Release `android-v0.1.1-vc9-sub-issues`，
      资产 `haier-mall-android-0.1.1-vc9-arm64-v8a-sub-issues.apk`，48,733,043 字节，
      sha256 `5e44b855…52483ab`，签名证书 `267600f2…b25ccf`（与 vc8 同证书，可覆盖安装）；
      包内仅 `lib/arm64-v8a/`，bundle 内 `fengit-multica.frp.tbxzs.net` 出现 1 次、
      `api.multica.ai` 0 次。
- [x] 本地可用性验证（不启模拟器）：typecheck / lint / test；真机验收由用户执行，交付里分开写明。
      核验：未启动任何模拟器与设备；Release 说明含 7 步真机自测与已知边界。
- [x] squash 合并进 `main`（GitHub PR #65 → `5d4f84e0a`），合并后本 issue 置 `done`。
- [x] 合并后启动第 2 波（FEATURE-578 / FEATURE-579），先确认没有在跑的 run。
      核验：`multica issue runs FEATURE-578/579 --active` 均为空后指派。

## Boundaries

- 独占：`apps/mobile/components/issue/**`、`apps/mobile/app/(app)/[workspace]/issue/**`、
  `apps/mobile/data/queries/issues.ts`（只追加），以及本任务新建的 store / 纯函数 / 测试。
- `apps/mobile/data/api.ts`、`app/(app)/[workspace]/_layout.tsx`：只追加自己的方法与路由，不重排既有内容。
  （实际只在 `data/api.ts` 追加两个方法；本任务不需要新路由。）
- 需要给现有新建 issue 表单加一个可选 `parent` 参数（`app/(app)/[workspace]/new-issue.tsx`）——
  复用既有表单而不是重写一套子 issue 创建流程。
- 不改收件箱与聊天相关文件；不改 `packages/core`；不改实时层（见「边界说明」）。
- **本任务不做**：子 issue 行的内联状态 / 指派人编辑、web 的子 issue 属性显示开关
  （`sub-issue-display-store`）、批量选择 + 批量操作工具条、agent 正在工作角标、
  新建时继承父 issue 的 project / assignee。

## Notes

### 有意为之的差异（都有 web 参照行为）

- **进度环 → 计数文本**：mobile 没有 ProgressRing 原语，为一个装饰性圆环新增通用原语不划算
  （AGENTS.md：新通用原语需 ≥3 个调用方）。web 在圆环旁同时渲染 `done/total` 文本，
  mobile 只渲染该文本，计数口径完全一致。
- **父 issue 不可折叠**：web 的父 issue 栏可折叠，但它只有一行；一行内容的折叠开关是噪声。
  展示内容（状态图标 + 标识 + 标题 + 跳转）与 web 一致。
- **父 issue 位置**：web 在侧栏属性块之下；mobile 没有侧栏，放在 HeaderCard（属性区）之后、
  描述之前，保持 web 的「属性 → 父 issue」相对次序。
- **空态渲染时机**：web 在子 issue 查询未回来时也会先渲染 `+ Add sub-issues`（`childIssues` 默认空数组）。
  mobile 在查询未落地时不渲染该入口，避免「先闪一个新建按钮、再变成列表」；查询完成且为 0 才渲染。
- **新建不继承 project / assignee**：web 的 `openCreateSubIssue` 会把父 issue 的 project 与 assignee
  seed 进表单。mobile 表单的属性 chip 由 `useNewIssueDraftStore` 驱动，要做「可见地」继承需要
  父 issue 的 `Project` 对象与 assignee 解析，属于本任务范围外的额外耦合；本任务只传
  `parent_issue_id`，表单里看到的就是会创建的内容（所见即所得）。
