# FEATURE-544 新增 Android 构建脚本与开发文档

## Goal

给 `apps/mobile` 补上对标 iOS 的 Android 本地构建与运行链路：`scripts/android-run.sh` 包装脚本、
`package.json`（移动端 + 仓库根）的 `android:*` 脚本族、脚本行为测试，以及 README 的 Android 章节。

不涉及业务代码、`app.config.ts` 与原生生成物。

## Requirements

1. `apps/mobile/scripts/android-run.sh`：与 `ios-run.sh` 职责一致 —— 先 `expo prebuild -p android` 再
   `expo run:android`，保留调用方的 `APP_ENV`，参数只转发给 `run:android`，沿用 `set -euo pipefail` +
   `exec` 的写法。支持 `--device` 与 release 变体（`--variant release`）。
2. `apps/mobile/package.json` 补 `android:*`，命名与 `ios:*` 一一对应（含 `:staging` / `:prod` /
   `:device` / `:release` 组合）；仓库根 `package.json` 同步补 `android:mobile*`。
3. `apps/mobile/scripts/android-run.test.sh`：按 `ios-run.test.sh` 的形态做包装器行为测试
   （stub `pnpm`，断言调用顺序 / 参数转发 / `APP_ENV` 透传 / prebuild 失败即中止），不引入新测试框架。
4. `apps/mobile/README.md` 补 Android 章节：首次构建前置（JDK 21 + `JAVA_HOME`、`ANDROID_HOME`、
   模拟器或真机）、常用命令表、与 iOS 的差异、常见报错。

## Verified Facts（本轮核实，非推测）

- `@expo/cli@55.0.30` 的 `ensureNativeProjectAsync` 两个平台同一实现：原生目录已存在直接 return，
  不再 prebuild —— 所以「包装脚本先 prebuild」的理由在 Android 上完全成立。
- `expo run:android` 的构建类型开关是 `--variant <name>`（默认 `debug`），release 判定为
  `variant.toLowerCase().endsWith('release')`；`--device [device]` 是设备选择入口。
- 不带 `--device` 时 `AndroidDeviceManager.resolveAsync()` 直接取 `devices[0]`（不提示）；带 `--device`
  时走 `promptForDeviceAsync` 的 autocomplete 选择列表（列表内含未启动的 AVD）。
- 首次构建的 JDK/`ANDROID_HOME` 约束来自 FEATURE-542 探针实测（`docs/android-probe.md` §1）。

## Boundary

- 不改 `scripts/ios-run.sh` 与其测试；不改 `app.config.ts`（FEATURE-543 的产物）。
- 不改 `android/` 生成物；不动 `packages/*`。
- `more/settings/profile.tsx` 的相机入口问题不属本任务。

## Acceptance Criteria

- [x] `bash apps/mobile/scripts/android-run.test.sh` 通过；`ios-run.test.sh` 仍通过
- [x] 仓库根 `pnpm android:mobile:device:staging` 完成一次 install（见到 `Installing …app-debug.apk`，
      且 `adb shell pm list packages` 能查到 `ai.multica.mobile.staging`）
- [x] README Android 章节的命令与 `package.json` 实际脚本一一对应
- [x] `git diff` 中 `ios-run.sh` 无变化
