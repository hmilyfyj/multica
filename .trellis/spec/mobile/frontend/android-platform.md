# Android 平台约定

> `apps/mobile` 从 iOS-only 扩展到 Android 的平台差异约定。新平台分支照此执行。

---

## 本仓库定位

- fork 自 `multica-ai/multica`（Go 后端 + React Native 移动端 + web/desktop 的 monorepo）。
- 本仓库当前主要开发方向：为 `apps/mobile`（Expo SDK 55 / React Native 0.83 / expo-router）打开 Android 平台。
- 同步上游：本地 remote `upstream` 指向 `multica-ai/multica`，需要时 `git fetch upstream && git merge upstream/main`。

## 平台差异原则

1. **差异集中封装，不散落**。同一类平台差异只实现一处（hook / 共享组件 / 集中配置），调用方无感。禁止在多个路由里各写一遍 `Platform.OS` 判断。
2. **不改 iOS 既有行为**。Android 适配以新增平台分支的方式实现，iOS 路径保持原样；改动后必须有 iOS 不受影响的确认。
3. **优先复用已有模式**。项目已有 body 渲染头部、formSheet、RNR 原语等模式；先复用再加新抽象，新的通用原语需至少 3 个调用方。
4. **生成目录不手改**。`ios/` 与 `android/` 都是 `expo prebuild` 生成物且在 `.gitignore` 中，配置一律写进 `app.config.ts` / `expo-build-properties`。

## 已知 iOS 专有点位（基线 commit `0358b7d5d`）

| 能力 | 位置 | 数量 | Android 状态 |
|---|---|---|---|
| `ActionSheetIOS` | `inbox.tsx:80`、`issue/[id].tsx:126`、`more/settings/profile.tsx:67`、`project/[id].tsx:98`、`components/chat/message-long-press.tsx:56`、`components/issue/comment-context-menu.tsx:111,236` | 6 处 | 已收敛到 `components/ui/action-sheet.tsx`（FEATURE-545）：iOS 转发原生 sheet，其余平台渲 JS 面板 |
| `headerSearchBarOptions`（原 `useNativeSearchBar`，现 `usePickerSearchBar`） | `mention-picker`、`issue/[id]/picker/{assignee,label,project}`、`new-issue-picker/{assignee,project}`、`project/[id]/picker/lead` | 7 路由 | 已由 FEATURE-546 收敛到 `lib/use-picker-search-bar.tsx` + `components/ui/search-field.tsx`：iOS 用原生 `UISearchController`，其余平台用 body 内搜索框 |
| `presentation: "formSheet"` + detents/grabber | `app/(app)/[workspace]/_layout.tsx` 的 `SHEET_OPTIONS` | 24 路由 | 参数全部生效但语义不同（挡位→`peekHeight`/`maxHeight`、只圆上两角、抓手不绘制），24 条逐条实测见 FEATURE-547 |
| `KeyboardAvoidingView` | 8 个表单/聊天页面（`login`、`verify`、`search`、`chat`、`new-issue`、`issue/[id]/edit`、`project/new`、`project/[id]/edit`） | 8 处 | 已由 FEATURE-548 收敛到 `components/ui/keyboard-avoiding-view.tsx`：iOS 仍是 RN 组件 + `padding`（逐字不变），Android 换 `react-native-keyboard-controller` 的 IME inset 实现 |
| `expo-image` 的 `sf:` SF Symbol 源 | `(tabs)/_layout.tsx` 4 个 tab 图标、`components/nav/more-tab-dropdown.tsx`（3 个菜单图标 + 2 个 chevron）、`switch-workspace.tsx`（checkmark） | 7 处 | **Android 完全空白**（Glide 抛 `IllegalArgumentException: Expected URL scheme 'http' or 'https' but was 'sf'`，静默不画）。已由 FEATURE-549 收敛到 `components/ui/nav-icon.tsx`：iOS 仍走 `sf:`，其余平台走 Ionicons |

