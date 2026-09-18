# FEATURE-549 Android 视觉校准：字体、图标、启动屏与深浅色

## Goal

让 `apps/mobile` 在 Android 上看起来是**同一个产品**而不是一个移植品：字体/字重/行高、图标与启动屏、
深浅两套主题下的系统栏与导航配色、以及 RNR 组件在两端默认值上的差异，逐条用实测证据判定
「必须改」还是「接受与 iOS 的差异并说明理由」。

终点是 **Android 模拟器（Medium_Phone_API_35 / Android 15）浅色 + 深色两套截图**，
覆盖收件箱、My Issues、聊天、项目、设置、issue 详情等主要页面；结论写回
`.trellis/spec/mobile/frontend/android-platform.md`。

## 环境与基线

- 基线：`origin/main` @ `8e94b5dad`（已含 542~547 的交付）
- 设备：Android 模拟器 `Medium_Phone_API_35`（Android 15，1080×2400 @420dpi）
- 后端：`COMPOSE_PROJECT_NAME=multica-probe542 docker compose -f docker-compose.selfhost.yml up -d postgres backend`
  （127.0.0.1:8090，模拟器经 `10.0.2.2:8090`；开发验证码固定 `888888`，账号 `probe542@example.com`）
- 构建：`JAVA_HOME=~/jdk21/jdk-21.0.12.1+1/Contents/Home`、`ANDROID_HOME=~/Library/Android/sdk`
- iOS 侧**无法本地取证**：本机 Xcode 26.4 已装但 **没有任何 iOS simulator runtime**
  （`xcrun simctl list runtimes` 为空）。因此 iOS 的结论一律是
  「按平台差异原则，iOS 路径保持原样，改动全部落在 Android 分支」的**结构性论证**，
  不是像素对照。这一点在交付评论里明确说明。

## Requirements（对应 issue 的 5 条）

1. **字体**：`lib/theme.ts`（`NAV_THEME`）与 `lib/markdown/markdown-style.ts` 的字体栈、字重、行高按平台校准。
2. **图标与启动屏**：adaptive icon 的前景/背景层；Android 12+ SplashScreen API 与启动屏行为。
3. **深浅色**：`global.css` 的 mobile 色彩变量 + `NAV_THEME`，重点是 React Navigation 的 header / tab bar / 系统栏配色。
4. **平台观感差异**：卡片圆角、阴影（Android 的 elevation 语义）、分割线、点击水波纹是否需要对齐 RNR 两端默认值。
5. **SegmentedControl**：依赖 `@react-native-segmented-control/segmented-control` 在 Android 上的实际渲染是否可接受。

三条硬约束（issue「注意」）：

- 视觉差异**只在确有必要时**引入平台分支，不为「像 iOS」堆无效覆盖。
- 不改动 web/desktop 侧样式。
- 逐条差异必须有实测截图，或明确说明「接受与 iOS 的差异及理由」。

## Verified Facts（2026-09-18 本轮实测 + 源码核对）

### A. `sf:` SF Symbol 图标在 Android 上是完全空白（必修）

- 调用点共 7 处：`app/(app)/[workspace]/(tabs)/_layout.tsx`
  4 个 tab 图标、`components/nav/more-tab-dropdown.tsx`（3 个 NAV_ITEMS 图标 + 2 个 `chevron.right`）、
  `app/(app)/[workspace]/switch-workspace.tsx`（1 个 `checkmark`）。
- `expo-image` 的 Android 实现不认 `sf:` 前缀，直接把字符串交给 Glide，抛异常且**不画任何东西**：

  ```text
  E ExpoImage: java.lang.IllegalArgumentException(Expected URL scheme 'http' or 'https' but was 'sf')
  E GlideExecutor: java.lang.IllegalArgumentException: Expected URL scheme 'http' or 'https' but was 'sf'
      at okhttp3.HttpUrl$Builder.parse$okhttp(HttpUrl.kt:1254)
  ```

