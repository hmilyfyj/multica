# Implement — 步骤与验证

## 代码改动（预期最小面）

| 文件 | 改动 |
|---|---|
| `apps/mobile/lib/markdown/shiki.ts` | 新增 `releaseHighlighter()`（dispose + 清 promise）与 `attachMemoryPressureHandler()`（Android 下的 AppState 监听，返回退订） |
| `apps/mobile/app/_layout.tsx` | 模块级 `prewarmHighlighter()` 旁调用一次 `attachMemoryPressureHandler()` |

预期不新增依赖、不改渲染路径、不改 iOS 行为（`Platform.OS === "android"` 门控）。

改动与否以实测为准：**渲染层若测不出 Android 缺陷，就不为了「对称」改渲染代码**，此时本任务的交付物是
「结论 + spec/ADR 记录 + 释放路径补齐」。

## 命令

```bash
# 环境
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"

# 后端（仓库根）
cd /Users/fengit/workspace/multica.worktrees/FEATURE-550
COMPOSE_PROJECT_NAME=multica-probe542 docker compose -f docker-compose.selfhost.yml up -d postgres backend

# 构建（apps/mobile；dev 变体 = 包名 ai.multica.mobile.dev）
pnpm exec expo prebuild -p android --no-install
cd android && ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Metro（dev 变体）
pnpm dev:mobile        # apps/mobile，读 .env.development.local
```

## 验证清单

1. **语法逐项**：`PROB-1` 打开后逐屏截图，核对 12 项语法（截图 + 结论表）。
2. **高亮**：`PROB-1` 的 ts/python 代码块着色正确；未知语言回落纯文本。
3. **降级**：`isNativeEngineAvailable()` 为假时（可用 `__DEV__` 探针或临时改分支验证）不抛错、渲染纯文本。
4. **内存**：长文档 → 后台 → 前台三时点 `dumpsys meminfo` 采样；释放前后 Native Heap / TOTAL 对比。
5. **性能**：`dumpsys gfxinfo` framestats + 主观判定。
6. **收尾检查**：`rtk err -- corepack pnpm check`（仓库根，改动落定后一次跑完）。