### 键盘避让与系统返回键（FEATURE-548）

**键盘避让只有一个入口**：`components/ui/keyboard-avoiding-view.tsx`。不要在页面里直接用 RN 的
`KeyboardAvoidingView`，也不要再写 `behavior={Platform.OS === "ios" ? "padding" : undefined}` ——
RN 的实现按 `behavior` 走 `switch`，`undefined` 落到 default 分支，渲染出来的就是普通 `View`，
等于完全不做避让；而本应用强制 edge-to-edge（`EDGE_TO_EDGE_ENFORCED`，targetSdk 36），系统不再为
输入法压缩窗口，只把 IME inset 报给应用，必须有人消费它。iOS 分支仍是 RN 组件 + `padding`
（与改造前逐字一致）；Android 分支用 `react-native-keyboard-controller`（已是本包依赖，
`KeyboardProvider` 已包住根布局，评论 composer 的 `KeyboardStickyView` 一直走它）。

**Android 返回键按浮层类型分工，每类只有一个负责方**：

| 浮层 | 负责方 | 说明 |
|---|---|---|
| formSheet / modal 路由（picker、due-date、new-issue…） | react-native-screens 弹栈 | 路由就是栈成员，BACK 关一层 |
| 原生 `Modal`（`action-sheet`、`agent-picker-sheet`、图片查看器） | RN 的 `onRequestClose` | **新增 `Modal` 必须带 `onRequestClose`** |
| `@rn-primitives` 弹层（DropdownMenu 等） | `lib/use-android-back-dismiss.ts` | 画在 `PortalHost` 里，既不注册 BACK 也不进导航栈；不接就会出现「菜单开着按 BACK 直接把应用退到后台」 |

底部安全区不用各页面自己补：底部 tab bar 由 react-navigation 按 `insets.bottom` 抬高
（`BottomTabBar` 的 `paddingBottom` 与 `getTabBarHeight`），tab 内的页面因此天然位于系统导航条之上；
不在 tab 里的全屏容器（评论 composer 等）才需要用 `useSafeAreaInsets().bottom` 自己补。

### 选择器搜索栏（FEATURE-546）

搜索框的唯一入口：`lib/use-picker-search-bar.tsx` 的
`usePickerSearchBar(placeholder, { autoFocus }) → { query, searchBar }`。

- iOS：`searchBar` 为 `null`，hook 只做 `navigation.setOptions({ headerSearchBarOptions })`；该路由必须在
  `_layout.tsx` 注册 `headerShown: true` + `title`，否则导航栏被隐藏、原生搜索栏无处显示。
- Android / web：`headerSearchBarOptions` 无实现（`react-native-screens` 4.23 的 Android 侧没有读取方），
  hook 返回 `components/ui/search-field.tsx` 元素，由路由渲染在列表**上方**。
- 7 个 picker 路由的调用形状固定为 `<> {searchBar} <XxxPickerBody … /> </>`：iOS 上 fragment 里只剩 body，
  FlatList 仍是路由的直接子节点（`react-native-screens#3634` 要求，不能包一层 `<View>`）。
- 搜索框禁止放进 `ListHeaderComponent`（列表刷新会带走 `TextInput` 焦点）。
- 清空语义：iOS 由原生取消按钮走 `onCancelButtonPress` 重置 query（原生清空不触发 `onChangeText`）；
  Android 由 `SearchField` 的清除按钮走 `onChangeText("")`。两端最终都回到空 query，
  `useScrollToTopOnChange(query)` 契约不变。
- `_layout.tsx` 里的 `headerShown: true` 在 Android 实测**完全不渲染**（无标题、无搜索框、不占高度），
  所以该配置只对 iOS 有意义，不需要平台分支；Android 的语义提示由 chip 与行内容承担。
- 既有缺口（本轮未修，属 iOS 可见行为）：`issue/[id]/picker/{label,project}`、`new-issue-picker/project`、
  `project/[id]/picker/lead` 注册的是裸 `SHEET_OPTIONS`（`headerShown: false`），导航栏隐藏 →
  原生搜索栏不显示，这 4 个路由在 iOS 上今天也没有搜索框。

