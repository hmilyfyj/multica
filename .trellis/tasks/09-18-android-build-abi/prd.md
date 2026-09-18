# FEATURE-550 Android 构建提速：按目标设备收敛 ABI

## Goal

把 Android **调试构建**的原生 ABI 从 prebuild 模板默认的四套（`armeabi-v7a,arm64-v8a,x86,x86_64`）
收敛到构建目标实际运行的那一套，减少原生编译时间、APK 体积与 `adb install` 等待；
release 分发构建与调用方显式指定的 ABI 保持原样。

来源：FEATURE-550 issue 评论「为何会访问那么多次模拟器，等待好久速度好慢，有啥优化办法吗」。

## Verified Facts（本轮实测）

| 事实 | 证据 |
|---|---|
| 模板默认构建四套 ABI | `apps/mobile/android/gradle.properties:31`（prebuild 生成物）`reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64` |
| 本机模拟器只需 arm64-v8a | `~/.android/avd/Medium_Phone*/config.ini` → `abi.type = arm64-v8a`；`adb shell getprop ro.product.cpu.abi` → `arm64-v8a` |
| 编译型原生模块按 ABI 成倍编译 | `:react-native-worklets:buildCMakeDebug[abi]` + `:react-native-reanimated:buildCMakeDebug[abi]` 冷编译：**单 ABI 79s / 四 ABI 187s**（`~/workspace/multica.worktrees/FEATURE-550`，JDK 21） |
| debug APK 体积 | 四 ABI **245MB**（`lib/` 内 4×29 个 `.so`）→ 单 ABI **87MB** |
| `adb install -r` | 四 ABI **38.7s** → 单 ABI **2.9s**（同一模拟器，`Medium_Phone_API_35`） |
| 空转构建的固定成本 | 全 up-to-date 的 `:app:assembleDebug` 仍 **58s**（含四 ABI 的任务图/配置） |
| 其它按 ABI 重复的产物 | `react-native-screens/android/build` 727M、worklets/reanimated 各 1.2G（每个 worktree 各一份） |

## Requirements

1. `android-run.sh` 在 **debug** 构建里默认收敛 ABI：
   - 有已连接设备（`adb devices` 状态为 `device`）→ 取各设备 `ro.product.cpu.abi` 的并集；
   - 无已连接设备 → 回退宿主架构映射（`arm64`→`arm64-v8a`，`x86_64`→`x86_64`），并在 stderr 说明；
   - 传递方式只走 Gradle 项目属性（`ORG_GRADLE_PROJECT_reactNativeArchitectures`），不修改 `android/` 生成物。
2. 参数含 `--variant release` 时不收敛（分发链路需要全 ABI）。
3. 显式覆盖优先：`MULTICA_ANDROID_ABIS=<abi[,abi]>` 指定集合，`all` 关闭收敛；
   调用方已设 `ORG_GRADLE_PROJECT_reactNativeArchitectures` 时不覆盖。
4. 收敛生效时 stderr 打一行说明（值 + 关闭方式）。
5. `JAVA_HOME` 的 `java` 主版本不是 21 时打一行提示——本机 `java_home -v 21` 实测解析到 JDK 25，
   会让原生 `configureCMakeDebug` 失败（只提示，不中止）。
6. `android-run.test.sh` 覆盖 ABI 分支；`README.md` Android 章节与
   `.trellis/spec/mobile/frontend/android-platform.md` 记录行为、实测数字与开关。

## Boundary

- 不改 `scripts/ios-run.sh` 与其测试、不改 `app.config.ts`、不手改 `android/` 生成物、不动业务代码。
- 保留「每次运行都 prebuild」的既有前提与 `APP_ENV` 透传语义。
- 不改 release 构建的 ABI 集合，不改 `--device` / `--variant` 的转发语义。

## Acceptance Criteria

- [x] `bash apps/mobile/scripts/android-run.test.sh` 与 `bash apps/mobile/scripts/ios-run.test.sh` 通过
- [x] 真实构建：debug 包装脚本跑完，APK `lib/` 内只剩目标设备 ABI
- [x] `--variant release` 路径不设置 `ORG_GRADLE_PROJECT_reactNativeArchitectures`
- [x] `MULTICA_ANDROID_ABIS=all` 恢复模板默认
- [x] README 与 spec 记录行为、实测数字与关闭方式
