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
pnpm android:mobile:dist:prod        # 签名 Release APK → apps/mobile/dist/android/（不安装、不需要设备）
pnpm android:mobile:dist:prod:aab    # 同上，AAB（Play 上传格式）
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

## 构建、签名与分发（FEATURE-552 实测，基线 commit `5d5219b33`）

产物落在 `apps/mobile/dist/android/multica-mobile-{dev,staging,production}-<version>-vc<versionCode>.{apk,aab}`（`dist/` 已 gitignore）。
实测（M1 Max）：冷构建 `assembleRelease` 7 分 11 秒 / 1074 个 task，production APK 106MB（四套 ABI）；
紧随其后的 `bundleRelease` 29 秒（66 executed / 922 up-to-date），AAB 72MB。原始证据见任务 `research/`。

- **签名密钥在仓库之外**：默认 `~/.multica-android/{keystore.properties,multica-release.keystore}`，均 `chmod 600`；
  `MULTICA_ANDROID_KEYSTORE_PROPERTIES` 指向团队已有密钥。根 `.gitignore` 有 `*.keystore` / `*.jks` /
  `keystore.properties` 兜底，已跟踪文件里没有任何密钥材料。
- **签名配置由 config plugin 在 prebuild 时追加**到 `android/app/build.gradle` 末尾，不做模板文本锚点替换：
  Gradle 的 `android { }` 可以重复打开、后写覆盖，所以模板升级不会让注入静默失配（失配的表现是
  「release 又用 debug 密钥签名」，最难发现的一类）。追加前会删掉上一次的标记块，重跑 prebuild 只有一块。
- **plugin 宽容、分发脚本严格**：`expo prebuild` 是变体无关的，plugin 每次 prebuild 都跑（含 Debug），
  所以缺密钥时只打警告并退回模板的 debug 签名；`scripts/android-release.sh` 是产出分发物的一侧，缺密钥直接退出。
- **产物名取自 `expo config`**（与 prebuild 写入 Gradle 的是同一份配置），不是 package.json 的字面量，
  所以文件名不可能与包内实际 package / versionCode 漂移。
- **三种 APP_ENV 包名互不相同**（`…mall.dev` / `…mall.staging` / `…mall`），可同机共存；
  production 可用 `EXPO_ANDROID_PACKAGE_PROD` 覆盖，dev / staging 不可覆盖。
- **`versionCode` 是字面量、不派生自 `version`**：发布新的分发版本时手工 +1；同一包名不能复用已用过的
  `versionCode`（Play 拒收、侧载拒绝降级）。
- **Release 保留四套 ABI**（只有 Debug 收敛），所以一个 APK 能装到任何手机／模拟器。
- 完整流程、密钥归属与备份、EAS / CI 接入结论见 `apps/mobile/docs/android-distribution.md`。

## 客户端身份上报与断网恢复预算（FEATURE-559 实测，基线 commit `e35fb0a5a`）

WS 升级 URL 上的 `client_platform` / `client_os` / `client_version` 是后端排障、统计与灰度的维度，
**必须来自运行平台，不能写死**：

- `client_os` 的取值集在服务端：`server/internal/handler/client_usage.go` 只认
  `macos | windows | linux | ios | android | chromeos`，其余归一成 `unknown`。
  `apps/mobile/data/realtime/ws-client.ts` 曾写死字面量 `"ios"`，于是 Android 设备在后端日志里
  （`websocket connected … client_platform=mobile client_version=0.1.0 client_os=ios`）全部记成 iOS，
  平台维度的统计、排障与灰度在 Android 上失真（FEATURE-551 §8.1 实测）。现由 `realtime-provider.tsx`
  传 `Platform.OS`（原生侧就是 `ios` / `android`）。**新增身份维度一律从平台取，不要写字面量。**
- 传输层 `data/realtime/ws-client.ts` **不 import `react-native`**：`apps/mobile/vitest.config.ts` 只跑
  Node 环境，RN 原生模块在该 lane 加载不了。平台相关的值由调用方注入（如 `clientOS`），
  这样这个文件在单测里可构造。

### 断网 / 切网恢复的实时同步预算（30s）

Android 上断开再恢复网络（飞行模式、Wi-Fi 切换、息屏回前台）后，**当前页面的数据必须在 30s 内自愈**，
不能靠退出重进。三条恢复路径及各自的时延：