### 已有的 Android 预留（不要重复造）

- `components/ui/text-field.tsx`：`includeFontPadding` / `textAlignVertical` 已按 Android 语义写好
- `components/ui/otp-input.tsx`：一次性验证码自动填充已由底层库承担
- `components/ui/dropdown-menu.tsx`：popover 行为按 iOS/Android 通用语义实现
- `components/ui/action-sheet.tsx`：动作菜单唯一入口（FEATURE-545）。`showActionSheet(options, onSelect)` 的字段与索引语义同 `ActionSheetIOS`，宿主 `ActionSheetHost` 挂在 `app/_layout.tsx`；调用点禁止直接 import `ActionSheetIOS`
- `components/ui/search-field.tsx`：选择器搜索框唯一入口（FEATURE-546）。由 `TextField` + 放大镜 + 清除按钮组成；
  `usePickerSearchBar` 在 iOS 返回 `null`、其余平台返回该元素，7 个 picker 路由只负责把它渲染在列表上方
- `components/ui/nav-icon.tsx`：跨平台导航图标唯一入口（FEATURE-549）。`NavIcon({ sf, ion, color, size })`：
  iOS 走 `expo-image` 的 `sf:`，其余平台走 Ionicons。**新写 `sf:` 图标一律经它**，不要在任何调用点自写
  `Platform.OS` 判断，也不要直接用 `expo-image` 的 `sf:` 源。
- `.gitattributes`：`.trellis/workspace/*/journal-*.md` 使用 `merge=union`

### 原生依赖的 Android 支持（已核实）

| 依赖 | 状态 |
|---|---|
| `react-native-enriched-markdown@0.6.0` | tarball 内含 `android/src/main/jni/` C++ 桥接与 `build.gradle` |
| `react-native-shiki-engine` | 支持 arm64-v8a / armeabi-v7a / x86 / x86_64；Android 内存回收需 AppState 驱动 |
| `input-otp-native` | 纯 JS，无原生代码 |
| `@react-native-segmented-control/segmented-control` | **已无任何调用方**（FEATURE-549 核实）：全仓只有 `apps/mobile/package.json` 的依赖声明与 `docs/android-probe.md` 的历史表格提到它；`My Issues` 的 Assigned/Created/Agents 分段现由 `ScopeToolbar` 的 RNR 风格 pill 组渲染（`my-issues.tsx` 注释写明 "Replaces the previous full-width segmented tabs"）。滚动到该 UI 时会发现"Android 是 JS 模拟实现"的担忧已不适用 |

## Android 应用配置（FEATURE-543 实测，基线 commit `733b0a3fb`）

`app.config.ts` 是动态配置（`export default ({ config }) => …`），Expo 无法把缺失的平台字段回写进去，
所以下面每条都必须显式写在配置里；`android/` 是生成物，一律不手改。

