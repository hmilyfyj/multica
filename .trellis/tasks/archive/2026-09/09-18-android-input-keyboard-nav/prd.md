# FEATURE-548 · Android 输入、键盘与系统导航行为校准

Multica issue：FEATURE-548（阶段 3，与 FEATURE-550 并行）。基线 `main`，起点 `966b6bd6f`
（已含 FEATURE-549 的 `5ef1ae648`）。

## 目标

把 Android 上的键盘避让、返回键、edge-to-edge 安全区与状态栏四件事从「按 iOS 直觉写的默认值」
校准到「在 Android 15 边缘到边缘下确实可用」，且**不翻转 iOS 既有行为**。

## 已核实事实（本任务起点，全部来自本仓文件或实测）

| # | 事实 | 来源 |
|---|---|---|
| F1 | 8 处 `KeyboardAvoidingView` 统一是 `behavior={Platform.OS === "ios" ? "padding" : undefined}` | `search.tsx:440`、`(tabs)/chat.tsx:516`、`new-issue.tsx:111`、`project/new.tsx:180`、`project/[id]/edit.tsx:128`、`issue/[id]/edit.tsx:153`、`(auth)/login.tsx:39`、`(auth)/verify.tsx:74` |
| F2 | RN 的 `KeyboardAvoidingView` 在 `behavior` 为 `undefined` 时**渲染成普通 View**（`switch` 无匹配分支 → 落到默认 `return <View …/>`），即 Android 上这 8 处**完全不参与避让** | `node_modules/react-native/Libraries/Components/Keyboard/KeyboardAvoidingView.js:229-300` |
| F3 | `app.config.ts` 未设 `android.softwareKeyboardLayoutMode`，Expo 插件默认写 `adjustResize` | `@expo/config-plugins/build/android/WindowSoftInputMode.js:38-44`；生成物 manifest`android:windowSoftInputMode="adjustResize"` |
| F4 | 项目**强制 edge-to-edge**：`gradle.properties` 的 `edgeToEdgeEnabled=true`；`targetSdkVersion=36`（越过 API 35 的强制线）；且 `react-native-is-edge-to-edge@1.3.1` 在本仓是**恒返回 true 的桩**，于是 `KeyboardProvider` 给原生 `KeyboardControllerView` 传 `preserveEdgeToEdge=true`，库内 `EdgeToEdgeReactViewGroup.setEdgeToEdge()` 调 `WindowCompat.setDecorFitsSystemWindows(window, false)` | `app.config.ts` expo-build-properties 段；`node_modules/react-native-keyboard-controller/src/animated.tsx:208-225`；`.../views/EdgeToEdgeReactViewGroup.kt:144-155` |
| F5 | 评论 composer 在 Android **不被键盘遮挡**（FEATURE-542 探针 C4），原因是它走 `MessageComposer` 默认 `manageKeyboard=true` → `KeyboardStickyView`；聊天 composer 显式传 `manageKeyboard={false}`，把避让责任交给 chat.tsx 的 KAV —— 而那个 KAV 在 Android 是空操作（F2） | `docs/android-probe.md` C4；`components/chat/chat-composer.tsx:23`；`components/composer/message-composer.tsx:597-608` |
| F6 | 三处原生 `Modal`（action sheet、agent picker、lightbox）都带 `onRequestClose`，返回键可关 | `components/ui/action-sheet.tsx:115`、`components/chat/agent-picker-sheet.tsx:44`、`lib/markdown/lightbox-provider.tsx:101` |
| F7 | formSheet 路由在 Android 由 react-native-screens 渲染为 Material BottomSheet，**BACK 关闭 sheet**（RNS 路由到 `dismissSelf`） | `.trellis/spec/mobile/frontend/android-platform.md`；FEATURE-547 `research/android-sheets.md` |
| F8 | 全仓无 `BackHandler` / `usePreventRemove` / `beforeRemove`，返回键行为完全交给 expo-router + RNS 默认 | `rg BackHandler|usePreventRemove|beforeRemove` 0 命中（除 modal 的 `onRequestClose`） |
| F9 | 本机 iOS 侧**无法取证**：无 simulator runtime。iOS 结论只能是结构性的（改动落在 `Platform.OS === "ios"` 之外） | `.trellis/spec/mobile/frontend/android-platform.md` |