- 实测后果：底部 tab bar 只有「Inbox / My Issues / Chat / More」四个文字，
  图标位置留空（`03-my-issues.png` 与 `light-my-issues.png` 同形）。
- 项目已有的图标体系是 `@expo/vector-icons` 的 Ionicons，**两端都在用**
  （`components/ui/icon-button.tsx`、`search-field.tsx`、`more/settings.tsx:225` 的 `chevron-forward`、
  `more/issues.tsx`、`inbox.tsx` 空态等）。tab bar 是唯一还在用 iOS 专有图标的角落。

### B. 启动屏是 prebuild 的兜底产物（必修）

- `apps/mobile/package.json` 里**没有** `expo-splash-screen`，`app.config.ts` 的 `plugins` 里也没有启动屏配置。
- 于是 prebuild 写出兜底资源（实测，改动前）：
  - `res/values/colors.xml`：`splashscreen_background = #FFFFFF`
  - `res/values-night/` 是**空目录**，没有 night 覆盖 → 深色模式启动闪白
  - `res/drawable-*/splashscreen_logo.png` 是 **Expo 自带的占位图形**（浅灰网格/圆点），品牌 mark 完全不出现
  - `Theme.App.SplashScreen` 只继承 `AppTheme` 并设 `android:windowBackground = @drawable/ic_launcher_background`
    （layer-list：`@color/splashscreen_background` + 居中 `splashscreen_logo`）——
    这是 Android 11 及以前的老写法，**没有** Android 12+ 的 `windowSplashScreenBackground` /
    `windowSplashScreenAnimatedIcon`。设备是 Android 15，实际走的是 Android 12+ SplashScreen API 路径。
- `res/mipmap-anydpi-v26/ic_launcher.xml` 与 `adaptiveIcon`（FEATURE-543 已交付）本身是对的：
  `background = @color/iconBackground (#111827)`、`foreground = @mipmap/ic_launcher_foreground`（白 mark 透明底）。
  桌面图标正常，问题只在启动屏。

### C. `SplashScreenManager` 的 `ClassNotFoundException` 根因（issue 点名的相邻问题）

- 报错来自 `expo-dev-launcher` 的 `DevLauncherController.kt:409-420`：

  ```kotlin
  try {
    val splashScreenManagerClass = Class.forName("expo.modules.splashscreen.SplashScreenManager")
    … splashScreenManagerClass.getMethod("hide").invoke(splashScreenManager)
  } catch (e: Throwable) {
    Log.e("DevLauncherController", "Failed to hide splash screen", e)
  }
  ```

- 是**反射 + 已捕获**，不崩溃；只在 Debug 构建（dev-launcher 只在 debug 里）出现。
- 根因就是「没有 `expo-splash-screen` 这个包」。安装该依赖后由
  `@expo/prebuild-config` 的 `withAndroidSplashMainActivity` 注入
  `SplashScreenManager.registerOnActivity(this)`，类存在，报错消失。

### D. React Navigation 的字体已经按平台分派，`NAV_THEME` 不需要改字体

- `@react-navigation/elements` 的 `Header/HeaderTitle.tsx:28`：

  ```tsx
  Platform.select({ ios: fonts.bold, default: fonts.medium })
  ```

  而 `@react-navigation/native` 的 `theming/fonts.js` 里
  iOS：`{ fontFamily: "System", fontWeight: "400/500/600/700" }`；
  Android（`default`）：`{ fontFamily: "sans-serif" | "sans-serif-medium" }`。
- `NAV_THEME` 用 `...DefaultTheme` 展开，只覆盖 `colors`，所以 `fonts` 本来就拿到正确的 Android 栈。
- 结论：**这一项无需改动**，改反而会覆盖掉上游正确的平台分派。

### E. Android 的数值字重：带 `fontFamily` 时 500/600 会塌成 400