| 配置 | 写法 | 依据 |
|---|---|---|
| `name` | 三段式：`海尔商城` / `海尔商城 (Staging)` / `海尔商城 (Dev)` | 两端共享：prebuild 把它写进 Android `res/values/strings.xml` 的 `app_name`（应用列表名），同时是 iOS 显示名。FEATURE-557 起用用户指定的品牌名 |
| `android.package` | 三段式品牌包名 `com.ehaier.zgq.shop.mall[.dev/.staging]`；生产可用 `EXPO_ANDROID_PACKAGE_PROD` 覆盖 | 缺失时 `expo prebuild -p android` 退出码 1（动态配置无法回写）；Play 首次上传后 applicationId 不可改，故生产值留覆盖口。Android 与 iOS 的 id 自 FEATURE-557 起不再同源：iOS 保留 `ai.multica.mobile`（Apple 签名归属） |
| `android.versionCode` | 字面量，随商店上传递增 | 同一 package 内复用 versionCode 会被 Play 拒绝；不从 `version` 推导，避免版本号一改就静默变动 |
| `android.adaptiveIcon` | 前景 `assets/adaptive-icon.png`（白标 + 透明）+ 背景 `#111827` | 前景由 `assets/icon.png`（白标压在 #111827 上）反解而来，回合成与源图最大通道差 1 个 8bit 级；白标半径 28.4dp，落在任何 launcher 遮罩都保留的 33dp 圆内，不会裁切 |
| `android.edgeToEdgeEnabled` | **不写** | SDK 55 已移除该键（Android 16 强制 edge-to-edge），写了 prebuild 会告警要求删除；实际行为由模板 `gradle.properties` 的 `edgeToEdgeEnabled=true` 与 targetSdk ≥ 35 保证 |
| `android.permissions` | **不写 `READ_MEDIA_IMAGES`** | 相册读取在 Android 13+ 走系统 photo picker（`getMediaLibraryPermissions` 返回空数组，无需权限），≤12 走 `READ_EXTERNAL_STORAGE`（模板 manifest 已声明 `maxSdkVersion="32"`）；多写会被 Play 要求声明宽泛的相册访问 |
| camera / microphone | 由 `expo-image-picker` 插件的 `cameraPermission: false` / `microphonePermission: false` 关闭 | 这两个选项不只作用于 iOS：Android 侧会转成 blocked permissions，把 `CAMERA` / `RECORD_AUDIO` 从合并 manifest 中移除。注意 `more/settings/profile.tsx` 的头像菜单仍有 "Take Photo" 入口，关着相机时该入口在 Android 只会弹权限提示（iOS 侧缺 `NSCameraUsageDescription` 的行为另行确认） |
| `userInterfaceStyle` | 保持顶层 `automatic` | Android 侧生效依赖已装的 `expo-system-ui`：prebuild 写入 `strings.xml` 的 `expo_system_ui_user_interface_style=automatic`，原生据此设 `MODE_NIGHT_FOLLOW_SYSTEM`；应用内主题切换经 NativeWind → RN `Appearance.setColorScheme` → `AppCompatDelegate.setDefaultNightMode` 覆盖原生主题 |
| `expo-build-properties` 的 `android` 段 | `compileSdkVersion` / `targetSdkVersion` 固定 36 | 安卓侧验收基线是 API 36；targetSdk 同时决定 edge-to-edge 强制行为与 Play 上传要求，SDK 升级不应静默改动它——升级后必须重跑模拟器验收再改。`minSdkVersion` 与 Kotlin 不写：无依赖抬高下限，且各原生模块都从 root project ext 读取 Expo 已设定好的 `kotlinVersion` |

改 `app.config.ts` 后必须重跑的核对：

```bash
cd apps/mobile
# 三个变体的包名互不相同
APP_ENV=staging npx expo config --type public --json | jq .android.package
npx expo prebuild -p android --clean
```

- 生成物核对点：`android/app/build.gradle` 的 `applicationId` / `versionCode`；
  `android/gradle.properties` 的 `android.compileSdkVersion` / `android.targetSdkVersion` / `edgeToEdgeEnabled`；
  `app/build/intermediates/merged_manifest/**/AndroidManifest.xml` 中无 `CAMERA` / `RECORD_AUDIO`；
  `res/values/strings.xml` 的 `expo_system_ui_user_interface_style`；`res/values/colors.xml` 的 `iconBackground`。
- 构建/合并 manifest 前必须 `JAVA_HOME=`（JDK 21）且 `ANDROID_HOME=~/Library/Android/sdk`：默认 JDK 25 会让
  Gradle 失败，未设 `ANDROID_HOME` 时 Gradle 不会自动探测 SDK（归因见 FEATURE-542 探针报告 §1.3，
  报告随 PR #1 落地到 `apps/mobile/docs/android-probe.md`）。

## Android 视觉校准（FEATURE-549 实测，基线 commit `8e94b5dad`）

