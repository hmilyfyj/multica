# 全量回归驱动计划 · V / M / D / E 四组（只读侦察产出）

来源：`09-18-android-visual-calibration`（FEATURE-549）、`09-18-android-markdown-highlight`（FEATURE-550，**在 `multica.worktrees/FEATURE-550` 工作树**，FEATURE-551 树里没有这个目录）、
`09-18-android-formsheet`（FEATURE-547）、`09-18-android-picker-search`（FEATURE-546）、`09-18-android-input-keyboard-nav`（FEATURE-548）、
`.trellis/spec/mobile/frontend/android-platform.md`、`apps/mobile/**` 源码。

## 0. 全局口径（写脚本前先对齐）

| 项 | 值 | 出处 |
|---|---|---|
| 设备 | 模拟器 `Medium_Phone_API_35`，Android 15 / API 35，**1080×2400 @420dpi**，arm64-v8a | 549 / 550 实测记录首行 |
| 工作区 slug | `probe550` | 548/550 各脚本 `WS=${WS:-probe550}` |
| dev 包名 | `com.ehaier.zgq.shop.mall.dev` | `apps/mobile/app.config.ts`（FEATURE-557 起的品牌包名） |
| staging 包名 | `com.ehaier.zgq.shop.mall.staging` | 同上 |
| **注意** | 548/549/550 的历史脚本一律写死 `PKG=ai.multica.mobile.dev`（品牌化之前的包名）。本次跑之前先 `adb shell pm list packages | grep mall` 确认实际装的是哪个变体，再覆盖 `PKG`。本工作树 `apps/mobile/android/` 里的上一次 prebuild 产物是 **staging** 变体（`java/com/ehaier/zgq/shop/mall/staging/MainActivity.kt`） | 现场核对 |
| 深链 | `adb shell am start -n <PKG>/.MainActivity -a android.intent.action.VIEW -d "multica://probe550/<route>"` | 548 `lib.sh` 的 `goto()` |
| 深链必须带 `-n <PKG>/.MainActivity` | dev 与 staging 注册同一个 `multica` scheme，裸 VIEW intent 会弹系统 Open-with 选择器 | 547/549/550 脚本注释 |
| dev 构建的「冷启动」 | 裸 `am start -n .MainActivity` 会停在 expo-dev-client 的服务器列表页，必须用 `-d "exp+multica-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A<port>"` 拉起 | 550 `mem-seq.sh`/`release-proof.sh` 注释（实测踩过） |
| 点击定位 | `uiautomator dump` → 按 `text="…"` / `content-desc="…"` 取 `bounds` → 点中心。**不写死坐标** | 548 `lib.sh` |
| 应用内判定 | 无障碍树里出现 `text="My Issues"` + `text="More"` ⇒ 在 tab 根、没有 modal 压着 | 549 `capture-visual.sh` 的 `at_tab_root()` |
| 主题切换 | **不要用 `cmd uimode night`**（549 实测不可靠）。走 `more/settings` 里的 `Light` / `Dark` / `System` 行 | 549 `capture-visual.sh`、550 `set-theme.sh` 注释 |
| 主题复验 | 正文区中心像素亮度 `lum`：浅色 > 180、深色 < 80 | 550 `set-theme.sh` 的 `screen_lum()` 取 `(w/2, h*0.625)` |
| 深链不顶 modal | 上一次停在 sheet 路由时，下一次深链会被压在底下。每次换路由前先 `reset_to_tab_root`（tab 文案判据 + BACK 弹栈） | 549 `capture-visual.sh` 注释第 3 条 |

### 0.1 issue 路由的关键约束：**不能用裸编号**

`multica://probe550/issue/1` 会 404。服务端 `server/internal/handler/handler.go` 的解析顺序是
「先按 `PREFIX-NUMBER` 查（`resolveIssueByIdentifier` → `splitIdentifier`，要求存在 `-` 且右侧全数字），否则 `util.ParseUUID`」；
裸 `1` 两条都不匹配 → `writeError(404, "issue not found")`（handler.go:1048-1058）。
移动端 `data/queries/issues.ts:40` 把路由参数 `id` 原样拼进 `GET /api/issues/${id}`（`data/api.ts:679-688`）。

⇒ 驱动脚本里一律写 **identifier**（`PROB-1`）或 UUID，不写 `issue/1`。

### 0.2 probe550 的三个夹具 issue（550 用）

550 的脚本用 UUID 直连，脚本注释同时给出人类编号；三者的角色从脚本注释与 `ISSUE` 默认值可确定：

| 编号 | UUID | 是什么 | 出处 |
|---|---|---|---|
| `PROB-1` | `01a0b3a5-0bf0-7702-b33b-5c38dc6ded45` | **GFM 全覆盖语法矩阵夹具**（12 组语法，见 M 组） | `capture.sh` 的 `ISSUE=` 默认值；`capture-input.sh:26` 注释 `# /probe550/PROB-1` |
| `PROB-2` | `01a0b3a5-2c4c-770e-b13f-c0060d368b7e` | **长文档夹具**：24 段 × 2 代码块（25.6KB 描述），用于首屏与滚动 | `verify-all.sh` 的 `ISSUE_PERF=` |
| `PROB-3` | `c3be9531-19ad-403c-9944-ed33c6c67f05` | **12 语言代码块夹具**：把预注册的 12 种语言各渲染一次，撑起 pattern cache | `mem-seq.sh` / `release-proof.sh` 的 `ISSUE=` 默认值；`release-proof/marks.txt` 写的是 `open PROB-3 (12 langs)` |

> 编号（1/2/3）与 UUID 的对应关系来自上述脚本注释，**已在仓库文本里核实**；本次脚本建议直接用 UUID（对缓存/重命名免疫），
> 需要人眼可读时用 `issue/PROB-1` 这类 identifier 形式。

### 0.3 主题/路由复位的可复用原语（直接从 549/550 抄）

