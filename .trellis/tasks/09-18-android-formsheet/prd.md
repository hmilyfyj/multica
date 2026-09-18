# FEATURE-547 十八个 formSheet 路由在 Android 的表现校准

## Goal

把 `apps/mobile` 中所有以 `SHEET_OPTIONS` 注册的 formSheet 路由，在 Android 上逐条实测并校准
呈现与交互：sheet 是否弹出、挡位是否生效、能否拖拽关闭、圆角与抓手是否可见、sheet 内滚动是否与
拖拽冲突、叠放 sheet 的返回路径是否落在正确的父级、深链锚点是否成立。

上游 `SHEET_OPTIONS` 的注释是按 iOS 写的（`UISheetPresentationController`）；Android 由
`react-native-screens` 的 Material BottomSheet 承接，参数语义不同，因此需要逐条实测而不是照搬假设。

## Requirements

1. 逐路由实测 Android 呈现与交互，证据落盘（截图 + 可复现脚本）。
2. 按需引入平台分支：iOS 参数值保持不变，Android 只补实测证明必要的差异。
3. 改动集中在 `SHEET_OPTIONS` / 其明确需要覆盖的路由，不在 24 条路由里散落重复配置。
4. 保证 sheet 互相叠放（new-issue → due-date / priority picker）在 Android 上返回父级正确。
5. 保证 `unstable_settings.anchor = "(tabs)"` 的深链锚点语义在 Android 上成立。

## Verified Facts（2026-09-18 本轮实测，非推测）

- **路由数量是 24 不是 18**：`_layout.tsx` 中 `options={SHEET_OPTIONS}` 或 `{...SHEET_OPTIONS, …}`
  的 `<Stack.Screen>` 共 24 条。issue 正文列的 18 条是其中一部分（少了 `issue/[id]/picker/assignee`、
  `new-project-picker/{status,priority}`、`issues-filter`、`chat-sessions`、`switch-workspace`）。
  本轮按 24 条全覆盖。
- **iOS 的四组参数在 Android 上都被使用，只是语义不同**（源码：`react-native-screens@4.23.0`
  `bottomSheet/SheetDetents.kt`、`ScreenModalFragment.configureBehaviour`、`Screen.onSheetCornerRadiusChange`）：
  - 2 挡位映射为 `peekHeight = detents[0]`、`maxHeight = detents[last]`，并强制 `isFitToContents = true`
    → 内容矮的 sheet 会停在内容高度，而不是固定 60%。
  - `sheetCornerRadius` 通过 Material `ShapeAppearanceModel` 只圆上两个角。
  - `sheetGrabberVisible` 只被存进 `Screen.isSheetGrabberVisible`，**Android 侧从不绘制**（全仓 grep
    无读取方），即抓手在 Android 无实现。
- **实测行为**（API 35 模拟器 + 真机同款 Debug 包）：
  - 24 条路由全部能打开、有内容、无空白/零高度（除 due-date，见下）。
  - 拖拽关闭可用；拖拽上移可展开到 0.95 挡；展开后内容可继续滚动（展开态下嵌套滚动正常）。
  - BACK 会关闭 sheet（RNS 把返回键接到 `dismissSelf`）；点击遮罩也会关闭 —— 两条都是 Android 约定。
  - 叠放场景：new-issue（modal）→ priority/due-date picker → 选中后回到 new-issue 表单且 chip 更新，
    返回路径正确。
  - 深链直达 picker（无父级）后返回，落在 `(tabs)` 锚点（Inbox）。
- **due-date 两个路由在 Android 上原本不可用**（本轮最大发现）：
  Android 没有 inline 日期选择器，`display="inline"` 等所有取值最终都是 `DialogFragment`。该对话框从
  formSheet 内部打开时**拿不到输入**：点日期、点 CANCEL/OK 全部无效；按 BACK 会把 sheet 关掉而对话框
  留在屏幕上盖住整个 App，直到进程被杀（`DialogFragment` 挂在 Activity 的 FragmentManager 上，
  sheet 退出后它继续存活）。此时 sheet 本体只剩一行自绘 header，即正文验收里禁止的「空白 sheet」。
  把路由改成 `presentation: "modal"` 后对话框恢复可用（实测：选中 9/22 → OK → 行内文案更新 → Done 落库）。

## Boundary

- 不改 6 处 `ActionSheetIOS` 调用点（FEATURE-545）。
- 不改 picker 的搜索框实现（FEATURE-546）；`_layout.tsx` 里 7 个 picker 相关的 `headerShown: true` /
  `title` 保持原样，供 546 在其上继续。
- 不改 iOS 的参数值（`SHEET_OPTIONS` 的四个数值两平台共用）。
- 不改 `apps/mobile` 之外的包；不改原生生成物（`android/` 是 prebuild 产物）。

## Acceptance Criteria

- [x] 24 条路由在 Android 上逐条打开、有内容、可返回（截图见 `research/screens/`）
- [x] 叠放 sheet 返回父级正确（new-issue → picker → 回表单且 chip 更新）
- [x] 深链锚点语义成立（深链直达 picker 后返回落在 tabs）
- [x] due-date 路由在 Android 上可选中日期并落库
- [x] 实测记录落到 `research/android-sheets.md` + `research/screens/`
- [ ] iOS 侧抽查：本机无可用 iOS 模拟器运行时（`xcrun simctl list runtimes` 为空），改为「iOS 参数值
      未改动 + 分支仅在 `Platform.OS === "android"` 生效」的代码级证据，并在交付评论里说明