设备：Android 模拟器 `Medium_Phone_API_35`（Android 15，1080×2400 @420dpi），**Debug** 构建。
截图与复现脚本：`.trellis/tasks/09-18-android-visual-calibration/research/`
（`capture-visual.sh`、`cap-one.sh`、`screens-final/`）。

### `sf:` 图标在 Android 上完全空白（已收敛）

SF Symbol 是 iOS 专有能力。`expo-image` 的 Android 实现不认 `sf:` 前缀，把它当 URL 交给 Glide：

```text
E ExpoImage: java.lang.IllegalArgumentException(Expected URL scheme 'http' or 'https' but was 'sf')
E GlideExecutor: java.lang.IllegalArgumentException: Expected URL scheme 'http' or 'https' but was 'sf'
    at okhttp3.HttpUrl$Builder.parse$okhttp(HttpUrl.kt:1254)
```

失败**不崩、不报红屏**，只是那块区域什么都没有 —— 所以探针期没被发现：底部 tab bar 只剩文字，
图标位置留空（对照 `screens-baseline/` 与 `screens-final/`）。

收敛点 `components/ui/nav-icon.tsx` 的 `NavIcon({ sf, ion, color, size })`：

- iOS 分支是改动前 `expo-image source="sf:…"` 的逐字复制，行为不变。
- 其余平台渲染 `@expo/vector-icons` 的 Ionicons —— 项目两端本来就在用这套图标
  （`icon-button.tsx`、`search-field.tsx`、`more/settings.tsx` 的 `chevron-forward` 等）。
- **新增 `sf:` 用法前先想清楚 Android 用哪个 Ionicons 名字**，两个 prop 都必填：两套图标没有
  通用命名规则，SF 的 `.fill` 变体在 Ionicons 里往往不是同名（`tray.fill` → `file-tray`）。

### 启动屏由 `expo-splash-screen` 插件接管

`app.config.ts` 的 `plugins` 里配置：

| 取值 | 理由 |
|---|---|
| `image: ./assets/adaptive-icon.png` | 与 adaptive icon 前景同一资产（白 mark + 透明底，alpha bbox 占 1024 画布 52.5%），避免启动屏与桌面图标各用一份图 |
| `imageWidth: 200` | 插件按 `size = imageWidth × 密度倍数` 画进 **288dp 画布**（`@expo/prebuild-config` 的 `withAndroidSplashImages.js`：`canvasSize = 288 × multiplier`），mark 实占约 105dp，落在 Android 12 保留的 192dp 安全区内 |
| `backgroundColor: #111827` | 与 `adaptiveIcon.backgroundColor` 和 `icon.png` 底色同值，于是"点图标 → 启动屏 → 应用"三段底色连续 |
| 不写 `dark` | 唯一可用的 mark 是白色，浅底会把 mark 吃掉；两套主题同底才叫"同一个产品" |

**没有这个包时的兜底行为（改动前实测）**：`res/values/colors.xml` 的 `splashscreen_background` 是
`#FFFFFF`，`res/values-night/` 是空目录 → 深色模式启动闪白；`res/drawable-*/splashscreen_logo.png`
是 Expo 自带占位图形，品牌 mark 完全不出现；`Theme.App.SplashScreen` 只设 `android:windowBackground`，
**没有** Android 12+ 的 `windowSplashScreenBackground` / `windowSplashScreenAnimatedIcon`
（设备是 Android 15，实际走 Android 12+ SplashScreen API）。

配置生效后的生成物核对点：

- `res/values/styles.xml`：`Theme.App.SplashScreen` 父主题变成 `Theme.SplashScreen`，带
  `windowSplashScreenBackground` / `windowSplashScreenAnimatedIcon` / `postSplashScreenTheme`
- `res/values/colors.xml`：`splashscreen_background` = `#111827`
- `MainActivity.kt`：出现 `SplashScreenManager.registerOnActivity(this)`，
  `setTheme(R.style.AppTheme)` 被插件注释掉
