# FEATURE-549 设计：Android 视觉校准

## 决策总览

| # | 差异点 | 决策 | 理由 |
|---|---|---|---|
| A | `sf:` SF Symbol 图标在 Android 空白 | **改**：新增 `components/ui/nav-icon.tsx` 集中封装，iOS 仍走 `expo-image` 的 `sf:`，Android 走 Ionicons | 7 处调用点分散在 3 个文件，按平台差异原则「同一类差异只实现一处」必须收敛；Ionicons 是项目两端都在用的既有图标体系 |
| B | 启动屏是 prebuild 兜底产物 | **改**：加 `expo-splash-screen` 依赖 + `app.config.ts` 插件配置 | 现状是 Expo 占位图形 + 深色闪白 + 无 Android 12+ 配置，属于「不是同一个产品」最直接的证据 |
| C | `SplashScreenManager` CNFE | **随 B 一并消失** | 根因就是包不存在；不单独打补丁 |
| D | `NAV_THEME` 的字体 | **不改** | `@react-navigation/elements` 已 `Platform.select({ ios: fonts.bold, default: fonts.medium })`，覆盖反而破坏上游平台分派 |
| E | `fontFamily` + 数值字重塌成 400 | **不改代码**，写进 spec | 现有 `fontFamily` 只有两处，一处无调用方、一处无字重类；改是给不存在的问题写代码 |
| F | 未显式 lineHeight 时中文行高两端不同 | **不改**：markdown 路径已显式给足 lineHeight，其余属平台字体本身 | issue 明确要求「不为像 iOS 堆无效覆盖」；全站补平台行高会引入 61 个文件量级的改动且收益不可验证（本机无 iOS runtime 可对照） |
| G-圆角 | `borderCurve: "continuous"` iOS 专有 | **接受** | Android 无 squircle 原生能力，16 处引入平台分支只会增加噪音 |
| G-阴影 | `elevation` 语义 | **接受现状**，spec 记录正确范本 | NativeWind 在 Android 构建期已把 `shadow-*` 转成 `-rn-elevation`，RNR 组件仍有 elevation；`timeline-list.tsx:546` 是显式写法范本 |
| G-分割线 | `h-px` = 1dp | **接受** | 两端同为 1dp，改 Android 成 hairline 反而制造差异 |
| G-水波纹 | 全仓无 ripple | **不引入**，列清单留后续 | 这是跨平台一致的设计缺口（RNR 上游与 iOS 也无反馈），不是 Android 移植差异 |
| H | SegmentedControl | **确认无渲染实例**；依赖成死重量 | 该 UI 已被 RNR 风格 pill 组替换 |

## A. 图标封装的设计

### 形态

`components/ui/nav-icon.tsx` 导出 `NavIcon({ sf, ion, color, size })`：

```tsx
if (Platform.OS === "ios") {
  return <ExpoImage source={`sf:${sf}`} tintColor={color} style={{ width: size, height: size }} />;
}
return <Ionicons name={ion} size={size} color={color} />;
```

### 为什么用两个显式名字（`sf` + `ion`）而不是一张映射表

- SF Symbols 与 Ionicons 没有共同的命名规则，且 SF 的 `.fill` 变体在 Ionicons 里
  拼写完全不同（`tray.fill` → `file-tray`，不是 `file-tray.fill`）。
- 一张「语义 key → 两套名字」的表会在只有 tab bar 需要 `focused` 双态时逼出额外参数
  （`filled?: boolean`），把 tab bar 的语义泄漏到共享组件里。
- 两个显式 prop 让每个调用点自己写清楚「这一处的 iOS 图标是 X、Android 是 Y」，
  7 处各一行，评审时可直接比对。

### 为什么 iOS 分支保留 `sf:` 而不统一成 Ionicons

`.trellis/spec/mobile/frontend/android-platform.md` 的「平台差异原则」第 2 条：
**不改 iOS 既有行为，Android 适配以新增平台分支的方式实现**。统一图标集会让 iOS 视觉发生变化，
超出本任务授权范围。

### 图标对照（Ionicons 名字均已用 `@expo/vector-icons@14.1.0` 的 glyphmap 校验存在）

| 位置 | iOS SF Symbol | Android Ionicons |
|---|---|---|
| Inbox tab（选中 / 未选中） | `tray.fill` / `tray` | `file-tray` / `file-tray-outline` |
| My Issues tab | `checklist` / `checklist.unchecked` | `checkbox` / `checkbox-outline` |
| Chat tab | `bubble.left.fill` / `bubble.left` | `chatbubble` / `chatbubble-outline` |
| More tab | `ellipsis` | `ellipsis-horizontal` |
| More 菜单 Pinned | `pin` | `pin-outline` |
| More 菜单 Issues | `list.bullet` | `list-outline` |
| More 菜单 Projects | `square.stack` | `albums-outline` |
| More 菜单 ×2 右向披露 | `chevron.right` | `chevron-forward` |
| switch-workspace 当前项 | `checkmark` | `checkmark` |