```bash
adb_() { "$ADB_BIN" -s "$SERIAL" "$@"; }
dump_ui() { adb_ shell uiautomator dump /sdcard/reg-ui.xml >/dev/null 2>&1; adb_ shell cat /sdcard/reg-ui.xml 2>/dev/null; }
in_tab_root() { dump_ui | grep -q 'text="My Issues"' && dump_ui | grep -q 'text="More"'; }
goto() { adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW -d "multica://$WS/$1" >/dev/null 2>&1; }
# tab 根判据 + BACK 弹栈，最多 6 次（549/550 同款）
reset_to_tab_root() {
  for i in 1 2 3 4 5 6; do
    if in_tab_root; then goto inbox; sleep 3; return 0; fi
    adb_ shell input keyevent KEYCODE_BACK; sleep 2
  done
  return 1
}
```

`tap_text` / `tap_desc` 用 548 `lib.sh` 的实现（`rg -F 'text="…"'` → 取 `bounds` → 点中心），
它同时提供 `ime_top()` / `focused_rect()` / `root_rect()` / `probe()`，E 组量键盘与系统栏时直接复用。

---

# V 组 · 视觉（FEATURE-549）

549 的设备与基线：模拟器 `Medium_Phone_API_35`（Android 15，1080×2400 @420dpi），**Debug** 构建，基线 `origin/main@8e94b5dad`，
工作树 `feature/549-android-visual-calibration`；截图 `screens-baseline/`（改动前）与 `screens-final/`（改动后）；
脚本 `capture-visual.sh`（批量）、`cap-one.sh`（单张）。

### V1 底部 tab bar 图标（4 个 tab，选中/未选中，浅深两套）

route: 任意 tab 根（`inbox` / `my-issues` / `chat` / `more`）

steps:
  1. `reset_to_tab_root`（确保停在 tab 根）
  2. `dump_ui`，断言四个标签文案都在：`text="Inbox"`、`text="My Issues"`、`text="Chat"`、`text="More"`
  3. `adb exec-out screencap -p > light-inbox.png`（浅色）
  4. `bash set-theme.sh Dark`（= 549 的 `set_theme Dark` + `confirm_theme Dark`）→ 再截 `dark-inbox.png`
  5. 依次 `goto my-issues` / `goto chat` 各截一张，覆盖选中态换位
expect: ① dump 里四个标签文案齐全；② 每张截图里，**每个标签正上方都有一枚可见图标**（改动前该区域是空白）：
Inbox 选中 `file-tray`（实心）/ 未选中 `file-tray-outline`，My Issues `checkbox` / `checkbox-outline`，Chat `chatbubble` / `chatbubble-outline`，More 恒为 `ellipsis-horizontal`。
量化判据：在标签上方约 20dp 的图标框内统计「与 tab bar 背景色不同的像素数」> 0（改动前 = 0）。
深浅两套都要成立（`tabBarActiveTintColor = THEME[scheme].foreground`、`tabBarInactiveTintColor = mutedForeground`）。

历史结论（原文）：
> **改动前**：底部 tab bar 只有四个文字标签，图标位置留空（`screens-baseline/light-inbox.png`）。
> **改动后**：`screens-final/light-inbox.png`、`dark-inbox.png`、`dark-my-issues.png` 等 四宫格图标齐全，选中态（Inbox 实心 tray、My Issues 实心 checkbox）与未选中态（outline）都正确。
> 覆盖的 7 个调用点：tab bar ×4、More 下拉菜单图标 ×3、More 下拉 chevron ×2、switch-workspace 的 checkmark ×1（共 3 个文件）。

根因（原文）：
> `E ExpoImage: java.lang.IllegalArgumentException(Expected URL scheme 'http' or 'https' but was 'sf')` …
> `expo-image` 的 Android 侧把 `sf:` 当 URL 交给 Glide，失败后什么都不画、也不抛到 JS。

收敛点：`components/ui/nav-icon.tsx` 的 `NavIcon({ sf, ion, color, size })`（iOS 逐字保留 `sf:`，其余平台 Ionicons）。
补充：V1 顺带覆盖 More 下拉（`tap_text "More"` → 菜单里 Pinned/Issues/Projects 三行各一枚图标 + 两个 `chevron-forward`）
与 `switch-workspace` 当前项的 `checkmark` —— 这三处是 549 同一改动的调用点，截一张即可。

### V2 启动屏与桌面图标

route: 无（冷启动 + launcher）

steps:
  1. `adb shell input keyevent KEYCODE_HOME` → `adb shell am force-stop "$PKG"` → `sleep 2`
  2. 拉起 dev-client（dev 构建必须走这条，见 §0）：`am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW -d "exp+multica-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081"`
  3. **立刻**连续截 5 帧（间隔 ~300ms）到 `launch-splash-*.png`，取背景为 `#111827` 的那帧
  4. 生成物核对（prebuild 产物，本工作树已存在）：`apps/mobile/android/app/src/main/res/values/colors.xml` → `splashscreen_background` = `#111827`；`values/styles.xml` → `Theme.App.SplashScreen` 父主题 = `Theme.SplashScreen` 且带 `windowSplashScreenBackground` / `windowSplashScreenAnimatedIcon` / `postSplashScreenTheme`；`MainActivity.kt` 含 `SplashScreenManager.registerOnActivity(this)` 且 `setTheme(R.style.AppTheme)` 被注释
  5. `values-night/colors.xml` 应为空 `<resources/>`（未写 `dark`）
  6. 桌面图标：回到 launcher 截 `launcher-home.png`，再放大裁 `launcher-icon-zoom.png`
  7. `adb logcat -d | grep -c "Failed to hide splash screen"` → 期望 0
expect: ① 启动帧背景色 = `(17,24,39)` = `#111827`，中央 mark = `(255,255,255)`；② 上述生成物逐条命中；
③ launcher 圆形遮罩下白色 mark 完整、无裁边；④ `SplashScreenManager` 的 `ClassNotFoundException` 不再出现。

