# FEATURE-562c 后台收不到通知：Android 不再暂停 WS

## Goal

真机实测（小米澎湃 OS 3，vc2）：**前台通知正常，切后台收不到，App 已被确认没被杀。**
本任务定位并修掉这个后台投递缺陷，重新交付可安装包。

## 已核实事实（读代码定位，非猜测）

- 通知链路本身已被前台验证：权限、`inbox` 渠道、payload、mute gate、handler 都工作。
- 缺陷在**实时层的生命周期**：`data/realtime/realtime-provider.tsx` 的 AppState 监听里
  `AppState === "background"` → `ws.pause()`；`WSClient.pause()`（`data/realtime/ws-client.ts:155`）
  会 `teardownSocket()` 并清掉心跳 —— **socket 被主动关闭**。
- 这段逻辑的注释写明动机是 iOS（"iOS will kill it anyway; clean close avoids a kernel-level reset on resume"），
  当年 App 没有通知功能，暂停零代价。
- 而本机通知的**唯一**事件源就是这条 WS 的 `inbox:new` 帧（`use-inbox-realtime` → `notifyNewInboxItem`）：
  切后台停 socket = 切后台关掉通知功能。与需求「App 在前台或后台存活时收到 WS 事件就弹横幅」直接冲突，
  也与「App 没被杀却收不到」的现象完全一致。

## Requirements

1. **Android 不在后台暂停 WS**；iOS 保持原行为不变（`Platform.OS !== "android"` 才 `pause()`）。
2. 前台恢复照旧 `resume()` + `forceReconnect()`：进程若被冻结，socket 可能已死，立刻重建比等心跳超时更稳。
3. 不改通知模块本身、不改服务端、不接 FCM；不动 iOS 行为。
4. 把该约定写回 `.trellis/spec/mobile/frontend/android-platform.md`（含「这两件事互斥」的说明与代价）。
5. 重新交付 Release APK（arm64-v8a，production，vc3）并给出文件名/大小/SHA-256/证书指纹/下载链接。

## Acceptance Criteria

- [x] `AppState === "background"` 分支仅在非 Android 平台调用 `ws.pause()`。
- [x] `pnpm --filter @multica/mobile typecheck` / `lint` / `test` 通过。
- [x] 文件顶部生命周期注释与实现一致（Android 保持连接的理由、代价、边界都写明）。
- [x] APK vc3 已构建并核实：仅 arm64-v8a、versionCode 3、签名证书与 vc1/vc2 相同、bundle 含通知相关字符串。
- [x] 合并进 `main` 并以 GitHub Release 交付。

## 边界（写给后续）

- 本任务**不能**用静态检查证明后台横幅恢复：该分支无法在 Node 单测里覆盖（provider 依赖 react-native），
  也没有起模拟器。结论必须由真机复测得出，前台正常不作为通过依据。
- 进程被系统冻结/回收后仍收不到（方案 A 固有边界）；国产 ROM 需要用户允许后台运行/自启动。
- 若将来为省电要在 Android 后台暂停 WS，等同于取消「后台通知」需求，二者不可兼得。
