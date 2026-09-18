# 实施计划

## 新增

| 文件 | 内容 |
|---|---|
| `apps/mobile/lib/use-picker-search-bar.tsx` | `usePickerSearchBar(placeholder, {autoFocus}) → { query, searchBar }`；iOS 分支只调 `navigation.setOptions({ headerSearchBarOptions })`（参数与原实现逐字一致），其余平台返回 `<SearchField>` 元素 |
| `apps/mobile/components/ui/search-field.tsx` | 共享搜索框：放大镜图标 + `TextField` + 清除按钮；props `{ value, onChangeText, placeholder, autoFocus, className? }` |

删除：`apps/mobile/lib/use-native-search-bar.ts`（改名，无旧引用残留）。

## 修改

| 文件 | 改动 |
|---|---|
| `app/(app)/[workspace]/mention-picker.tsx` | `useNativeSearchBar(...)` → `usePickerSearchBar(...)`；return 改 fragment：`{searchBar}` + body |
| `app/(app)/[workspace]/issue/[id]/picker/assignee.tsx` | 同上 |
| `app/(app)/[workspace]/issue/[id]/picker/label.tsx` | 同上 |
| `app/(app)/[workspace]/issue/[id]/picker/project.tsx` | 同上 |
| `app/(app)/[workspace]/new-issue-picker/assignee.tsx` | 同上 |
| `app/(app)/[workspace]/new-issue-picker/project.tsx` | 同上 |
| `app/(app)/[workspace]/project/[id]/picker/lead.tsx` | 同上 |
| `components/issue/pickers/{assignee,label,mention,project}-picker-body.tsx`、`components/project/pickers/project-lead-picker-body.tsx` | 只改文件头注释里对 `useNativeSearchBar` / 「native nav header 提供搜索框」的描述（改完即失实）；**不动**筛选、行渲染、`useScrollToTopOnChange` 任何代码 |
| `app/(app)/[workspace]/_layout.tsx` | 只改注释：Android 块补一句 `headerShown: true` 在 Android 不渲染、搜索框由 body 承担；assignee 那条 `Stack.Screen` 上方的「Experiment」注释补记当前 7 条路由的真实状态。**不动任何 options 值** |
| `.trellis/spec/mobile/frontend/android-platform.md` | 「已知 iOS 专有点位」表里 `headerSearchBarOptions` 行改为「已由 FEATURE-546 收敛到 `usePickerSearchBar` + `SearchField`」，并记 iOS 侧 4 条路由缺 `headerShown: true` 的既有缺口 |

不改：`SHEET_OPTIONS` / `DUE_DATE_OPTIONS` 的取值、7 条路由的 `title`、任何 `ActionSheetIOS` 调用点、
`app/(app)/[workspace]/search.tsx`。

## 验证

1. 收尾一次跑完（仓库 `apps/mobile/AGENTS.md` 口径）：
   `pnpm --filter @multica/mobile typecheck` / `lint` / `test`，必要时 `pnpm check`。
2. `rg -n "useNativeSearchBar|use-native-search-bar"` 应无命中（除历史 spec 说明）。
3. `rg -n "Platform"` 检查 7 个路由文件里没有平台分支。
4. Android 模拟器（`Medium_Phone_API_35`，Debug，`JAVA_HOME=` JDK 21 + `ANDROID_HOME`）：
   登录（验证码 888888）后逐个打开 7 个 picker，输入关键字，`uiautomator dump` + 截图核对
   「搜索框存在 + 列表被过滤 + 清除后恢复全量」；证据落 `research/`。
5. iOS：本机无模拟器运行时（`xcrun simctl list runtimes` 为空），给代码级证据 —— iOS 分支返回值与
   `headerSearchBarOptions` 参数逐字未变、7 个路由的 iOS 渲染子树未变（fragment 里只剩原 body）。