历史结论（原文）：
> **改动前**（prebuild 生成物实测）：`res/values/colors.xml` → `splashscreen_background` `#FFFFFF`；`res/values-night/` 空目录（无 night 覆盖 → 深色模式启动闪白）；
> `res/drawable-*/splashscreen_logo.png` Expo 自带占位图形（浅灰网格），不是品牌 mark；`Theme.App.SplashScreen` 只设 `android:windowBackground`，**没有** Android 12+ 的 `windowSplashScreen*`。
> **改动后**（`screens-final/launch-splash.png` 冷启动实帧）：背景 `(17,24,39)` = `#111827`，中央 `(255,255,255)` = 白色 mark —— 与桌面图标同一视觉。
> **桌面图标**：`screens-final/launcher-home.png` + `launcher-icon-zoom.png` —— 白色 mark 压在 `#111827` 上，被 launcher 圆形遮罩裁切后 mark 完整、无裁边。
> **`SplashScreenManager` 的 `ClassNotFoundException`**：来源是 `expo-dev-launcher` 的 `DevLauncherController.kt` 里 `Class.forName(...)` 被 `try/catch` 包住后 `Log.e`，Debug 专有、不崩溃。装上 `expo-splash-screen` 后消失（改动后冷启动 logcat 已无该行）。

本次已核（工作树现状）：`colors.xml` = `#111827` ✅、`values/styles.xml` 的 `Theme.SplashScreen` 三属性齐全 ✅、
`values-night/colors.xml` = `<resources/>` ✅、`MainActivity.kt` 两处标记齐全 ✅。

### V3 深浅两套：系统栏与主题令牌

route: `more/settings`（切主题）→ 任意页面复核

steps:
  1. `reset_to_tab_root` → `goto more/settings` → `sleep 4`
  2. `tap_text "Light"`（设置页 `Appearance` 分组下的三行：`Light` / `Dark` / `System`）
  3. 复验：正文区中心像素亮度 `lum > 180`（550 `set-theme.sh` 口径 `(w/2, h*0.625)`）
  4. 截 `light-statusbar.png`；判状态栏前景：`dumpsys window | grep -oE 'type=statusBars frame=\[[0-9-]+,[0-9-]+\]\[[0-9-]+,[0-9-]+\]'` 取状态栏区域，统计该条带内「与条带底色反差 > 阈值」的字形像素 → 浅色下应存在**深色**字形
  5. 手势条区域同样处理：手势条图标色由系统按背景自动翻转，浅色下应为深色
  6. 重复 2–5，把 `tap_text "Dark"` / `confirm lum < 80` 换成深色一套
  7. `tap_text "System"` 复位
expect: ① 两种主题各自的正文亮度命中阈值；② 状态栏图标浅底深字 / 深底浅字；③ 标题不被状态栏压住（首个标题节点的 top ≥ 状态栏底边）。

历史结论（原文）：
> | 深浅色令牌 | `global.css` / `lib/theme.ts` 的变量无平台语义，浅深两套截图逐页比对无偏差项 | 不改 |
> | 系统栏 | 状态栏与手势条配色深浅两套都正确（`screens-final/` 全部截图） | 不改 |
> 状态栏前景色由 `app/_layout.tsx` 的 `<StatusBar style={isDarkColorScheme ? "light" : "dark"} />` 负责；系统栏（手势条）图标色由系统按背景自动翻转。实测深浅两套都正确。

> 未确认：`type=statusBars` 这个 token 在 `dumpsys window` 里的确切写法没有被本仓任何脚本用过（548 `lib.sh` 只解析过 `type=ime`）。
> 首次运行时先 `adb shell dumpsys window | grep -oE 'type=[a-zA-Z]+ frame=…' | head -20` 确认 token 名，再落判据；
> token 取不到时退化为「按状态栏条带（本机 1080×2400@420dpi 下约 y∈[0,63]）做像素采样」。

### V4 SegmentedControl 的替代物：My Issues 的 scope pill 组

route: `my-issues`

steps:
  1. `reset_to_tab_root` → `goto my-issues` → `sleep 4`
  2. `dump_ui`，断言三个 pill 文案存在：`text="Assigned"`、`text="Created"`、`text="Agents"`（同行右侧是 Filter 图标按钮）
  3. `tap_text "Created"` → 截图；`tap_text "Agents"` → 截图
expect: 三个 pill 可见、可点，切换后列表内容随之变化（scope 生效）；浅深两套都正常。
**本条是「依赖已死、UI 另有实现」的确认项，不是回归项**：549 核实 `@react-native-segmented-control/segmented-control` 全仓无调用方，
My Issues 的 Assigned/Created/Agents 现由 `ScopeToolbar` 的 RNR 风格 pill 组渲染。

历史结论（原文）：
> | SegmentedControl | 该依赖已无任何调用方，UI 由 RNR 风格 pill 组承担 | 记录 |
> | `@react-native-segmented-control/segmented-control` | **已无任何调用方**（FEATURE-549 核实）：全仓只有 `apps/mobile/package.json` 的依赖声明与 `docs/android-probe.md` 的历史表格提到它；`My Issues` 的 Assigned/Created/Agents 分段现由 `ScopeToolbar` 的 RNR 风格 pill 组渲染（`my-issues.tsx` 注释写明 "Replaces the previous full-width segmented tabs"）。

549 其余「不改」结论（本次只需**确认没有被回归破坏**，不必逐项复跑）：
> | 字体栈 | 项目没有设置任何正文 `fontFamily`；React Navigation 的 header 字体已由上游 `Platform.select({ ios: fonts.bold, default: fonts.medium })` 分派 | 不改 |
> | 字重 | Android 上「带 `fontFamily` 时 500/600 塌成 400」属实，但现有两处 `fontFamily` 都不受影响（一处无调用方、一处无字重类） | 记录约束 |
> | 行高 | markdown 路径已显式给全；其余文本的两端差异来自系统字体本身（Noto Sans CJK vs PingFang SC） | 接受 |
> | 圆角 | `borderCurve: "continuous"` 是 iOS 专有，Android 静默忽略 | 接受 |
> | 阴影 | Android 只认 `elevation`；NativeWind 已把 `shadow-*` 编译成 elevation | 接受 |
> | 分割线 | 全仓 `h-px` = 1dp，两端一致 | 接受 |
> | 水波纹 | 全仓 0 处 `android_ripple`；RNR 上游与 iOS 同样不带 —— 属跨平台一致的设计缺口 | 不引入平台分支 |