1. NetInfo `offline → online` 边沿 → `ws.forceReconnect()`（最快，取决于系统是否上报连通性变化）；
2. 应用层心跳发现僵尸连接：最坏时延 = `HEARTBEAT_INTERVAL_MS` + `HEARTBEAT_TIMEOUT_MS`（现为 10s + 8s），
   之后按 full jitter 重拨（首次上限 2s）；
3. `onopen` 之后收不到 `auth_ack` 的握手看门狗（`AUTH_TIMEOUT_MS`，10s）。**没有它时「OPEN 但未认证」的连接
   既无定时器也不会 `onclose`**，客户端永不重连，页面数据只能靠重挂载更新。

重连通知（`ws.onReconnect`）是各 feature 刷新自有缓存的唯一入口（`apps/mobile/AGENTS.md` 禁止全局 refetch sweep），
所以**任何让连接恢复变慢或不恢复的改动都要重跑断网用例**：复现步骤与判据见
`apps/mobile/docs/android-regression-checklist.md` §7.1。

## Release 构建与本地验收后端（FEATURE-558 实测，基线 commit `3fd34cc21`）

**Android 9+ 默认禁止明文 HTTP**，而本地验收后端是 `http://10.0.2.2:8090`（模拟器经 `10.0.2.2`
访问宿主机）：

- `android/app/src/debug/AndroidManifest.xml` 的 `usesCleartextTraffic="true"` **只作用于 debug
  构建类型**；Release 变体没有这层，应用的 `fetch` 到不了宿主机。
- 实测症状（2026-09-19，staging Release + 本地后端）：登录页点 `Send code` 后停在原页，
  `logcat` 只有 `[api] → POST /auth/send-code`、没有响应行，**后端 `auth/send-code` 命中 0 次**；
  `aapt2 dump xmltree --file AndroidManifest.xml <apk>` 确认 Release APK 的 manifest 里没有
  `usesCleartextTraffic`（Debug APK 有）。
- 处理：`app.config.ts` 的 `expo-build-properties` 按变体给值 —— 非生产构建
  `usesCleartextTraffic: !isProd`，生产包保持平台默认（HTTPS-only）。
  **新增明文后端、换网络栈或改 targetSdk 时要一并复核这一项。**
- 纪律：验收跑 Release 包时，构建必须把 API 指到本地
  （`EXPO_PUBLIC_API_URL=http://10.0.2.2:8090`），并在 `env.txt` 里记录构建类型 ——
  顺带把「内嵌 JS、不连 Metro」这条也覆盖了。

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

#### 跑法分层（FEATURE-558 实测，2026-09-19）

完整矩阵单设备下限 ~40 分钟（实测单条中位 ~40s、单次取树 2.3s、盲等合计 483s），不适合每次
改动都跑。**因此分成两层，只有 Tier 1 可以随手跑**：

- **Tier 1 冒烟（< 5 分钟）**：8 条，覆盖 Android 差异面与最高风险路径（收件箱、详情+chip、
  picker→BACK 返回、评论框键盘避让、edge-to-edge、聊天完成、`client_os` 上报、启动屏）。
  入口 `research/smoke558.sh`；冷态实测 294s，配 AVD 快照（`research/snapshot558.sh save|load`，
  复用「已装包 + 已登录」态）后省掉 boot 与登录的 1~2 分钟固定开销。
- **Tier 2 完整矩阵（~40 分钟）**：`research/chunked558.sh`，**须取得用户明确授权才跑**，
  每阶段一次。
- **单条重查**：`ACCEPT_GROUPS=c5,c6 …` 只跑指定小节，1~10 分钟。

两条纪律：冒烟集只是 Tier 2 的**子集**（判据实现只有一处，禁止为过而放宽）；能落到库侧 /
后端日志断言的判据（任务终态、`client_os`、断网恢复时延）一律不点界面 —— 这是冒烟能压进
5 分钟的根本原因，也让结论更硬。

#### 驱动侧两个必须知道的坑（FEATURE-558 实测）

- **`uiautomator dump` 会在「界面永不 idle」的页面上挂死**：聊天页的 pill 在动画时实测卡住
  11 分钟，本地 adb 与整轮验收一起僵住。`lib558.sh` 的 `_dump_bounded` 给每次尝试 5s 上限 +
  重试；上限别调大（动画页会次次等满，反而放大总时长）。
- **Release 变体默认禁明文 HTTP**：本地验收后端是 `http://10.0.2.2:8090`，Debug 靠
  `src/debug/AndroidManifest.xml` 放行，Release 没有这层 —— 见上文「Release 构建与本地验收后端」。

## 本机通知（方案 A，FEATURE-562，基线 commit `3fd34cc21`）

