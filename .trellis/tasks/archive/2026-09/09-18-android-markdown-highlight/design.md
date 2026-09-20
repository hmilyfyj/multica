# Design — Android 侧 Markdown / 高亮验证与修复

## 已核实事实（静态，来自锁定的依赖源码）

1. **`react-native-enriched-markdown@0.6.0` 带完整 Android 实现**
   - `android/src/main/java/com/swmansion/enriched/markdown/renderer/DocumentRenderer.kt` 等多文件 Kotlin 渲染器；
   - 含 `build.gradle` 与 CMake/JNI 目录（`android/src/main/jni`），解析层是 md4c（C），渲染层是 Spannable。
   - 结论：「native 渲染、不做自定义 renderer」这一 ADR 约束在 Android 侧同样成立（同一 md4c 前端，两套原生后端）。
2. **`react-native-shiki-engine@0.3.10` 的 JS 面很小**
   - `createScanner(patterns, maxCacheSize)` / `findNextMatchSync` / `destroyScanner` 三个方法，
     `isNativeEngineAvailable()` 走 `TurboModuleRegistry.getEnforcing('ShikiEngine')`。
   - **没有** JS 可见的 trim / memory-pressure API。
3. **原生侧自带 LRU + 内存上限**：`cpp/onig_regex.h` 的 `CACHE_MEMORY_LIMIT = 50MB`，
   `check_memory_pressure()` 在插入新 pattern 前按最旧优先淘汰，`scan_regex_destroy()` 释放。
   即「pattern cache 不会无限增长」是引擎自身保证，不需要应用层去 trim。
4. **全仓（含这两个原生包）没有任何 `memoryWarning` / `didReceiveMemoryWarning` / `onTrimMemory` 命中**。
   → issue 描述里「当前只在 iOS 上挂了 `memoryWarning` 触发的 trim」与代码事实不符：
   释放路径**两个平台都没有**，不是「Android 缺 iOS 已有的东西」。这一点要作为实测结论写回。
5. **`highlighter.dispose()` 是真释放**：`@shikijs/core → @shikijs/primitive` 的 `dispose()`
   → `_registry.dispose()`（vscode-textmate `Registry.dispose`）→ `CompiledRule.dispose()`
   → `scanner.dispose()` → 原生 `ShikiEngine.destroyScanner(scannerId)`。
   所以应用层要补的释放动作 = **dispose 高亮器实例并丢掉缓存的 promise**，下次 `highlight()` 惰性重建。

## 决策

1. **释放路径挂在 AppState 上，且只在 Android 生效。**
   - 新增 `releaseHighlighter()`（dispose + 清 promise）与 `attachMemoryPressureHandler()`（注册 AppState 监听、返回退订函数）。
   - 触发条件：Android 上 AppState 离开 `active`（`background` / `inactive`）→ 释放。
   - iOS 不注册：本任务硬约束是「不改动 iOS 侧已确认的渲染行为」，在 iOS 上后台释放会让回到前台后的首个代码块
     出现一次「plain → highlighted」重建，属可感知行为变化。
   - 释放后**不做**主动预热：`CodeBlock` 已有 `PlainCode` 降级分支，重建期间显示纯文本即可，语义与「引擎不可用」一致。
2. **不引入新的依赖或新的 trim API**：引擎的 50MB 上限已覆盖 pattern cache 增长，应用层只负责
   「进程级长生命周期的高亮器 + 12 份 grammar」在后台被回收。
3. **修复只落在 Android 可判定的差异上**；未发现差异的项不改（避免为「对称」而动 iOS 渲染路径）。
4. **升级评估**：只有当 0.6.0 的 Android 渲染被实测证明有阻塞缺陷时才产出；
   评估产物是结论 + API 差异 + 迁移成本，不在本任务执行升级。

## 验证方法

- 设备：模拟器 `Medium_Phone_API_35`（Android 15 / API 35，1080×2400 @420dpi，arm64-v8a）。
- 后端：本机自托管栈（`multica-probe542`，8090），开发验证码 `888888`，工作区 `probe550`。
- 内容：
  - `PROB-1`：GFM 全覆盖夹具（标题 h1–h6、加粗/斜体/删除线、行内代码、有序/无序/嵌套/任务列表、
    引用（含嵌套）、表格（含对齐）、分隔线、ts/python 代码块、未知语言代码块、列表内代码块、表情、链接、硬换行、超长行）。
  - `PROB-2`：长文档夹具（24 段 × 2 代码块，25.6KB 描述），用于首屏与滚动。
- 取证：`adb exec-out screencap` + `uiautomator dump`（节点坐标断言），脚本落在
  `.trellis/tasks/09-18-android-markdown-highlight/research/`。
- 内存：`adb shell dumpsys meminfo ai.multica.mobile.dev` 取 TOTAL / Native Heap，
  在「打开长文档并滚到底」后 → HOME 回后台 → 回前台三个时点采样。
- 性能：`adb shell dumpsys gfxinfo ai.multica.mobile.dev framestats` 的 janky 帧比例，
  加上主观判定（滚动是否可感知卡顿），两者都要记录；模拟器结论不与真机混同。

## 风险

- 模拟器（swiftshader / 宿主 GPU）帧率低于真机，性能结论只能作为上界参考。
- 深色主题切换需走应用内 Settings（`cmd uimode night` 不可靠，549 已实测）。
- dev 构建的悬浮按钮会遮挡右上角，截图时需先确认不遮挡正文。