---

# M 组 · Markdown 渲染与代码高亮（FEATURE-550）

设备与基线（原文）：模拟器 `Medium_Phone_API_35`（Android 15 / API 35，arm64-v8a）；构建：Debug（dev 变体，JS 走 Metro）。
截图与原始数据：`.trellis/tasks/09-18-android-markdown-highlight/research/verify-final/`（**在 FEATURE-550 工作树**）。

**重要的取证陷阱（550 实测）**：`uiautomator dump` 只能看到 12 项夹具里的一部分文本 ——
`verify-summary.txt` 的断言结果是 6 项 ✓、10 项 ·（`dump 未覆盖 10 项（渲染是否可见以截图为准）`）：

```
  ✓ PROB Markdown 语法全覆盖    ✓ H1 一级标题    ✓ 加粗    ✓ 删除线    ✓ 无序列表    ✓ 有序列表
  · 未完成项    · 引用第二层    · 表格    · 分隔线    · 代码块（typescript    · foobar
  · plain monospace fallback    · 行内代码紧邻标点    · 表情    · HTML 硬换行
```

⇒ M 组的判定**以截图为主**，dump 断言只在上面 6 个 marker 上做加分项（这 6 个字符串是 550 脚本里已跑通的判据）。

统一驱动：
```
1. reset_to_tab_root
2. goto issue/01a0b3a5-0bf0-7702-b33b-5c38dc6ded45   # = PROB-1（也可写 issue/PROB-1）
3. sleep 6 → 截 frame-01 → `adb shell input swipe 540 1900 540 1140 260` → sleep 2 → 截 frame-02 → …（8 帧，步长 760，同 550 capture.sh issue 模式）
4. 重复一遍前先 `bash set-theme.sh Dark`，截 matrix-dark 6 帧
```

### M1 标题 h1–h6
route: `issue/PROB-1`
steps: 1. `goto`（见上）2. 截 frame-01/02
expect: h1→h6 六级标题字号单调递减、层级可辨；dump 加分项 `text` 含 `H1 一级标题`。

### M2 加粗 / 斜体 / 删除线
route: `issue/PROB-1`
steps: 1. 截 frame-02/03
expect: 加粗明显更粗、斜体倾斜、删除线穿过文字；dump 加分项 `加粗`、`删除线`（550 实测这两条在 dump 里出现过）。

### M3 行内代码
route: `issue/PROB-1`
steps: 1. 截 frame-03
expect: 行内代码用等宽字体 + 底色块；相邻标点不被吞（夹具里专门有「行内代码紧邻标点」这一段，dump 里读不到 → 看图）。

### M4 普通链接
route: `issue/PROB-1`
steps: 1. 截 frame-03/04
expect: 链接有可辨的强调色/下划线形态（夹具含「普通链接」段）。

### M5 无序 / 有序 / 嵌套列表
route: `issue/PROB-1`
steps: 1. 截 frame-03/04
expect: 项目符号与编号正确、嵌套层级有缩进；dump 加分项 `无序列表`、`有序列表`。

### M6 任务列表（含已勾选删除线）
route: `issue/PROB-1`
steps: 1. 截 frame-04
expect: 未完成项是空方框、已完成项是勾选方框 + 文字带删除线；dump 加分项 `未完成项`（550 实测这条**不在** dump 里 → 以截图为准）。

### M7 引用（含嵌套）
route: `issue/PROB-1`
steps: 1. 截 frame-04/05
expect: 引用块有左侧竖线/缩进，第二层引用再缩进一级（dump 里读不到 `引用第二层` → 看图）。

### M8 表格（含中/右对齐）
route: `issue/PROB-1`
steps: 1. 截 frame-05
expect: 表格线框完整、列不塌；中/右对齐列的字在单元格内居中/靠右（dump 里读不到）。

### M9 分隔线
route: `issue/PROB-1`
steps: 1. 截 frame-05
expect: 出现一条横贯正文宽度的水平细线。

### M10 ts / python 代码块高亮
route: `issue/PROB-1`（**高亮的核心验收项**）
steps: 1. 截 frame-05/06，正对 `typescript` 与 `python` 两个围栏 2. 同时抓 logcat：`adb logcat -d -s ReactNativeJS:V | grep -c "initializing highlighter"` → ≥ 1
expect: 代码块内**出现多种 token 颜色**（关键字/字符串/注释不同色），而不是整块同色；
已知语言**不能**落到纯文本分支（`[shiki] highlight failed for lang=…` 在 logcat 里出现 0 次）；
dump 加分项里 `代码块（typescript` 读不到（550 实测），以截图为判据。

历史结论（原文）：
> **高亮**：12 语言预注册的 Oniguruma scanner 正常；未知语言（`foobar`）与「引擎不可用」走同一条
> `highlight() → null` → `PlainCode` 分支，前者已在设备上实测不抛错、渲染等宽纯文本。

### M11 未知语言回退纯文本（`foobar`）
route: `issue/PROB-1`
steps: 1. 滚到 `foobar` 围栏 2. 截 frame-06/07 3. `adb logcat -d -s ReactNativeJS:V | grep -c "highlight failed for lang=foobar"` → 期望 0
expect: 该块渲染成**等宽纯文本、无 token 着色**，页面不抛错、不错位；
夹具里该块紧跟一行 `plain monospace fallback` 文案（可作人眼定位锚）。

历史结论（原文）：
> 未知语言（`foobar`）与「引擎不可用」走同一条 `highlight() → null` → `PlainCode` 分支，前者已在设备上实测不抛错、渲染等宽纯文本。

### M12 表情 / 硬换行 / 超长行 / 列表内代码块
route: `issue/PROB-1`
（这四类在 spec 的语法清单里各占一项，但都属「排版边界」，合成一条跑）
steps: 1. 截 frame-07/08（含超长行不横向溢出屏幕）
expect: ① emoji 正常显示（不是豆腐块）；② HTML 硬换行处确实换行而不是合成一段；③ 超长行在正文宽度内折行、不撑破容器；④ 列表内的代码块有正确的缩进与底色块。

