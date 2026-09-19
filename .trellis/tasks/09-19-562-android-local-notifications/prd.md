# FEATURE-562 Android 本机通知（方案 A）：收通知弹横幅，不动后端

## Goal

Android 端「本机通知」：App 收到 `inbox:new` WS 事件时弹一条系统横幅，点横幅深链到对应 issue / 收件箱条目。
**不动后端、不接 FCM、不做 iOS。**

用户决策（2026-09-19）：`走 A，iOS 不管。`

方案 A 的固有边界（不是缺陷，必须写进代码注释与交付结论）：通知由 App 进程内的 WS 连接产生，
App 被系统杀掉或被回收后收不到；这与「锁屏推送」不是一回事，升级到完整推送需要 Firebase + 后端改造。

## 已核实事实（读代码所得，基线 `origin/main@3fd34cc21`）

- 共享层的 decision point 是 `packages/core/realtime/use-realtime-sync.ts` 的 `handleInboxNew()`：
  `issueKey = item.issue_id ?? item.id`、`title = item.title`、`body = item.body ?? ""`，
  gate 顺序为「焦点检查 → 源 workspace 的 `system_notifications` 偏好 → 载荷 → desktopAPI/web banner」。
  `apps/desktop/src/main/index.ts` 的 `notification:show` IPC 用 Electron `new Notification` 渲染横幅，
  并用 `NotificationGate` 按 `itemId` 去重、`payload.itemId` 在点击时触发 `inbox:open`。
- **mobile 不复用该 hook**：`apps/mobile/data/realtime/` 是 mobile 自有的实时层，
  `use-inbox-realtime.ts` 用 `ws.on("inbox:new", invalidate)` 刷新 inbox 列表与未读汇总。
  所以 mobile 的落点是这条订阅里补一个通知分支，而不是改 `packages/core`。
- mobile 的 WS 是**按当前 workspace 建连**的（`ws-client` 在升级 URL 上带 `workspace_slug`，
  `realtime-provider.tsx` 由路由同步的 store 提供 slug），服务端只推该 workspace 的事件；
  因此 `inbox:new` 的来源 workspace 就是当前 workspace，不存在 web 那个「事件来自 A、激活的是 B」的错配问题（#3766）。
- 偏好读取用 `notificationPreferenceOptions(wsId)`；`qc.ensureQueryData` 在 v5 里**有缓存直接返回、不按 staleTime 重取**
  （`queryClient.js:75-86`），所以事件路径上不会每个事件都打一次网络。
- `expo-notifications@55.0.27`：`trigger: { channelId }` 在 Android 解析为立即展示的 `channel` trigger
  （`src/utils/parseNotificationTrigger.ts` 末尾）；`identifier` 会成为 Android 的通知 tag
  （`ExpoPresentationDelegate.presentNotification` → `notify(identifier, …)`），同 id 覆盖上一条，
  与 web banner 的 `tag: itemId` 语义一致。
- Android 8+ 必须先建 channel；指定的 channel 不存在时会回退到库自带 fallback channel
  （`BaseNotificationBuilder.channelId`），不会崩、也不会丢通知。
- 前台横幅：`setNotificationHandler` 返回 `shouldShowBanner/shouldShowList` 才会展示；
  Android 上 `shouldPlaySound: false` 按官方注释会**不弹横幅**，因此前台 handler 需给 `shouldPlaySound: true`。
- `apps/mobile/vitest.config.ts` 是 Node 环境、只跑 `lib/**` + `data/**` 的 `.ts`，
  **不能加载 RN 原生模块** → 被单测覆盖的模块不得 `import react-native`，平台判断放在 RN 侧调用点。

## Requirements

1. 依赖用 `pnpm exec expo install expo-notifications` 装（SDK 对齐版本，`~55.0.27`）。
2. Android 通知渠道：bootstrap 时 `setNotificationChannelAsync` 建「Inbox」渠道，重要性 HIGH（可弹横幅）。
3. 权限（Android 13+ `POST_NOTIFICATIONS`）：
   - **不在冷启动弹**；唯一入口是 `设置 → 通知` 页的「System notifications（this device）」区：
     显示当前授权状态，未授权时提供「Turn on」按钮触发系统弹窗，被永久拒绝时引导到系统设置页。
   - 被拒绝时其它功能照常；不重复弹窗、不骚扰。
4. 触发点：`use-inbox-realtime.ts` 的 `inbox:new` 分支（Android 才走通知），
   载荷复用共享层语义（`slug` / `itemId` / `issueId` / 标题 / 正文），不另起一套文案逻辑。
   - `system_notifications === "muted"` 时不弹（读的是当前 workspace 的偏好）。
5. 前台也弹（用 `setNotificationHandler` 控制，便于真机自测），行为写进代码注释。
6. 点击通知：`markInboxRead(itemId)`（沿用收件箱行点击语义）后深链到
   issue 页（有 `issueId` 时）或 `inbox/[id]` sheet；`slug` 为空时整条 no-op（与共享层一致）。
7. iOS 完全不动：整条链路在 Android 之外不注册、不展示、不路由。
8. 边界写进代码注释与文档：App 被杀/被回收后收不到；不是锁屏推送。

## Acceptance Criteria

- [ ] `pnpm --filter @multica/mobile typecheck` / `lint` / `test` 通过。
- [ ] 单测覆盖两条分支（mock `expo-notifications`）：收到 `inbox:new` → 调 `scheduleNotificationAsync`；
      `system_notifications: "muted"` → 不调。
- [ ] 载荷往返：构建出的载荷写进通知 `data` 后能被读回并校验（未知/残缺 data 返回 null）。
- [ ] 交付真机自测 APK：arm64-v8a、production 变体，参数与 2026-09-19 那次一致；
      结论给出文件名、大小、SHA-256、签名证书指纹与下载链接。
- [ ] 真机自测清单：首次授权弹窗、前台收通知、切后台再收、点击跳转、mute 后不再弹、App 划掉后收不到（预期）。
- [ ] 合并进 `main`（squash），issue 置 `done`。

## Boundaries

- 不接 FCM、不加设备 token、不改 Go 后端、不改 `packages/core`。
- iOS 不改行为（通知链路只在 Android 生效；不新增 iOS 权限文案）。
- 本任务不自行启动模拟器/设备验证（用户已明确不想再起模拟器）；设备侧验收走真机自测包。
- 新发现的平台约束写回 `.trellis/spec/mobile/frontend/android-platform.md`。

## Notes

- 基线：`origin/main@3fd34cc21`；分支 `feature/562-android-local-notifications`；MR 目标 `main`。