- 模块默认自动隐藏（`SplashScreenManager.kt` 的 `preventAutoHideCalled = false`），
  JS 侧**不需要** `SplashScreen.preventAutoHideAsync()`

### `SplashScreenManager` 的 `ClassNotFoundException` 根因

Debug 冷启动 logcat 里的这条**不是崩溃**：

```text
E DevLauncherController: Failed to hide splash screen
    java.lang.ClassNotFoundException: expo.modules.splashscreen.SplashScreenManager
```

来源是 `expo-dev-launcher` 的 `DevLauncherController.kt` —— `Class.forName("expo.modules.splashscreen.SplashScreenManager")`
包在 `try/catch (e: Throwable)` 里，失败只 `Log.e`。它只在 Debug 出现（dev-launcher 只在 debug 里）。
根因就是没装 `expo-splash-screen`；装上后类存在，本条消失（FEATURE-549 实测已消失）。

### 字体：这里**不需要**平台分支

| 事项 | 结论 | 依据 |
|---|---|---|
| React Navigation 的 header / tab 字体 | **不用改** | `@react-navigation/elements` 的 `Header/HeaderTitle.tsx` 是 `Platform.select({ ios: fonts.bold, default: fonts.medium })`，而 `@react-navigation/native` 的 `theming/fonts.js` 已给 Android `sans-serif` / `sans-serif-medium`。`NAV_THEME` 用 `...DefaultTheme` 展开、只覆盖 `colors`，本来就拿到正确的 Android 栈；覆盖它反而破坏上游分派 |
| Android「带 `fontFamily` 时 500/600 塌成 400」 | 记录为约束，本轮**无需改** | `ReactTypefaceUtils.kt` 无 `fontFamily` 时走 `Typeface.create(family, weight, italic)`；**有** `fontFamily` 时走 `ReactFontManager` 的 `nearestStyle`，而 `TypefaceStyle` 只有 `NORMAL(400)` / `BOLD(700)`。现有 `fontFamily` 只有两处：`components/ui/text.tsx` 的 `variant="code"`（**无调用方**）与 `lib/markdown/tokens.ts` 的代码块类（**无字重类**，两端都是 400）。**新增 `font-mono` + `font-semibold` 组合时注意这条** |
| 未显式 `lineHeight` 时中文行高两端不同 | **接受**，不补全站行高 | Android 的 `includeFontPadding` 默认 `true`（`TextAttributeProps.kt` / `TextLayoutManager.kt`），行高由 `StaticLayout` 按字体度量算，且 `setUseLineSpacingFromFallbacks(true)`（API ≥28）让 CJK 回退字体（Noto Sans CJK）参与；iOS 按 PingFang SC 的 ascender+descender。差异来自**两端系统字体本身**，补平台行高会动到全仓量级且本机无 iOS 对照，属该任务明令禁止的无效覆盖 |
| markdown 渲染路径 | **已经两端一致** | `lib/markdown/markdown-style.ts` 对 paragraph 与 h1~h6 全部显式给 `lineHeight`（`MD_LINE`），inline code 显式给 `fontSize`；`fontFamily` 故意不设，用平台系统 monospace |

**iOS 侧无法本地取证**：本机 Xcode 26.4 已装但没有任何 iOS simulator runtime
（`xcrun simctl list runtimes` 为空）。iOS 侧结论一律是结构性论证（改动全部落在
`Platform.OS === "ios"` 之外的路径），不是像素对照。

### 深浅色：令牌本身没有平台语义

- `global.css` 的变量是纯 HSL 颜色，NativeWind 在两端编译成同一组 RN 颜色值；`lib/theme.ts` 是它的 TS 镜像。
  浅深两套截图逐页核对后没有需要分平台的项 → **不改**。
- 状态栏前景色由 `app/_layout.tsx` 的 `<StatusBar style={isDarkColorScheme ? "light" : "dark"} />` 负责；
  系统栏（手势条）图标色由系统按背景自动翻转。实测深浅两套都正确。