历史结论（原文，spec 汇总句）：
> **语法矩阵逐项通过**（浅深两套）：h1–h6、加粗/斜体/删除线、行内代码、普通链接、无序/有序/嵌套列表、
> 任务列表（含已勾选删除线）、引用（含嵌套）、表格（含中/右对齐）、分隔线、ts/python 代码块高亮、
> 未知语言回退纯文本、表情、硬换行、超长行、列表内代码块。

### M13 12 语言 scanner（预注册语法的完整覆盖）
route: `issue/c3be9531-19ad-403c-9944-ed33c6c67f05`（= `PROB-3`「12 langs」）
steps: 1. `goto issue/<PROB-3 uuid>` → `sleep 16` 2. 截 `B-langs.png`
expect: 12 个代码块（ts / js / tsx / jsx / python / go / rust / bash / json / yaml / sql / markdown，见
`.trellis/tasks/09-18-android-markdown-highlight/research/fixture-langs.md`）全部带 token 着色；页面可滚到底、无空白占位。

### M14 前后台内存回收路径（`dumpsys meminfo` 序列）
route: `issue/PROB-3`
steps（照抄 550 `mem-seq.sh`，一轮 5 个采样点）:
  1. `adb shell input keyevent KEYCODE_HOME` → `am force-stop "$PKG"` → 用 dev-client intent 冷启 → `sleep 30`
  2. **前置校验**：`dump_ui | grep -q 'text="My Issues"'`，否则「量到的是 launcher 的内存」本次作废
  3. `snap N0-cold` = `adb shell dumpsys meminfo "$PKG" > mem-N0-cold.txt`
  4. `goto issue/<PROB-3>` → `sleep 12` → `snap N1-langs-rendered`
  5. `adb shell input keyevent KEYCODE_HOME` → `sleep 8` → `snap N2-background`
  6. `am start -n "$PKG/.MainActivity"` → `sleep 6` → `snap N3-resumed`
  7. `goto issue/<PROB-3>` → `sleep 12` → `snap N4-rehighlighted`
  8. 同时抓带时间戳的 logcat 计数（550 `release-proof.sh` 的做法，**必须用连续 `logcat -v time -s ReactNativeJS:V`，不要每次 `logcat -d`**，否则环形缓冲会淘汰早期行）：
     `grep -c 'initializing highlighter'` 与 `grep -c 'released highlighter'`
expect: ① `N2.background` 的 `Native Heap Alloc` 明显低于 `N1`、`Free` 明显高于 `N1`（550 实测：Alloc 342,442 → 255,976 KB，Free 32,839 → 118,881 KB；TOTAL PSS 628,116 → 543,268 KB）；② `N3` 仍保持释放态（不回弹）；③ `N4` 回到接近 `N1`（按需重建）；④ logcat 里 `initializing` / `released` 两条 `__DEV__` 日志**交替出现**。
关键列：`dumpsys meminfo` 的 `Native Heap` 行后三列 `Heap Size / Alloc / Free`（PSS 不一定回落，见 550 报告）。

历史结论（原文）：
> **内存回收**：两个平台都没有 `memoryWarning` / `onTrimMemory` 挂钩（issue 里「iOS 已有」与代码不符）；
> 引擎按 50MB 上限淘汰 pattern cache，但**高亮器实例存活时 scanner 不释放**。Android 现由 AppState 驱动：
> `background` → `releaseHighlighter()`（dispose → `destroyScanner`），`active` → 重新预热。
> 实测（同一会话，KB）：12 语言渲染后 Native Heap Alloc 342,442 / Free 32,839 → 按 HOME 进后台
> Alloc 255,976 / Free 118,881（Alloc −86MB、TOTAL PSS −85MB）→ 回前台仍保持释放态，再次打开按需重建。
> 深链会触发一次瞬时 `background → active`（实测 ~165ms），即每次深链释放并立即重建一次，属设计取舍（iOS 不注册）。

> ⚠️ 「深链触发一次瞬时 background→active」意味着**每次 `goto` 都会重建一次高亮器**：脚本里 `initializing` 的计数天然会偏高，不要把计数本身当判据，判据是「同一动作序列里 released 紧随 initializing 出现」。

### M15 长文档（PROB-2）滚动
route: `issue/01a0b3a5-2c4c-770e-b13f-c0060d368b7e`（= `PROB-2`）
steps: 1. `reset_to_tab_root` 2. `goto` → `sleep 6` 3. `dumpsys gfxinfo "$PKG" reset` 4. 连续 14 次 `input swipe 540 1900 540 520 220`（间隔 1s）5. `dumpsys gfxinfo "$PKG" > gfxinfo-scroll.txt`
expect: 滚到底全部渲染、无空白占位；帧率**不作为验收判据**（见下）。

历史结论（原文）：
> **长文档**：PROB-2（24 段 × 2 代码块）滚动到底全部渲染、无空白占位。
> **帧率不作验收结论**：同一构建同一协议实测 2.39% / 28.17% / 33.33% janky（p50 16/38/42ms，宿主 load 10–21），
> 随宿主负载大幅波动；真机 Release 帧率留给后续阶段。

⇒ 本次复跑只需记录 `gfxinfo` 数字供对照（参考值：`Total frames rendered: 710`、`Janky frames: 200 (28.17%)`、`50th percentile: 38ms`），**不据它判过/不过**。

---

# D 组 · 易漏场景

### D1 深链直达 picker 路由后按 BACK 落到哪

route: `issue/<PROB-1 uuid>/picker/label`（同族：`.../picker/{status,priority,assignee,project,due-date}`、`issue/<id>/runs`、`new-issue-picker/{status,priority,assignee,project,due-date}`、`mention-picker`、`project/<id>/picker/{status,priority,lead}`、`issues-filter`、`chat-sessions`、`switch-workspace`）

