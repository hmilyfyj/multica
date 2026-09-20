# FEATURE-550 Android Markdown 渲染与代码高亮实测

## Goal

用 Android 实测判定 `apps/mobile` 的 markdown 混合渲染链路（enriched-markdown 原生 prose +
自研 Shiki 代码块 + 图片）在安卓上是否成立：GFM 语法逐项渲染、代码高亮正确性、
高亮器失败时的纯文本降级、内存回收路径、长文档首屏与滚动。发现的平台缺陷在 Android 侧修掉，
结论写回 `.trellis/spec/mobile/frontend/android-platform.md` 与
`apps/mobile/docs/markdown-rendering-adr.md`。

## 基线与环境

- 基线：`origin/main` @ `7520b1bc6`（含 542~547、549 的交付；549 已校准 `markdown-style.ts` 的字体与行高；
  `8c0ebc0bc` 起 debug 构建按目标设备收敛 ABI）
- 设备：Android 模拟器 `Medium_Phone_API_35`（Android 15 / API 35，1080×2400 @420dpi，arm64-v8a）
- 后端：本机自托管栈 `COMPOSE_PROJECT_NAME=multica-probe542 docker compose -f docker-compose.selfhost.yml up -d postgres backend`
  （`127.0.0.1:8090`，模拟器经 `10.0.2.2:8090`；开发验证码固定 `888888`）
- 构建：`APP_ENV=development`（包名 `ai.multica.mobile.dev`）、Debug，
  `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`、`ANDROID_HOME=$HOME/Library/Android/sdk`
- iOS 侧不在本任务取证范围：本机无 iOS simulator runtime；iOS 行为的「未改动」由
  「改动只落在 Android 分支 / 平台无关代码路径」的结构性论证保证。

## Requirements（对应 issue 的四组）

1. **enriched-markdown**：确认锁定版本带 Android 实现（`android/src/main/java/**` Kotlin 渲染器 + `build.gradle` + JNI），
   并用真实内容逐项验证有序/无序列表、嵌套列表、表格、任务列表、删除线、行内代码、代码块、引用、链接、表情；
   对照 ADR 的「native 渲染、不做自定义 renderer」约束确认 Android 侧成立；核对 `markdown-style.ts` 在 Android 的实际效果。
2. **shiki 高亮**：语法高亮在 Android 上正确；内存回收路径可用——iOS 侧无 `memoryWarning` 钩子这一点要在 Android 上
   用等价手段（AppState 前后台切换）实测能否释放 pattern cache。
3. **降级路径**：`prewarmHighlighter()` 失败 / 原生引擎不可用时回落纯文本，Android 上同样生效且不抛错。
4. **性能**：长 issue（大量代码块）在 Android 上的首屏与滚动表现，记录设备与判定标准。

## 修改边界

本任务独占：

- `apps/mobile/lib/markdown/**`（渲染与样式，可继续调整 Android 侧效果）
- `lib/markdown/shiki.ts` 与内存回收路径的挂载点
- `apps/mobile/docs/markdown-rendering-adr.md`
- `.trellis/spec/mobile/frontend/android-platform.md` 的 markdown 段

不碰：`lib/theme.ts` / `global.css` 的 549 令牌；键盘与安全区调用点（548）；
不改动 iOS 侧已确认的渲染行为；不升级依赖（升级评估只出结论）。

## 验收纪律（用户 2026-09-18 追加，硬要求）

**一次改完、一次验收，不要重复跑好几次验收。**

1. **先改完**：本任务的全部 Android 侧改动（渲染缺陷、样式、高亮、降级、内存挂载点）先在同一个工作区做完，
   中途只跑与改动直接相关的单测 / 单文件检查。
2. **一次构建安装**：只启动一次模拟器、只跑一次完整构建与安装（`pnpm android:mobile:device:staging`，
   ABI 已按设备收敛）；期间不再改代码、不再重启模拟器。
3. **一轮取证**：用**一个**脚本一次覆盖全部验收项——语法逐项 × 浅深两套 + 高亮 + 降级 + 内存前后台序列 +
   长文滚动——产物一次落齐到本任务 `research/` 目录。等待条件用轮询（等元素出现 / 等像素稳定），
   不用固定 `sleep` 堆时长。
4. **一轮出结论**：结论写回 spec 与 ADR。只有「脚本自身缺陷」或「验收项本身写错」才允许重跑，
   并在结论里写明重跑原因。

禁止「改一项 → 起一次模拟器 → 截一轮图」的循环；同一条纪律已写进
`.trellis/spec/mobile/frontend/android-platform.md`（「验收证据要求 → 一次性验收」）。

## Acceptance

1. 逐项语法在 Android 上渲染正确，附截图。
2. shiki 高亮正确，且有内存回收路径的实测证据。
3. 长文档滚动无可感知卡顿（记录设备与主观判定标准）。
4. 结论写回 spec 与 ADR。
5. 若 0.6.0 的 Android 实现有阻塞缺陷，产出升级评估（API 差异 + 迁移成本），不在本任务升级。
6. `pnpm check` 通过。

## Out of Scope

- 升级 `react-native-enriched-markdown` / `react-native-shiki-engine`（只出评估结论）。
- 重写 markdown 渲染架构（ADR 已定「native 渲染 + 分割混合」，本任务只验证与校准）。
- 真机性能（本任务设备是模拟器，结论按模拟器标注）。