Android 的「本机通知」是客户端自产自销：`inbox:new` WS 帧到达后由 App 进程直接弹系统横幅
（`apps/mobile/lib/local-notifications.ts`），点横幅回到对应 issue 或收件箱条目。**没有推送通道**：

- App 被划掉、被系统回收或长时间后台被清理后，**收不到任何通知**。这不是缺陷，是方案 A 的边界；
  重新打开 App 后会补拉收件箱列表与未读汇总，所以不会丢数据，只是没有即时提醒。
- 与「锁屏推送」不是一回事。要让进程死亡后也能收，需要 FCM + 设备 token 注册 + 后端发送侧改造
  （已评估，暂不做）；现有实现不假装支持。

实现要点（扩展时照此，不要另起一套）：

- 触发点只有一处：`data/realtime/use-inbox-realtime.ts` 的 `inbox:new` 分支，且 `Platform.OS === "android"`
  才走通知。载荷在 `data/realtime/inbox-notification.ts` + `lib/local-notifications.ts` 里构建，
  与共享层 `packages/core/platform/system-notification.ts` 的 `slug / itemId / issueId / title / body` 对齐；
  标题复用 `getInboxDisplayTitle`（收件箱行与详情 sheet 用的同一份文案），不新写文案逻辑。
- 通知渠道：Android 8+ 必须在 bootstrap 建 channel（`INBOX_NOTIFICATION_CHANNEL_ID = "inbox"`，
  重要性 HIGH 才有横幅）。渠道缺失时 expo-notifications 会回退到自带 channel，不会丢通知。
- 前台横幅：`setNotificationHandler` 必须返回 `shouldPlaySound: true`——库文档明确
  `shouldPlaySound: false` 会让 Android 的 drop-down 横幅不显示，与 channel 重要性无关。
- 权限（Android 13+ `POST_NOTIFICATIONS`）：**不在冷启动申请**，入口只有
  `设置 → 通知 → On this device`；被拒后 Android 不再弹窗，该行按钮改为引导到系统设置页。
  未授权时其它功能照常，只是不弹横幅；也不重复骚扰。
- 通知标识用收件箱行 id（即 Android 的通知 tag），同一条目重复到达会覆盖而不是堆叠。
- 单测不得加载 RN 原生模块：被单测覆盖的模块（`lib/local-notifications.ts`、
  `data/realtime/inbox-notification.ts`）不 import `react-native`，平台判断放在 RN 侧调用点；
  测试用 `vi.mock("expo-notifications")` 断言真实链路。
- iOS 完全不参与：Android 之外不注册 handler、不建 channel、不订阅点击，也不新增 iOS 权限文案。

### 真机缺陷与自诊断（FEATURE-562b，小米澎湃 OS 3 实测）

首版（vc1）在小米澎湃 OS 3 上实测「一条通知都没有」。代码链路本身无误——已核对 APK 的 dex 里确实打进了
`expo-notifications` 原生模块，且 `channelId` 触发在 `ExpoSchedulingDelegate.scheduleNotification` 里就是立即展示路径；
失败点在手机侧三处**从 App 内部看不见**的状态，所以这一轮补的是自诊断而不是改链路：

- **权限 / 应用级开关**：Android 13+ 未授权时投递会被系统静默丢弃。更隐蔽的是**应用级通知总开关**（澎湃/MIUI 的「通知管理」）关闭时，
  `expo-notifications` 的 `getPermissionsAsync()` 同样返回 `denied`（`NotificationPermissionsModule.kt`：
  `!areNotificationsEnabled()` → DENIED），而 `canAskAgain` 仍为 true —— 只按 `canAskAgain` 决定按钮文案，
  会把用户带进「点了没反应」的死路。按钮映射改为：未授权且还能弹 → Turn on；请求后仍未授权 → 换成 Open settings 并给出说明。
- **渠道被单独关掉**：用户可以在系统里只关 `inbox` 渠道，之后投递到该渠道的横幅全部被丢弃且无任何提示。
  设置页用 `getNotificationChannelAsync` 判断 `importance === NONE` 发现它，并引导到系统设置。
- **进程被冻结**：澎湃/MIUI 对后台缓存进程的冻结比 AOSP 激进，WS 可能在用户没划掉 App 的情况下断开——方案 A 的「App 存活」前提
  在国产 ROM 上还需要用户允许自启动/后台运行。这是方案 A 的固有边界，不是缺陷，但交付说明里必须写清。