（`chevron-forward` 与 `checkmark` 是项目里已有的 Ionicons 选择，见
`more/settings.tsx:225` 与 `more/people` 系列行，保持一致。）

## B. 启动屏的设计

### 配置

```ts
[
  "expo-splash-screen",
  {
    image: "./assets/adaptive-icon.png",
    imageWidth: 200,
    resizeMode: "contain",
    backgroundColor: "#111827",
  },
],
```

### 参数取值理由

- **图像复用 `assets/adaptive-icon.png` 而不新增资产**：它就是 `icon.png`（白 mark 压在 `#111827`）
  抠出来的白 mark 透明底版本，`app.config.ts` 的 `adaptiveIcon.foregroundImage` 已在用它。
  同一个资产同时充当 launcher 前景与启动屏 logo，避免出现「启动屏 mark 和桌面图标 mark 不是一个文件」
  的漂移。alpha bbox 为 `(243,243,781,781)`：mark 占 1024 画布的 **52.5%**，居中。
- **`imageWidth: 200`**：插件按 `size = imageWidth × densityMultiplier` 把 mark 画进 **288dp 画布**
  （`@expo/prebuild-config` 的 `withAndroidSplashImages.js:167-168`，`canvasSize = 288 × multiplier`）。
  200dp 里的 mark 实占 `200 × 0.525 ≈ 105dp`，落在 Android 12 必须保留的 192dp 安全区内，不会被圆形遮罩裁到。
- **`backgroundColor: "#111827"`**：与 `adaptiveIcon.backgroundColor` 和 `icon.png` 的底色**完全同值**，
  于是「点图标 → 启动屏 → 应用」三段的品牌底色连续，不会出现白底闪一下。
- **不写 `dark`**：浅色与深色用同一个品牌底色才叫「同一个产品」；且唯一可用的 mark 是**白色**，
  浅色底会把 mark 吃掉。省略 `dark` 时插件不生成 night 覆盖，`res/values-night/colors.xml` 保持空 —— 语义就是
  「不覆盖」。

### 生成物验收点（prebuild 后逐条核对）

- `Theme.App.SplashScreen` 的父主题从 `AppTheme` 变成 **`Theme.SplashScreen`**，并带齐
  `windowSplashScreenBackground` / `windowSplashScreenAnimatedIcon` / `postSplashScreenTheme` —— 这是
  Android 12+ 唯一被系统读取的一组属性。
- `colors.xml` 的 `splashscreen_background` 从 `#FFFFFF` 变成 `#111827`。
- `MainActivity.kt` 出现 `SplashScreenManager.registerOnActivity(this)`，且 `setTheme(R.style.AppTheme)`
  被插件注释掉（主题切换改由模块在 `postSplashScreenTheme` 之后接管）。

## C. 不改的项目：为什么（防过度适配）

- **`NAV_THEME` 字体**：见 prd D。上游已经做了平台分派；我们在 `lib/theme.ts` 里再包一层只会覆盖它。
- **全站补行高**：见 prd F。本机没有 iOS runtime，任何「对齐 iOS 行高」的说法都无法取证；
  按 issue 的硬约束，无证据的平台分支不做。
- **`global.css` 色彩变量**：全部是 HSL 纯颜色，NativeWind 在两端编译成同一套 RN 颜色值，
  没有平台语义。深浅截图逐页核对后无偏差项 → 不改（结论写回 spec）。
- **ripple**：见 prd G。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 新增原生依赖 `expo-splash-screen` 改动 MainActivity，可能影响启动 | prebuild 生成物逐条核对 + 冷启动实测；模块默认 `preventAutoHideCalled = false` 会自动隐藏（`SplashScreenManager.kt:23`），不需要 JS 侧调 `hideAsync` |
| `imageWidth` 换算后 mark 偏大/偏小 | 已按 288dp 画布反推（105dp）；真机/模拟器启动帧截图复核 |
| 改 `(tabs)/_layout.tsx` 可能与 FEATURE-548 冲突 | 只动 4 个 `tabBarIcon` 的渲染，不动布局与 inset；交付评论点名该文件 |
| iOS 无法本地取证 | 结构性论证：改动全部落在 `Platform.OS === "ios"` 之外的路径，iOS 分支与改动前逐字相同；在结论里明说本机无 iOS runtime |