- `ReactTypefaceUtils.kt:99-113`：无 `fontFamily` 时走 `TypefaceStyle.apply`（API ≥28 交给
  `Typeface.create(family, weight, italic)`，600 由系统字体匹配）；**带 `fontFamily`** 时走
  `ReactFontManager.getTypeface` 的 `nearestStyle`（`ReactFontManager.kt:67-73,138-153`），
  而 `TypefaceStyle.NORMAL = 400 / BOLD = 700`，于是 500、600 全部落到 NORMAL。
- 影响面已核实为**零**：项目里 `fontFamily` 只出现在 `font-mono`（Tailwind `mono`）两处 ——
  `components/ui/text.tsx:31` 的 `variant="code"`（**无任何调用方**）与
  `lib/markdown/tokens.ts:16` 的代码块（**没有 font-weight 类**，两端都是 400）。
- 结论：不改代码，把这条写进 spec 作为「以后别踩」的约束。

### F. 未显式 `lineHeight` 时，中文行高两端不同

- Android：`TextAttributeProps.kt:96,464` 的 `includeFontPadding` 默认 **true**（Fabric 同，`TextLayoutManager.kt:101`）；
  `lineHeight` 为 NaN 时不加 `CustomLineHeightSpan`，行高由 `StaticLayout` 按字体度量算，且
  `setUseLineSpacingFromFallbacks(true)`（API ≥28）会让 **CJK 回退字体**（Noto Sans CJK）的度量参与。
- iOS：无显式 lineHeight 时按字体的 ascender+descender 算，CJK 回退是 PingFang SC。
- 两侧字体不同 → 同一 `fontSize` 下中文行的实际高度不同、换行点不同。这是**平台字体本身**的差异，
  不是本项目写错了值。
- **markdown 渲染路径不受影响**：`markdown-style.ts` 对 paragraph 与 h1~h6 **全部显式给了 lineHeight**
  （`MD_LINE`），inline code 也显式给了 `fontSize`；`fontFamily` 故意不设，用平台系统 monospace。

### G. 圆角 / 阴影 / 分割线 / 水波纹的现状

| 项 | 现状（`文件:行号`） | 两端是否有真实差异 |
|---|---|---|
| 圆角 | `lib/radius-tokens.json` 的静态阶梯（xs3/sm4/md6/lg8/xl12/2xl16/3xl20/4xl24）被 `tailwind.config.js:10-14` 展开成 `borderRadius`；`components/ui/card.tsx` 用 `rounded-xl` | 数值体系两端一致；`lib/radius.ts` 的 `continuousCorners`（`borderCurve:"continuous"`）是 **iOS 专有**，8 文件 16 处使用，Android 静默忽略 → iOS 是连续曲线、Android 是普通圆角。Android 无 squircle 原生支持，**接受** |
| 阴影 | 全项目唯一 `elevation` 在 `components/issue/timeline-list.tsx:546`（与 `shadow*` 四件一起写，是正确范本）。RN 0.83 Android 只认 `elevation`（`shadowColor` 在 API ≥28 只作为染色）；`shadowOffset/Opacity/Radius` 静默丢弃；NativeWind 在 Android 构建期把 `shadow-sm/md/lg` 编译成 `-rn-elevation`（1/6/8），所以 RNR 组件上的 `shadow-sm shadow-black/5` 在 Android 仍有 elevation | 有语义差异但已有兜底；按钮/开关等取数一致 |
| 分割线 | 一律 `h-px` / `h-[1px]`（`components/ui/separator.tsx` 与各 `border-b`），= 1dp；`tailwind.config.js:81` 的 `borderWidth.hairline` 是**死配置，全仓 0 处使用** | 1dp 在两端都是 1dp，**一致**。Android 惯例的 hairline（0.33dp）不采用，与 iOS 保持一致 |
| 水波纹 | 全仓 **0 处** `android_ripple` / `androidRipple`，0 处 `Touchable*`；点击反馈只有 NativeWind 的 `active:` 一条路径 | **不是 Android 与 iOS 的差异**：RNR 上游与 `@rn-primitives` 两端都不带 ripple，iOS 无 `active:` 时同样零反馈。属跨平台一致的设计缺口，**不在本任务引入平台分支**（否则正是 issue 禁止的「无效覆盖」），已列清单留待后续统一处理 |