- **申请时机**：只留设置页入口时，用户装完就可能再也见不到申请入口 → 现在**首次进入收件箱时一次性申请**
  （`lib/inbox-notification-prompt.ts`，SecureStore 记录「已问过」，已授权则不申请；Android 自身也只会弹一次）。
- **可观测性（必须保留）**：`lib/local-notifications.ts` 记录最近一次尝试（`shown` / `skipped-permission` /
  `skipped-muted` / `failed`），设置页把它翻译成人话，并提供「Send a test notification」——与真实事件走完全相同的调用。
  于是「事件根本没到」「被 gate 拦住」「到了但手机丢掉了」三种情况能当场区分，不用接电脑看 logcat。
  新增任何「静默不弹」的分支时，都要同时记录一种 outcome，否则又回到无法诊断的状态。

### 后台收不到通知：WS 被主动 pause（FEATURE-562c，真机实测定位）

真机实测「前台正常、后台收不到、App 没有被杀掉」。原因不在通知链路，而在**实时层的生命周期**：
`data/realtime/realtime-provider.tsx` 在 `AppState === "background"` 时调用 `ws.pause()`
（`WSClient.pause()` 会 `teardownSocket()` 并清掉心跳）。这段逻辑当年是为 iOS 写的
（「iOS 反正会杀后台 socket，干净关闭避免 resume 时的内核级 reset」），当时 App 没有通知功能，暂停没有任何代价。

FEATURE-562 让这件事变成缺陷：本机通知的**唯一**事件源就是这条 WS 的 `inbox:new` 帧，
所以「切后台 → 停 socket」等于「切后台 → 通知功能关闭」。

约定（已落地）：

- **Android 不在后台暂停 socket**；iOS 保持原行为（`Platform.OS !== "android"` 才 pause）。
  代价是后台仍在跑 socket + 10s 心跳，这是方案 A 换取后台横幅的代价，属于明确接受项。
- 前台恢复时照旧 `resume()` + `forceReconnect()`：进程若被冻结，socket 可能已死，
  立刻重建比等心跳超时（最坏 ~18s）更稳。
- **不要**为了省电在 Android 后台暂停 WS，除非同时把「后台通知」从需求里去掉；
  这两件事在本架构下互斥。改这一段前后都要真机验证后台横幅（前台正常不能作为通过依据）。
- 这仍不解决**进程被冻结/回收**的情况：澎湃/MIUI 等 ROM 冻结缓存进程后帧不会到达，
  那是方案 A 的固有边界（要彻底解决需要 FCM + 后端改造）。

#### 「事件没到」与「手机丢了」必须能分开（FEATURE-562d）

后台问题的排查在真机上反复卡在同一处：用户只能报「没通知」，而这两种原因的处理完全不同 ——

- 事件根本没到（进程被冻结 / socket 断了）：方案 A 的边界，只能靠允许后台运行或上 FCM；
- 事件到了但手机丢弃（渠道被关 / 应用级开关）：改系统设置即可。

所以设置页「On this device」除了最近一次**通知尝试**，还要显示**最近一次收到实时数据的时间**
（`lib/ws-activity.ts`，由 `realtime-provider` 用 `ws.onAny` 记录），以及**当前安装的构建号**
（`Constants.nativeAppVersion` / `nativeBuildVersion`）。判据：
后台待几分钟再回设置页，若「Last realtime data」停在切后台那一刻之前 → 进程被冻结；
若刚刚还在更新 → 事件到了，问题在通知侧。
装包是否真的换新也由构建号一行回答，避免再出现「测的是哪个包」的扯皮。

#### 冻结 vs 静默：后台会话取证（FEATURE-562e）

真机结论（澎湃 OS）：**省电策略设为「无限制」也不会阻止系统冻结后台进程**。Android 冻结的是 *cached* 状态
的进程（cgroup freezer），这与省电策略、Doze 不是同一个开关；进程被冻结时内存全在、回前台秒恢复，
所以「App 没有被杀掉」**不能**推出「App 在后台有运行」。这一点在真机排查中被反复误判，写进约定：

- 任何「后台收不到」的排查，先用 `lib/background-forensics.ts` 的三个读数区分机制，不要凭现象猜：
  - **JS 心跳为 0** → 进程被冻结（方案 A 边界）→ 只能上前台服务或推送通道；
  - **JS 有心跳、frames 为 0** → 进程在跑但数据没到 → 查连接（socket/服务器）；
  - **HTTP 探针也全失败** → 后台网络被 ROM 掐断（澎湃的联网限制是独立开关）。
