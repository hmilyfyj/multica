# FEATURE-549 Android 视觉校准实测记录

设备：Android 模拟器 `Medium_Phone_API_35`（Android 15，1080×2400 @420dpi），**Debug** 构建。
基线 `origin/main` @ `8e94b5dad`，工作树 `feature/549-android-visual-calibration`。
截图：`screens-baseline/`（改动前）与 `screens-final/`（改动后，含启动屏与桌面图标）。
脚本：`capture-visual.sh`（批量）、`cap-one.sh`（单张）。

## 1. 图标：`sf:` SF Symbol 在 Android 上空白

**改动前**：底部 tab bar 只有四个文字标签，图标位置留空（`screens-baseline/light-inbox.png`）。

logcat 直接给出原因：

```text
E ExpoImage: java.lang.IllegalArgumentException(Expected URL scheme 'http' or 'https' but was 'sf')
E GlideExecutor: java.lang.IllegalArgumentException: Expected URL scheme 'http' or 'https' but was 'sf'
    at okhttp3.HttpUrl$Builder.parse$okhttp(HttpUrl.kt:1254)
```

`expo-image` 的 Android 侧把 `sf:` 当 URL 交给 Glide，失败后什么都不画、也不抛到 JS。

**改动后**：`screens-final/light-inbox.png`、`dark-inbox.png`、`dark-my-issues.png` 等
四宫格图标齐全，选中态（Inbox 实心 tray、My Issues 实心 checkbox）与未选中态（outline）都正确。

覆盖的 7 个调用点：tab bar ×4、More 下拉菜单图标 ×3、More 下拉 chevron ×2、
switch-workspace 的 checkmark ×1（共 3 个文件）。

## 2. 启动屏

**改动前**（prebuild 生成物实测）：

| 资源 | 值 |
|---|---|
| `res/values/colors.xml` → `splashscreen_background` | `#FFFFFF` |
| `res/values-night/` | 空目录（无 night 覆盖 → 深色模式启动闪白） |
| `res/drawable-*/splashscreen_logo.png` | Expo 自带占位图形（浅灰网格），不是品牌 mark |
| `Theme.App.SplashScreen` | 只设 `android:windowBackground`，**没有** Android 12+ 的 `windowSplashScreen*` |

**改动后**（`screens-final/launch-splash.png` 冷启动实帧）：

- 背景 `(17,24,39)` = `#111827`，中央 `(255,255,255)` = 白色 mark —— 与桌面图标同一视觉。
- 生成物核对：`styles.xml` 的 `Theme.App.SplashScreen` 父主题变为 `Theme.SplashScreen`，带
  `windowSplashScreenBackground` / `windowSplashScreenAnimatedIcon` / `postSplashScreenTheme`；
  `colors.xml` 的 `splashscreen_background` = `#111827`；
  `MainActivity.kt` 出现 `SplashScreenManager.registerOnActivity(this)`。

**桌面图标**：`screens-final/launcher-home.png` + `launcher-icon-zoom.png` —— 白色 mark 压在
`#111827` 上，被 launcher 圆形遮罩裁切后 mark 完整、无裁边。

**`SplashScreenManager` 的 `ClassNotFoundException`**：来源是 `expo-dev-launcher` 的
`DevLauncherController.kt` 里 `Class.forName(...)` 被 `try/catch` 包住后 `Log.e`，Debug 专有、不崩溃。
装上 `expo-splash-screen` 后消失（改动后冷启动 logcat 已无该行）。

## 3. 逐项差异结论

| 项 | 实测结论 | 处置 |
|---|---|---|
| 字体栈 | 项目没有设置任何正文 `fontFamily`；React Navigation 的 header 字体已由上游 `Platform.select({ ios: fonts.bold, default: fonts.medium })` 分派 | 不改 |
| 字重 | Android 上「带 `fontFamily` 时 500/600 塌成 400」属实，但现有两处 `fontFamily` 都不受影响（一处无调用方、一处无字重类） | 记录约束 |
| 行高 | markdown 路径已显式给全；其余文本的两端差异来自系统字体本身（Noto Sans CJK vs PingFang SC） | 接受 |
| 深浅色令牌 | `global.css` / `lib/theme.ts` 的变量无平台语义，浅深两套截图逐页比对无偏差项 | 不改 |
| 系统栏 | 状态栏与手势条配色深浅两套都正确（`screens-final/` 全部截图） | 不改 |
| 圆角 | `borderCurve: "continuous"` 是 iOS 专有，Android 静默忽略 | 接受 |
| 阴影 | Android 只认 `elevation`；NativeWind 已把 `shadow-*` 编译成 elevation | 接受 |
| 分割线 | 全仓 `h-px` = 1dp，两端一致 | 接受 |
| 水波纹 | 全仓 0 处 `android_ripple`；RNR 上游与 iOS 同样不带 —— 属跨平台一致的设计缺口 | 不引入平台分支 |
| SegmentedControl | 该依赖已无任何调用方，UI 由 RNR 风格 pill 组承担 | 记录 |

## 4. 环境侧发现（非本任务改动引入）

- **自托管后端镜像滞后**：`ghcr.io/multica-ai/multica-backend:latest` 跑的是 2026-07-30 构建，
  缺 `GET /api/issue-statuses`（实测 136 次 404、0 次 200），会让 `My Issues` / 收件箱行落到
  重试循环并最终触发 React 的 `Maximum update depth exceeded` 覆盖层。
  `docker pull` 到 2026-09-15 构建后该接口恢复 200。
- 该镜像仍缺 `POST /api/auth/refresh`（客户端 `data/api.ts` 会调），日志为
  `[auth] session renewal deferred`，会话不续期 → 长时间调试后会退回登录页。
- 截图自动化记录在 `capture-visual.sh` / `cap-one.sh` 的注释里：深链不顶 modal、不能用
  `force-stop` 重启、主题要走应用内 Settings → APPEARANCE（`cmd uimode night` 不可靠）。
