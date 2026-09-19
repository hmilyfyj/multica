# FEATURE-562d 后台诊断：构建号 + 实时数据到达时间

## Goal

真机反馈（vc3）：**前台正常，后台仍不弹；且收件箱要回到前台才刷新出新回复**——说明后台期间**根本没有实时数据到达**，
通知只是症状。本任务补两条能在 App 内直接读到的事实，把「事件没到（进程被冻结）」与「事件到了但手机丢弃」
彻底分开，并让「装的是哪个包」不再靠猜。

## 已核实事实

- 之前几轮排查反复卡在没有可观测证据：用户只能报「没通知」，而两种原因的处理方式完全不同。
- `realtime-provider.tsx` 已在后台不再暂停 socket（vc3），但仍收不到 → 需要区分「传输被冻结」与「通知被丢弃」。
- 用户报告的「回到前台才刷新」本身已指向传输侧，但需要一个**可当场复现读数**的入口，而不是靠推断。

## Requirements

1. `lib/ws-activity.ts`：记录最近一次收到 WS 帧的时间（模块级，由 `realtime-provider` 用 `ws.onAny` 写入），
   设置页读取；不引入订阅生命周期问题（写方常驻、读方按需）。
2. 设置页「On this device」增加两行：
   - `Last realtime data 3m ago` / `No realtime data since the app started.`
   - `App build 0.1.0 (vc4)`（`Constants.nativeAppVersion` / `nativeBuildVersion`，bare release 下取自安装包）
3. 判据写进 spec：后台待几分钟再回设置页，若时间停在切后台之前 → 进程被冻结（方案 A 边界）；
   若刚刚还在更新 → 事件到了、问题在通知侧。
4. 不改后端、不接 FCM、不动 iOS；原有通知行为不变。
5. 交付 vc4 Release APK。

## Acceptance Criteria

- [x] `pnpm --filter @multica/mobile typecheck` / `lint` / `test` 通过。
- [x] 设置页可读出「最近收到实时数据的时间」与「当前构建号」。
- [x] APK vc4 已构建并核实：仅 arm64-v8a、versionCode 4、签名证书与 vc1–vc3 相同、bundle 含新增文案。
- [x] 判据写回 `.trellis/spec/mobile/frontend/android-platform.md`。
- [x] 合并进 `main` 并以 GitHub Release 交付。

## 边界

- 新增诊断的**写入方在 RN 侧**（`ws.onAny`），Node 单测无法覆盖该订阅；本次仅保证读取/格式化的行为正确性由类型与真机读数验证。
- 诊断本身不修复后台冻结；若读数确认是冻结，下一步要么让用户允许后台运行，要么上前台服务 / FCM（需产品决策）。