## 修改边界

**本任务可改**

- 上述 8 个 `KeyboardAvoidingView` 调用点（及其所在页面的安全区/状态栏处理）
- 聊天 composer 的键盘归属（`chat.tsx` ↔ `chat-composer.tsx` 的 `manageKeyboard` 契约）
- `app.config.ts` 中 keyboard / 系统栏相关项（如 `android.softwareKeyboardLayoutMode`）
- 新增一个共用的键盘避让封装组件（若选该方案）

**明确不改**

- `lib/theme.ts`、`global.css`（属 FEATURE-549）
- markdown 渲染与样式（属 FEATURE-550）
- 任何 `Platform.OS === "ios"` 分支的既有取值 —— iOS 行为必须逐字不变
- 生成目录 `android/`（gitignored，一律改 `app.config.ts`）

## 验收条件

1. 下列 6 个场景在 Android 上输入时**输入框与提交控件始终可见**（不被 IME 遮挡）：
   登录、验证码、聊天、新建 issue、编辑 issue、评论
2. 三类返回路径行为正确，不出现「返回后白屏」或「在本该回上一层时直接退出应用」：
   - sheet 叠 sheet（issue 详情 → 属性 picker → picker 内二级 sheet）
   - modal 套 modal（页面 → ⋯ 菜单/agent picker → 其内部动作）
   - picker `router.back()`
3. 底部 tab bar 与聊天输入框不被系统导航条遮挡（edge-to-edge 手势条 / 三键导航两种模式）
4. 状态栏前景色在深浅两套下与背景对比正确；内容不被状态栏压住
5. 输入框获得焦点时页面可滚动到该输入框（软键盘模式下不出现「字段在键盘后面且滚不到」）
6. iOS 既有行为不变（结构性论证 + 逐文件对照平台分支取值）

## 证据要求（沿用 android-platform.md）

- Android 侧：模拟器/真机实测，标注**设备型号、Android 版本、构建类型**
- iOS 侧：说明范围与结论来源（本机无 runtime → 结构性论证）
- 不用单测结论替代真机验证；截图落到本任务 `research/screens/`

## 实施结论（2026-09-18 落地）

基线抬到 `main` @ `564e6db87`（已含前置 FEATURE-557 的品牌化）。

| 交付项 | 落点 |
|---|---|
| 键盘避让的唯一入口 | 新增 `apps/mobile/components/ui/keyboard-avoiding-view.tsx`：iOS 仍渲染 RN 组件 + `behavior="padding"`（逐字不变），Android 渲染 `react-native-keyboard-controller` 的实现；`className` 用 `cssInterop` 注册 |
| 8 个调用点 | `search.tsx`、`(tabs)/chat.tsx`、`new-issue.tsx`、`project/new.tsx`、`project/[id]/edit.tsx`、`issue/[id]/edit.tsx`、`(auth)/login.tsx`、`(auth)/verify.tsx` 改为引用该封装；`behavior={Platform.OS === "ios" ? "padding" : undefined}` 全部删除，`Platform` 随之不再需要 |
| 聊天 composer 的键盘归属 | 契约不变（`manageKeyboard={false}`，父级 KAV 负责避让），两份注释订正为「父级 KAV + tab bar 自带的底部 inset」，不再声称 chat.tsx 有 `SafeAreaView` |
| Android 返回键 | 新增 `apps/mobile/lib/use-android-back-dismiss.ts`，接在 `components/nav/more-tab-dropdown.tsx`：菜单开着时 BACK 先关菜单（改动前会直接退到后台） |
| 软输入模式 | `app.config.ts` 显式写 `android.softwareKeyboardLayoutMode: "resize"`（Expo 默认值，写明为什么不能用 `pan`） |
| 平台约定 | `.trellis/spec/mobile/frontend/android-platform.md` 更新 `KeyboardAvoidingView` 行并新增「键盘避让与系统返回键」小节；`apps/mobile/docs/android-probe.md` 的 C4 与结论摘要行按实测结果补记 |

设备侧必须实测的点全部整理在 `research/verification-handoff.md`，交给 FEATURE-551 的那一次验收。
本任务**未起模拟器**：`research/` 下的截图与 `state.log` 是本任务开工前那一轮（改动前）留下的基线。