- 设置页「On this device」直接给出结论行：`Background 12m · JS ran 48× · frames 0 · probe 12/12 ok → …`。
  新增「后台不弹」相关分支时，必须让这里能区分机制，否则又变成无法定位。
- 前台/后台的 AppState 边界只在这里记录会话（`setAppBackgrounded`），`_layout.tsx` 负责两个常驻定时器
  （15s JS 心跳、60s 后台 HTTP 探针），`realtime-provider` 负责帧计数。
- 已知结论：**普通应用在 Android 上做不到「后台持续收事件」**。要么前台服务（常驻通知换取不被冻结），
  要么厂商/聚合推送（杀进程也能收，需外部账号），要么接受方案 A 的边界。

## 设置面板补齐（FEATURE-566，基线 commit `06197ea41`）

### `SegmentedControl` 在 Android 上必须显式传 `appearance`

`@react-native-segmented-control/segmented-control` 按平台解析实现：
iOS 走 `js/SegmentedControl.ios.js`（原生 `UISegmentedControl`），Android / web 走
`js/SegmentedControl.js`（纯 JS 复刻）。JS 实现内部取的是 **React Native 的 `useColorScheme()`**
（`js/SegmentedControl.js:43` 的 `appearance || colorSchemeHook`）——即**系统**深浅色，
而不是本 App 通过 `lib/use-color-scheme.ts` 持久化的主题偏好。系统浅色而 App 内选深色时，
控件会停在浅色。iOS 的原生实现跟随系统外观、不吃这个 prop。

约定：**Android 传 `appearance={colorScheme}`（App 自己的偏好），iOS 传 `undefined`**。
已落地在 `app/(app)/[workspace]/more/settings/labels.tsx`的 scope 切换上。

⚠ 同一库的 `SegmentsSeparators` 不接收 `appearance`、仍用 RN 的 `useColorScheme()`
（`js/SegmentsSeparators.js:20`），所以深色模式下**段间分割线仍跟随系统**。这是库自身的不一致，
本仓库修不掉；真机验收时不要把这条色差判成主题失效。

### 设置面板的写权限与后端一致

`PATCH /api/workspaces/{id}` 与全部 `/api/issue-statuses` 写操作在 `server/cmd/server/router.go`
里挂在 **owner|admin** 组，`/api/labels` 的增删改只要求工作区成员身份。移动端按同一规则
门禁控件（`memberListOptions` + `user.id` 比对 role），不要用「失败了再提示」代替前端门禁。

## 时间线 deep-link 落点（FEATURE-571，基线 commit `26c8192e3`）

收件箱通知带的是 comment id，点进来必须落到该评论/回复的起始位置。这里有三条容易踩的约束：

- **一行 ≠ 一条评论**：移动端时间线一行是一个线程根，整条回复链内嵌在同一个气泡里
  （`lib/timeline-thread.ts` 的 `buildTimelineRows`）。所以「回复在屏幕上的位置」**不是行下标能表达的**，
  也不能照抄 web 的 `#comment-<id>` —— web 是递归树 + 每条评论一个节点。
- **落点必须两段式**（`lib/comment-landing.ts` 的 `resolveCommentLanding` + `startLanding`）：
  `scrollToIndex(row, viewPosition: 0)` 只能把「行」放到视口顶（回复可能在这行下方一两屏），
  再用 `measureInWindow` 量锚点的窗口 y，把残差转成 scroll offset 迭代修正；跳转后 Shiki/图片/
  markdown 仍在改行高，同一回路负责收敛。iOS/Android 同构，**不做平台分支**。
- **FlashList v2 的 offset 有两个坐标系**：`scrollToOffset({ skipFirstItemOffset: true })` 的参数
  == `getAbsoluteLastScrollOffset()` == 原生 contentOffset；**不传 `skipFirstItemOffset` 会再加一次
  `firstItemOffset`（即 ListHeader 高度）**，两者混用会整天偏一个表头高。落点回路全程用原生偏移。

纪律与边界：

- 落点逻辑**不得 import `react-native`**：`apps/mobile/vitest.config.ts` 的 Node lane 只收 `lib/**`、`data/**`，
  所以列表与视图以结构化接口（`LandingList` / `Measurable`）注入，`FlashListRef` 与 `View` 天然满足。
- 锚点始终不可测时（例如折叠的已解决线程）由帧预算兜底停手，不空转；用户一开始拖动立即 cancel。
- 已知边界：回复位于根评论气泡底部约 7 屏以外时，探测上限内找不到就停在行顶（仍优于旧的「落到底部」）。
  真机上遇到长线程深度回复需要复核这一条。
