# FEATURE-562b 本机通知真机缺陷：小米澎湃 OS 收不到通知

## Goal

FEATURE-562 的首版（vc1，`main@0698402c8`）交付后，用户在**小米澎湃 OS 3** 上实测「没有任何通知」。
本任务定位失败点、补上让用户能自己看出原因的入口，并重新交付可安装的 Release APK。

## 已核实事实

链路本身无误（静态核对，非猜测）：

- APK 的 `classes3.dex` 里确实打进了 `expo-notifications` 原生模块（`expo/modules/notifications` 441 处引用，
  含 `ExpoNotificationsEmitter` / `ExpoNotificationScheduler`），autolinking 正常。
- `trigger: { channelId }` 在 Android 走的是立即展示路径：`ExpoSchedulingDelegate.scheduleNotification` 里
  `ChannelAwareTrigger → NotificationsService.receive(...)`，不会被「非可调度 trigger」拒绝。
- 服务端 `inbox:new` 的载荷是 `{ item: {...} }`（`server/cmd/server/autopilot_failure_monitor_test.go:139`），
  与 mobile 读取的 `payload.item` 一致；`notifyDirect` 只在「接收者==操作者」时跳过。

也就是说，失败点落在**手机侧三处 App 内部看不见的状态**：

1. **权限/应用级开关**：未授权时投递被系统静默丢弃；且应用级通知总开关关闭时，
   `getPermissionsAsync()` 也返回 `denied`（`NotificationPermissionsModule.kt`：`!areNotificationsEnabled() → DENIED`），
   而 `canAskAgain` 仍为 true —— 原实现按 `canAskAgain` 决定按钮文案，会把用户引到「点了没反应」的死路。
2. **渠道被单独关掉**：用户只关 `inbox` 渠道时，投递到该渠道的横幅全部被丢弃，App 内毫无提示。
3. **进程被冻结**：澎湃/MIUI 对后台缓存进程冻结比 AOSP 激进，App 没被划掉也可能断 WS —— 方案 A 的固有边界。

另外原实现的申请入口只有设置页一处，装完不看设置就永远不申请，属于交付缺陷。

## Requirements

1. **一次性申请**：首次进入收件箱时申请一次通知权限（`lib/inbox-notification-prompt.ts`，SecureStore 记录已问过；
   已授权则不申请；Android 本身也只弹一次），失败不骚扰、不影响其它功能。
2. **设置页自诊断**：在 `设置 → 通知 → On this device` 里显示
   - 系统通知状态，且按钮映射修正为：未授权且还能弹 → Turn on；请求后仍未授权 → 切到 Open settings 并给出说明；
   - `inbox` 渠道被关闭时的提示与引导；
   - **最近一次通知尝试**（`shown` / `skipped-permission` / `skipped-muted` / `failed`）翻译成人话。
3. **测试通知按钮**：走与真实事件**完全相同**的调用（`showInboxNotification`），当场区分
   「事件没到」「被 gate 拦住」「到了但手机丢掉了」。
4. 边界写进代码注释与 `.trellis/spec/mobile/frontend/android-platform.md`（含澎湃/MIUI 冻结后台、应用级开关即 denied）。
5. 不改后端、不接 FCM、不做 iOS；不改变已授权设备的行为。
6. 重新交付 Release APK（arm64-v8a，production，vc2），给出文件名/大小/SHA-256/证书指纹/下载链接。

## Acceptance Criteria

- [x] `pnpm --filter @multica/mobile typecheck` / `lint` / `test` 通过（新增 4 例诊断相关单测）。
- [x] 单测覆盖：未授权时「不投递且记录 `skipped-permission`」、投递成功记录 `shown`、渠道 `importance=NONE` 判为关闭、
      渠道不存在判为「未创建」而非「已关闭」。
- [x] 设置页在「请求后仍未授权」时把按钮切到 Open settings 并显示说明（不再出现点了没反应的死路）。
- [x] 赠送：首次进入收件箱的一次性权限申请（SecureStore 去重）。
- [x] APK vc2 已构建并核实：仅 arm64-v8a、versionCode 2、签名证书与 vc1 相同、bundle 内含测试通知与诊断字符串。
- [x] 合并进 `main` 并以 GitHub Release 交付。

## 结论 / 给用户的下一步

真机结果仍由用户在设备上确认（本任务不启动模拟器）。诊断路径：
安装 vc2 → 打开一次收件箱（应弹出系统授权框，选允许）→ 设置 → 通知 → 「On this device」
看 System notifications 是否为 On、Last attempt 显示什么 → 点「Send a test notification」。
测试横幅能出 = 手机与本 App 的通知链路正常，问题在事件/进程侧；测试横幅出不来 = 手机侧拦截（看该行提示与系统设置）。