- 应用内主题切换（`lib/use-color-scheme.ts`）在 Android 上正常：`Appearance.setColorScheme` →
  `AppCompatDelegate.setDefaultNightMode`。
- **自动化截图的坑**：`adb shell cmd uimode night yes|no` 只在 preference 为 `system` 时被跟随，
  且改完代码后第一次进应用要重新打包 JS、主题事件会丢。脚本请走应用内 Settings → APPEARANCE 的
  Light/Dark 行（直接 `Appearance.setColorScheme`）并用像素亮度复验，见 `research/capture-visual.sh`。

### 圆角 / 阴影 / 分割线 / 水波纹

| 项 | 两端是否真有差异 | 结论 |
|---|---|---|
| 圆角 | `lib/radius.ts` 的 `continuousCorners`（`borderCurve: "continuous"`）是 **iOS 专有**，8 文件 16 处使用，Android 静默忽略 | **接受**：iOS 是连续曲线、Android 是普通圆角；Android 没有 squircle 原生能力，加平台分支只是噪音 |
| 阴影 | RN 在 Android 只认 `elevation`（`shadowColor` 仅在 API ≥28 作为染色），`shadowOffset/Opacity/Radius` 静默丢弃；但 NativeWind 在 Android 构建期把 `shadow-sm/md/lg` 编译成 `-rn-elevation`（1/6/8） | **接受现状**；需要精确控制时照 `components/issue/timeline-list.tsx` 的 `shadow*` + `elevation` 双写范本 |
| 分割线 | 全仓一律 `h-px` / `h-[1px]`，两端都是 1dp；`tailwind.config.js` 的 `borderWidth.hairline` 是**死配置（0 处使用）** | **接受**：改 Android 成 hairline 反而制造差异 |
| 水波纹 | 全仓 **0 处** `android_ripple`、0 处 `Touchable*`，点击反馈只有 NativeWind 的 `active:` 一条路径；**RNR 上游与 iOS 同样不带** | **不引入平台分支**：这是跨平台一致的设计缺口，不是 Android 移植差异。16 处「既无 `active:` 也无 ripple」的元素清单见任务 research 目录，留待后续统一处理 |

### 复现脚本的三个坑

1. **深链不会顶掉 modal**：上一次跑到 sheet 路由后，下一次深链会把目标压在 sheet 底下
   （看着成功、其实还在旧页面）。切路由前先用 tab bar 文案判断是否处在 tab 根，不在就 BACK 弹栈。
2. **不能用 `force-stop` 做重启取证**：dev 冷启动会落回 expo-dev-client 的服务器列表页。
3. **本机自托管后端的镜像是滞后的**：`ghcr.io/multica-ai/multica-backend:latest` 拉到的构建日期
   与仓库 HEAD 不一致，实测缺 `POST /api/auth/refresh`（客户端 `data/api.ts` 会调，404 →
   `[auth] session renewal deferred`，会话不再续期，最后退回登录页）。跑视觉验收前先
   `docker pull` 该镜像并 `up -d --force-recreate backend`，否则会看到陈旧数据形态与偶发掉登录。

## 构建与验证

```bash
# 仓库根执行；包装脚本先 prebuild 再 run，保证 config plugin 的改动生效
# 前置环境：JAVA_HOME 指向 JDK 21、ANDROID_HOME 指向 Android SDK
pnpm android:mobile:staging          # 默认设备／模拟器，Debug
pnpm android:mobile:device:staging   # 从设备列表中选择，Debug
```

- 完整检查（typecheck / lint / test）在编码完成后一次跑完，不在迭代中途反复跑。
- 自动化测试只覆盖纯函数（`apps/mobile/lib/*.test.ts`，Node 环境），**不覆盖 RN 组件渲染与原生交互**。
- Debug 构建只编译目标设备实际运行的 ABI（见 `apps/mobile/README.md` 的「原生 ABI 收敛（Debug）」）：
  模板默认的四套 ABI 在 arm64-v8a 模拟器上实测 245MB APK / `adb install` 38.7s /
  worklets+reanimated 冷编译 187s，收敛后为 87MB / 2.9s / 79s；`MULTICA_ANDROID_ABIS=all` 可恢复默认，release 构建不收敛。

