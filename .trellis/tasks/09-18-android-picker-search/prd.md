# FEATURE-546 七个原生搜索栏选择器路由的 Android 替代实现

## Goal

把 `apps/mobile` 里依赖 iOS 原生搜索栏（`UISearchController` / `headerSearchBarOptions`）的 7 个
选择器路由，在 Android 上补上等价的搜索能力：用户能输入关键字过滤列表，且 iOS 侧行为不变。

现状：`lib/use-native-search-bar.ts` 只做一件事 —— `navigation.setOptions({ headerSearchBarOptions })`。
该 API 在 Android 无实现（`react-native-screens@4.23.0` 的 Android 源码里没有读取方），调用被静默忽略，
用户在 Android 上无法过滤这 7 个 picker 的列表。

## Requirements

1. `useNativeSearchBar` 改为平台感知的 hook：iOS 维持 `headerSearchBarOptions`，Android 提供自绘搜索框所需内容。
2. Android 分支用一个共享搜索框组件（body 内渲染），与 iOS 保持同一调用契约：`query`、`onChangeText`、取消/清空语义。
3. 规避项目已记录的坑：`TextInput` 放进 `ListHeaderComponent` 会导致聚焦丢失（见 `_layout.tsx` 中 assignee 路由的注释），
   搜索框改为与列表同级渲染，不进 `ListHeaderComponent`。
4. 不新增第三方搜索框依赖。
5. 7 个 picker 路由保持自包含（自行读 cache、自行触发 mutation、`router.back()`），只改搜索框接线。
6. `_layout.tsx` 里这些路由的导航头配置在 Android 下的取舍必须写清。

## Verified Facts（2026-09-18 本轮核对，非推测）

- **Android 无 `headerSearchBarOptions`**：`node_modules/react-native-screens` 的 Android 侧无任何读取方；
  FEATURE-547 的 `uiautomator dump` 实测（`.trellis/tasks/09-18-android-formsheet/research/android-sheets.md` §6.2）
  显示 sheet 内既无标题节点也无 `EditText`。
- **Android 上 `headerShown: true` 完全不渲染**：547 的截图 `screens/04-issue-picker-assignee.png`、
  `17-newissue-picker-assignee.png`、`10-mention-picker.png` 里 sheet 从顶边就是第一行内容 —— 没有导航头、
  没有标题、不占高度。因此 Android 端不需要为 `headerShown: true` 写平台分支。
- **iOS 侧今天只有 3 个路由真的显示原生搜索栏**：`_layout.tsx` 里只有
  `issue/[id]/picker/assignee`、`mention-picker`、`new-issue-picker/assignee` 带 `headerShown: true` + `title`；
  另外 4 个（`issue/[id]/picker/label`、`issue/[id]/picker/project`、`new-issue-picker/project`、
  `project/[id]/picker/lead`）用的是 `SHEET_OPTIONS`（`headerShown: false`）。
  源码依据（RNS iOS）：`RNSScreenStackHeaderConfig.mm:565` `shouldHide = config == nil || !config.shouldHeaderBeVisible`
  → `:582` `setNavigationBarHidden:YES`；`shouldHeaderBeVisible` 即 `hidden` 取反（`:305-311`）。
  导航栏被隐藏时 `navigationItem.searchController` 不呈现，所以这 4 个路由在 iOS 上**今天也没有搜索框**、
  没有标题（route 仍会 `setOptions`，只是无处显示），`autoFocus: true` 同样无效。
  这是上游既有缺口，不是本轮引入；issue 正文「7 个路由都用 `headerShown: true` 开启原生导航头」的前提与代码不符。
- **7 个 picker body 都是纯 FlatList**：接收 `query` prop，用 `useScrollToTopOnChange(query)` 在查询变化时把列表
  滚回顶部；body 自身不渲染任何 chrome。
- **表单内键盘**：Android formSheet 里的 `autoFocus` 输入框可用（547 §6.4，
  `project/[id]/add-resource` 实测首帧顶到 maxHeight）。
- **本机无 iOS 模拟器运行时**（`xcrun simctl list runtimes` 输出为空），iOS 侧只能给代码级证据。

## Boundary

- 不改 6 处 `ActionSheetIOS` 调用点（FEATURE-545）；不改 sheet 挡位/呈现参数（FEATURE-547）。
- **不改 iOS 可见行为**：不给那 4 个缺失 `headerShown: true` 的路由补导航头（见「边界取舍」），
  不动 `SHEET_OPTIONS` 的四个值，不改任何路由的 `title`。
- 不改 `apps/mobile` 之外的包，不改原生生成物（`android/` 是 prebuild 产物）。
- 不新增第三方依赖；不重构搜索模态页 `app/(app)/[workspace]/search.tsx`。

## Acceptance Criteria

- [x] 7 个路由在 Android 上都能输入关键字并正确过滤列表（模拟器实测 + 截图，见
      `research/android-search.md` + `research/screens/`）
- [x] 7 个路由在 iOS 上的代码路径与改动前逐字节一致（无新增平台分支落在 iOS 分支上；本机无 iOS 运行时，
      证据为「iOS 分支参数逐字未变 + fragment 单子节点 + options 未改」，见 research §5）
- [x] 输入时列表滚动位置重置的行为两端一致（`useScrollToTopOnChange` 契约不变：清除后 dump 与 baseline 逐字一致）
- [x] 7 个路由文件里没有 `Platform.OS` 硬编码，差异集中在 hook / 共享组件（`rg -n "Platform"` 在 7 个路由无命中）
- [x] Android 无第三方搜索框依赖（复用 `components/ui/text-field.tsx` + `@expo/vector-icons`）
- [x] `_layout.tsx` 导航头取舍写进实现说明与 spec（design.md §4、`android-platform.md` 新增「选择器搜索栏」节）