### H. SegmentedControl 已经不在任何渲染路径上

- 全仓（排除 `node_modules`）搜 `@react-native-segmented-control/segmented-control` 只有两处命中：
  `apps/mobile/package.json:35` 的依赖声明与 `docs/android-probe.md` 的历史表格。
- `apps/mobile/app/(app)/[workspace]/(tabs)/my-issues.tsx` 的 Assigned/Created/Agents 分段，
  现在由本地 `ScopeToolbar` 的 **RNR 风格 pill 组**渲染（同文件 228-241 行注释写明
  「Replaces the previous full-width segmented tabs」）。
- 结论：issue 第 5 条的前提已过期——没有可渲染的 SegmentedControl 实例。依赖成为死重量。

## 修改边界

本任务独占（其它阶段任务不得改）：

- `apps/mobile/lib/theme.ts`
- `apps/mobile/global.css`（mobile 段）
- `apps/mobile/app.config.ts`（启动屏 / 图标 / 系统栏相关）
- `apps/mobile/lib/markdown/markdown-style.ts` 的字体栈与行高部分

本任务新增/触及（与 548、550 不交叠）：

- `apps/mobile/components/ui/nav-icon.tsx`（新增，SF Symbol → Ionicons 的唯一封装点）
- `apps/mobile/app/(app)/[workspace]/(tabs)/_layout.tsx`（tab 图标）
- `apps/mobile/components/nav/more-tab-dropdown.tsx`（NAV_ITEMS 图标 + 两处 chevron）
- `apps/mobile/app/(app)/[workspace]/switch-workspace.tsx`（checkmark）
- `apps/mobile/package.json` + `pnpm-lock.yaml`（新增 `expo-splash-screen`）
- `.trellis/spec/mobile/frontend/android-platform.md`（结论回写）

明确不碰：web/desktop 侧任何样式；`lib/markdown/**` 的渲染逻辑（属 FEATURE-550）；
`KeyboardAvoidingView` 与安全区/状态栏调用点（属 FEATURE-548）。

`(tabs)/_layout.tsx` 与 `_layout.tsx` 的说明：FEATURE-548 的文件面是
`KeyboardAvoidingView` 调用点与页面安全区/状态栏，不包含 tab 图标；本任务只改 4 个 `tabBarIcon` 的渲染，
不改布局与 inset，交付时在评论里点名该文件，便于 548 对齐。

## Acceptance

1. 底部 tab bar 在 Android 上显示图标；More 下拉的 NAV_ITEMS 图标、两处 chevron、
   switch-workspace 的 checkmark 均正常渲染；iOS 侧路径逐字未变。
2. `res/values/colors.xml` 的 `splashscreen_background` 与 `Theme.App.SplashScreen` 走 Android 12+ 的
   SplashScreen API；启动时显示品牌 mark，深浅两套主题都不闪白；桌面 adaptive icon 正常。
3. Debug 构建冷启动 logcat 不再出现 `SplashScreenManager` 的 `ClassNotFoundException`。
4. 浅色 + 深色两套主题下，收件箱 / My Issues / 聊天 / 项目 / 设置 / issue 详情截图；
   无溢出、无文字被裁；状态栏与系统栏配色正确。
5. 字体、深浅色令牌、圆角/阴影/分割线/水波纹、SegmentedControl 五项各有明确结论
   （改了什么，或为什么接受），并附证据。
6. 结论写回 `.trellis/spec/mobile/frontend/android-platform.md`。
7. `pnpm check` 通过。

## Out of Scope（明确不做）

- 为未显式行高的全站文本补平台行高（见 F：这是字体本身差异，属「无效覆盖」）。
- 为 16 处「既无 `active:` 也无 ripple」的交互元素加 ripple（见 G：两端一致，非 Android 特有）。
- 升级或改写 `lib/markdown/**`（属 FEATURE-550）。