steps:
  1. 先让应用处于**没有历史栈**的状态：`am force-stop "$PKG"` → 用 dev-client intent 冷启 → 等进应用（`dump_ui | grep -q 'text="My Issues"'`）
  2. **第一次** deep link 直接打 picker：`goto issue/<id>/picker/label` → `sleep 5` → 截图 `d1-picker-direct.png`
  3. 记录落地形态：`dump_ui` 里 `content-desc="Clear search"`（label picker 的搜索框清除按钮）是否存在 ⇒ 确认确实落在 picker 上
  4. `adb shell input keyevent KEYCODE_BACK` → `sleep 3` → `dump_ui` + 截图 `d1-after-back.png`
  5. 判定：dump 里是否同时出现 `text="Inbox"`、`text="My Issues"`、`text="Chat"`、`text="More"`（⇒ 落在 `(tabs)` 锚点、Inbox 页）
     还是出现了 issue 详情页的 `accessibilityLabel="Issue actions"`（⋯ 按钮）与评论输入框 `content-desc="Add a comment, @ to mention…"`
  6. 对 `new-issue-picker/due-date`（**兄弟路由**，历史上测过的那条）重复 1–5 作对照
expect: **预期落在 `(tabs)` 锚点的 Inbox 页** —— 依据是 `app/(app)/[workspace]/_layout.tsx` 的
`export const unstable_settings = { anchor: "(tabs)" }`，其注释原文：

> Cold-start deep-link anchor. Expo Router otherwise treats whatever route resolves the URL as the root of the stack — if the user opens a notification that targets `issue/[id]/picker/status` directly, they land on the formSheet with NO parent under it, no way to go back to the tabs. `anchor: "(tabs)"` tells the router to mount the tab UI as the implicit underlying screen so back/swipe-dismiss returns the user to a sensible base state.

即：picker 被单独 push（`issue/[id]/picker/*` 是 `_layout.tsx` 里与 `issue/[id]` **平级**的 `Stack.Screen`，不会被当成父级 mount），
所以 BACK = 关闭 sheet → 露出锚点 = Inbox。判据必须是「BACK 之后 tab bar 四文案齐全且当前列表是 Inbox」，
**不是**「back 之后停在 issue 详情」。

历史结论（原文，FEATURE-547）：
> | 5.6 | 深链锚点 | 冷启动式深链直达 due-date → Done | 落在 Inbox（`(tabs)` 锚点）✅ |
> 3. release 包下的冷启动深链（本轮只验证了会话内深链的锚点行为）。

> **本条的已知盲区（必须写进结论）**：
> - 547 §6.5 原文：「`expo-dev-client` 冷启动落在开发服务器列表页，深链 URL 不会自动生效 —— 所以本轮所有验证都在已加载的会话里做，也意味着**「App 被杀后深链冷启动」这条路径无法在 dev 包上验证**（release 包才能；本轮没做）。」
> - 因此**真·冷启动深链（点通知拉起、进程不存在时）在 dev 构建上不可测**。脚本能测的等价物是「force-stop → 重新加载 bundle → 栈为空时深链直达 picker」，
>   请把这一点在结论里标注为「会话级等价验证」，而不是声称测了冷启动。
> - 547 只测过 `new-issue-picker/due-date` 这一条**兄弟**路由；**嵌套在 `issue/[id]/` 下的 picker 直达从未实测**。D1 是本次真正要补的一条。
> - 「未确认」项：BACK 到底是「关 sheet 并落在 Inbox」还是「可能先回 issue 详情」——按 anchor 注释与 547 §5.6 推断是前者，但本轮必须看 `d1-after-back.png` 定案。

### D2 断网 → 重连 → 实时同步

route: `issue/<PROB-1 uuid>`（停留在一个会收到 WS 事件的页面上）

steps:
  1. 进 issue 详情：`goto issue/<PROB-1 uuid>` → `sleep 8`
  2. 起后台 logcat：`adb logcat -c; adb logcat -v time -s ReactNativeJS:V > /tmp/d2.log &`
  3. **断网**（首选）：`adb shell cmd connectivity airplane-mode enable`（API 30+ 的 `cmd connectivity` 子命令；本机 API 35）
     兜底（同时断两种传输，防「关 Wi-Fi 后走蜂窝仍能到 10.0.2.2」）：`adb shell svc wifi disable; adb shell svc data disable`
  4. **验真断了**（不要假设）：`adb shell dumpsys connectivity | grep -iE 'Active default network|NetworkAgentInfo'` 应显示无默认网络；
     `adb shell ping -c 1 -W 1 10.0.2.2` 应超时
  5. 等 ~10s，观察 logcat 里 WS 掉线（`[ws]` 相关行）
  6. **恢复网络**：airplane 路线 `adb shell cmd connectivity airplane-mode disable`；svc 路线 `adb shell svc wifi enable; adb shell svc data enable`
  7. 等 ~10s，`grep -E '\[realtime\] netinfo: back online|\[ws\] dialing|\[ws\] socket open, sending auth frame' /tmp/d2.log`
  8. **实时同步判据**：在宿主机用仓库 CLI 改这条 issue，再验证设备上**没有手动刷新**就变了
     —— `multica issue update <PROB-1 uuid> --status in_progress`（`server/cmd/multica/cmd_issue.go` 的 `issueUpdateCmd`）；
     设备侧等 ~10s 后截图 + `dump_ui`，status chip 文案应变为 `In Progress`