## Markdown 渲染与代码高亮（FEATURE-550 实测，基线 commit `7520b1bc6`）

设备：模拟器 `Medium_Phone_API_35`（Android 15 / API 35，arm64-v8a）；构建：Debug（dev 变体，JS 走 Metro）。
截图与原始数据：`.trellis/tasks/09-18-android-markdown-highlight/research/verify-final/`。

- **原生渲染在 Android 侧成立**：`react-native-enriched-markdown@0.6.0` 带完整 Android 实现（Kotlin Spannable
  渲染器 + `android/src/main/jni` 的 md4c C 解析），与 iOS 共用同一 ADR 约束 —— 不需要为 Android 写 renderer。
- **语法矩阵逐项通过**（浅深两套）：h1–h6、加粗/斜体/删除线、行内代码、普通链接、无序/有序/嵌套列表、
  任务列表（含已勾选删除线）、引用（含嵌套）、表格（含中/右对齐）、分隔线、ts/python 代码块高亮、
  未知语言回退纯文本、表情、硬换行、超长行、列表内代码块。
- **高亮**：12 语言预注册的 Oniguruma scanner 正常；未知语言（`foobar`）与「引擎不可用」走同一条
  `highlight() → null` → `PlainCode` 分支，前者已在设备上实测不抛错、渲染等宽纯文本。
- **内存回收**：两个平台都没有 `memoryWarning` / `onTrimMemory` 挂钩（issue 里「iOS 已有」与代码不符）；
  引擎按 50MB 上限淘汰 pattern cache，但**高亮器实例存活时 scanner 不释放**。Android 现由 AppState 驱动：
  `background` → `releaseHighlighter()`（dispose → `destroyScanner`），`active` → 重新预热。
  实测（同一会话，KB）：12 语言渲染后 Native Heap Alloc 342,442 / Free 32,839 → 按 HOME 进后台
  Alloc 255,976 / Free 118,881（Alloc −86MB、TOTAL PSS −85MB）→ 回前台仍保持释放态，再次打开按需重建。
  深链会触发一次瞬时 `background → active`（实测 ~165ms），即每次深链释放并立即重建一次，属设计取舍（iOS 不注册）。
- **长文档**：PROB-2（24 段 × 2 代码块）滚动到底全部渲染、无空白占位。
- **帧率不作验收结论**：同一构建同一协议实测 2.39% / 28.17% / 33.33% janky（p50 16/38/42ms，宿主 load 10–21），
  随宿主负载大幅波动；真机 Release 帧率留给后续阶段。

## 验收证据要求

平台交互类改动必须同时给出：

1. **Android 侧**：真机或模拟器实测结果，标注设备型号、Android 版本、构建类型（Debug/Release）
2. **iOS 侧**：确认既有行为未变的结论（抽查或全量，说明范围）
3. 不通过单测结论替代真机验证

### 一次性验收（Android 交互 / 渲染类改动）

一次改完、一次验收：不接受「改一项 → 起一次模拟器 → 截一轮图」的反复验收。

1. **先改完**：本任务的全部改动（含已发现的缺陷）先落到工作区，中途只跑与改动直接相关的单测 / 单文件检查。
2. **一次构建安装**：只启动一次模拟器、只跑一次完整构建与安装；期间不再改代码、不再重启模拟器。
3. **一轮取证**：用一个脚本一次覆盖全部验收项（全部页面 × 浅深两套 × 内存前后台序列），产物一次性落进任务 research 目录。
4. **一轮出结论**：只有「脚本自身缺陷」或「验收项本身写错」才允许重跑，并在结论里写明重跑原因。

新发现的平台约束写回本文件；本文件是 `apps/mobile` 平台差异的唯一权威清单。