expect: ① 恢复网络后 logcat 出现 `[realtime] netinfo: back online → forceReconnect`、随后 `[ws] dialing` 与 `[ws] socket open, sending auth frame`（各 ≥ 1 次）；
② issue 详情的 status chip 在无手动刷新的情况下更新。
机制依据（原文）：`data/realtime/realtime-provider.tsx` 的 NetInfo 监听只在 offline→online **边沿**触发 `ws?.forceReconnect()`，
同文件注释「NetInfo offline → online edge → force reconnect (don't wait for TCP keepalive timeout to notice the dead socket after wifi↔cellular handoff)」；
`data/query-client.ts` 把 `onlineManager` 接到同一个 NetInfo 信号上，「queries are automatically paused while offline + replayed when the network returns」。

> **未确认（无历史证据）**：本仓没有任何任务跑过断网实验（`apps/mobile/docs/` 下 `am kill`/`airplane`/`connectivity`/`svc` 均 0 命中）。
> 以下三点必须在首次运行时现场确认，不要写进计划当真值：
> 1. `cmd connectivity airplane-mode enable` 在 `Medium_Phone_API_35` 上是否真的切断 `10.0.2.2` 的路由（模拟器的 radio 与 virtual Wi-Fi 都可到宿主机）；
> 2. `svc wifi disable` 单独是否足够（很可能**不够**，模拟器会落到蜂窝）；
> 3. `multica issue update` 需要 `server-url` / profile 凭据（`--profile` / 环境变量），宿主机的 CLI 是否已配好指向 `127.0.0.1:8090` —— 未配的话改用宿主 `curl PUT /api/issues/<uuid>`（需要 Bearer token，`X-Workspace-Slug: probe550`）。
> 判据以「logcat 三行 + UI 自动变化」为准；若 8 步的 CLI 路径不通，退化为「只验 ①② 中的 ① + `dumpsys connectivity` 前后对比」，并在结论里写明降级原因。

### D3 前后台切换 / 进程被杀后的恢复

route: 无（HOME / 重新拉起）

steps:
  1. `goto issue/<PROB-1 uuid>` → `sleep 8` → 确认详情已渲染（截图）
  2. **前后台切换**：`adb shell input keyevent KEYCODE_HOME` → `sleep 8` → `am start -n "$PKG/.MainActivity"` → `sleep 6`
     → 截图：应**回到离开时的 issue 详情**，不是回到 tab 根
  3. **`am kill`（后台进程被杀，模拟系统回收）**：先确保应用在后台（第 2 步的 HOME）→
     `adb shell am kill "$PKG"` → `sleep 3` → `adb shell pidof "$PKG"`（应为空；`am kill` 只杀**后台**进程，且成功时无输出）
  4. 从最近任务/启动器恢复：`adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1` → `sleep 20`
     → 截图 + `dump_ui`，判定落点（`text="My Issues"` 是否齐全 ⇒ 是否回到 tab 根）
  5. **`am force-stop`（等价于用户划掉/强停）**：`goto issue/<PROB-1 uuid>` → `sleep 6`
     → `adb shell am force-stop "$PKG"` → `sleep 3` → `pidof` 应为空
     → **dev 构建**重新拉起必须走 dev-client intent（§0），否则停在 expo-dev-client 的服务器列表页，看起来像「恢复失败」其实是启动方式错了：
     `am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW -d "exp+multica-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081"` → `sleep 30`
  6. 截图 + `dump_ui`：冷启后应落在**登录后默认入口**（tab 根），而不是崩溃/白屏/登录页
expect: ① 前后台切换保留在离开时的路由；② `am kill` 后重新拉起能正常进应用（不白屏、不卡 dev launcher）；
③ `am force-stop` 后重新拉起能进应用；④ 全程 `dump_ui` 里 tab bar 四文案齐全。
补充判据（550 的 `app_alive()` 口径）：无障碍树里除 `text="Tools"`（expo-dev-client 悬浮按钮）之外还有 > 2 条文本 ⇒ 应用在渲染；
若只剩状态栏 + `Tools`，说明落到了「JS 在跑但路由栈渲染为空」的状态，先用 `point_at_metro` 冷启恢复再继续。

> **未确认**：`am kill` 与 `am force-stop` 在 **dev 构建**上都无法区分「RN JS 冷启」与「Android Activity 恢复」——
> dev 构建的 bundle 由 Metro 提供，恢复路径本身依赖 dev-client。550 记录的同类坑原文：
> 「裸 `am start -n .MainActivity` 会停在 expo-dev-client 的服务器列表页；必须用 `exp+multica-mobile://expo-development-client/?url=...` 拉起。」
> ⇒ 结论里要写清：本条的「恢复」验证的是 **JS 层冷启后的落点**，不是 Android 原生 `savedInstanceState` 恢复。
> 若要验真正的原生恢复，需要 staging/production 的非 dev-client 构建（本次若装的是 staging Debug，同样带 dev-client，**仍不可测**）。

---

# E 组 · edge-to-edge 系统栏（FEATURE-548 交接清单 C1–C6）

来源：`.trellis/tasks/09-18-android-input-keyboard-nav/research/verification-handoff.md` 的 §C 表。
**这六条在 548 里一条都没测**（原文：「本任务（548）按用户要求「一次改完、一次验收」**不在本任务里起模拟器**；
下面的点是静态检查无法判定、必须在设备上过一遍的。设备侧证据统一由 FEATURE-551 的那一次会话产出。」）。

### E0 通用的量测（C1–C6 共用）

screen: `adb shell wm size` → `1080x2400`；`adb shell wm density` → `420`

```
# 系统栏 inset：与 548 lib.sh 的 ime_top() 同一个 dump、同一个正则形状
adb shell dumpsys window | grep -oE 'type=navigationBars frame=\[[0-9-]+,[0-9-]+\]\[[0-9-]+,[0-9-]+\]'   # 取 t（顶边 y）
# tab bar 的可见底边：取四个 tab 标签里 y2 最大者的 y2
dump_ui | grep -oE 'text="(Inbox|My Issues|Chat|More)"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"'
```
**判据（量化）**：`max(tabLabel.y2) ≤ navigationBars.top` ，且两者之差 ≤ 24px（tab bar 的 `paddingBottom` 恰好等于 `insets.bottom`）。
机制依据（548 原文）：
> 底部安全区不用各页面自己补：底部 tab bar 由 react-navigation 按 `insets.bottom` 抬高
> （`BottomTabBar` 的 `paddingBottom` 与 `getTabBarHeight`），tab 内的页面因此天然位于系统导航条之上。

切换导航模式（548 交接清单里给的命令，原文）：
```
adb shell cmd overlay enable com.android.internal.systemui.navbar.threebutton   # 三键
adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural     # 手势（复位）
adb shell cmd overlay list | grep -i navbar                                    # 先看可用 overlay
```

> 未确认：`type=navigationBars` 的 token 写法本仓无先例（548 `lib.sh` 只解析过 `type=ime`）。
> 首次运行先 `adb shell dumpsys window | grep -oE 'type=[A-Za-z]+ frame=…' | sort -u` 确认；
> 取不到时退化为「以屏高 − tab 标签底边」的相对比较（三键模式下该差值应显著大于手势模式，即 C2 的『tab bar 整体高度随 inset 变高』）。

### E1 / C1 底部 tab bar（手势导航）不被手势条压住
route: 任意 tab 根（`inbox`）
steps: 1. 确保是手势导航（`cmd overlay enable …navbar.gestural`）2. `reset_to_tab_root` 3. 截图 4. 按 E0 取 `tabLabel.y2` 与 `navigationBars.top`
expect: 四个 tab 的**图标与标签都在手势条之上**：`max(tabLabel.y2) ≤ navigationBars.top`（截图上手势条区域内没有 tab 文字/图标）。
历史状态：**本轮未测**（548 未起模拟器）。547 的交互记录里出现过对照面：`| 5.1 | 拖拽关闭 | … | sheet 消失，露出底部 tab ✅ |` —— 能「露出底部 tab」说明 tab bar 当时是可见的，但那不是 inset 判据。

### E2 / C2 底部 tab bar（三键导航），且高度随 inset 变高
route: 同 C1
steps: 1. `adb shell cmd overlay enable com.android.internal.systemui.navbar.threebutton` → `sleep 3` 2. 重新 dump + 截图 3. 与 C1 的 `max(tabLabel.y2)` 对比 4. 收尾复位回 gestural
expect: ① 三键导航条不遮挡 tab bar；② `max(tabLabel.y2)` 比手势模式**更小**（tab bar 被 `insets.bottom` 抬高，整体高度变大）。
548 原文疑虑（正是本次要回答的）：
> C1/C2/C3/C6 的机制依据：底部 tab bar 由 react-navigation 按 `insets.bottom` 抬高（`BottomTabBar` 的 `paddingBottom` + `getTabBarHeight`），tab 内页面因此天然在导航条之上；但 inset 在 gesture / three-button 两种模式下是否都非零，只有设备能答。

### E3 / C3 聊天输入框与 tab bar 之间无重叠
route: `chat`
steps: 1. `reset_to_tab_root` → `goto chat` → `sleep 5`（**键盘收起态**）2. dump 取 composer 的 `content-desc="Type a message…"` 的 bounds 与 tab 标签的 top 3. 截图
expect: `composer.bottom ≤ min(tabLabel.top)`（输入框底边 = tab bar 顶边，不重叠）；聊天内容最后一行不被输入框吃掉。
548 原文给出的复现：`A1 截图（键盘收起态）`。

### E4 / C4 状态栏前景色（深浅两套）
route: `more/settings`（切主题）→ 任意页复核
steps: 1. `tap_text "Light"` → 截图 + 对状态栏条带做像素采样 2. `tap_text "Dark"` → 同 3. `tap_text "System"` 复位
expect: 浅色下状态栏图标为**深色**、深色下为**浅色**，与背景对比正常；页面标题不被状态栏压住（首个标题节点 top ≥ 状态栏底边）。
实现点：`app/_layout.tsx:90` 的 `<StatusBar style={isDarkColorScheme ? "light" : "dark"} />`。
历史状态：**549 顺带记录过**「状态栏与手势条配色深浅两套都正确」，但**不是**以 C4 的量法（无 inset 坐标判据）测的；本次仍应补齐坐标判据。

### E5 / C5 sheet 底部：picker 最后一行不被手势条遮挡
route: `issue/<PROB-1 uuid>/picker/assignee`（同族 picker 任选）
steps: 1. `goto` 该 picker → `sleep 5` 2. 在列表内滚到底（`input swipe 540 1800 540 700 260` 重复 3 次）3. 截图 + dump 最后一行文本
expect: picker 列表**最后一行完整可见**、不被手势条/导航条切掉；sheet 在 Android 由 react-native-screens 渲染为 Material BottomSheet，BACK 可关（548 F7）。
548 原文给的复现：`深链任一 picker，滚到底`。

### E6 / C6 设置页列表末尾能在 tab bar 上方完整滚出
route: `more/settings`
steps: 1. `goto more/settings` → `sleep 4` 2. 连续上滑到底 3. 截图 + dump 最后一行
expect: 最后一行完整可见地停在 tab bar 上方（不被 tab bar 或手势条覆盖），且列表可继续回弹。
548 原文给的复现：`设置页滚到底`。

---

# 附：本次的新增/未确认清单（合并进 driving-plan.md 时按此改号）

1. **M13–M15 超出给定的 `M1..M12` 编号范围**：M1–M12 是 550 的 12 组语法夹具；M13（12 语言 scanner）、M14（内存回收序列）、M15（长文档 PROB-2）是本任务明确要求覆盖的另外三项，合并时请追号或改挂到单独分组。
2. **裸编号深链不可用**：`multica://probe550/issue/1` 会 404（服务端只认 `PREFIX-NUMBER` 或 UUID）。所有 issue 路由用 `PROB-1/2/3` 或 §0.2 的 UUID。
3. **包名代差**：549/550/548 的历史脚本写的是 `ai.multica.mobile.dev`；品牌化后是 `com.ehaier.zgq.shop.mall[.dev/.staging]`。跑之前 `pm list packages | grep mall` 定案。
4. **546 的一条遗留**（与 picker 搜索相关，V/M/D/E 都不覆盖，但同属「易漏」）：project picker 的**正例过滤**在设备上不可测 ——
   547/546 原文：「`adb shell input text` 只能注入 ASCII，而种子工作区唯一的项目名是 `探针项目`（纯中文），无法从模拟器输入」，
   546 因此只跑了负例（`No project` 行消失 → `No matches.` → 清除恢复）。若本次想补正例，需要先在 probe550 建一个 ASCII 名项目。
5. **558/557 相关的包名与图标**：V2 的 launcher 图标核对与 FEATURE-557 的品牌化共享同一证据（白色 mark / `#111827`），本次只需确认没有回归。
