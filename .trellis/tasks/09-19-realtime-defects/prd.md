# 实时层缺陷：断网恢复不刷新 + Android client_os 上报

## Goal

修复 FEATURE-551 一次性验收挖到的两个实时层缺陷：断网恢复后 issue 时间线不刷新；Android 把 `client_os` 上报成 `ios`。

来源：FEATURE-559（阶段 5）。设备侧复验统一在收尾验收 FEATURE-558 做一次，本任务只做静态与单测。

## 已核实事实（读代码 / 读验收证据）

- 各 feature 的重连刷新钩子**已存在**：`use-issue-realtime.ts:240` 注册 `ws.onReconnect` → `invalidateIssueAfterReconnect`（detail / timeline / attachments / activeTasks / tasks）。所以「缺 invalidate」不是本次的落点，落点是**重连通知能否到达**。
- `ws-client.ts` 的 `onReconnect` 只在 `auth_ack` 到达且 `hasConnectedBefore` 为真时触发（`onAuthenticated`）。
- `ws-client.ts` 的心跳**只覆盖已认证的连接**（`startHeartbeat()` 在 `onAuthenticated` 里启动）；`onopen` 之后到 `auth_ack` 之间没有任何看门狗。后果：升级包成功但服务端不回 `auth_ack` 时，连接停在「OPEN 但未认证」状态——心跳不启动、没有任何定时器、也没有 `onclose`，客户端**永不重连**，也就永不发重连通知；只能靠重挂载页面恢复（与 551 §7.1 的现象一致）。
- 探测僵尸连接的时延上限 = `HEARTBEAT_INTERVAL_MS`(25s) + `HEARTBEAT_TIMEOUT_MS`(10s) = 35s，已超出验收要求的「恢复网络后 30 秒内刷新」；断网期间失败的拨号还会抬高退避档位（full jitter，ceiling 最高 30s），进一步把恢复推后。
- `client_os` 在 `ws-client.ts:207` 写死 `"ios"`（551 §8.1，后端日志 `client_platform=mobile ... client_os=ios`）。服务端只透传/记录该值，**取值集**见 `server/internal/handler/client_usage.go:178-182`：`macos | windows | linux | ios | android | chromeos`，其余归一为 `unknown`。`packages/core/api/ws-client.ts:97` 走 `identity.os`，是对的。
- `apps/mobile/vitest.config.ts` 只跑 Node 环境、`lib/**`+`data/**` 的 `.ts` 用例，明确不加载 RN 渲染器与 RN 原生模块 → **`ws-client.ts` 不能 import `react-native`**，平台值必须由调用方（provider）传入。
- `apps/mobile/AGENTS.md`「Realtime」：每个 feature 各自刷新自己的缓存，**禁止 global refetch sweep**；`apps/mobile/AGENTS.md`「Verification」要求 realtime 改动要能在重连后无需手动刷新跟上。

## Requirements

1. `client_os` 必须来自运行平台，不再写死；Android 上报 `android`，iOS 仍 `ios`（不改变 iOS / web 行为）。
2. 连接成功（含重连成功）必须是**可达**的状态：`onopen` 之后长时间收不到 `auth_ack` 要按连接失败处理，走既有的 jitter 退避重拨，不得无限期停在未认证 OPEN 状态。
3. 断网恢复后的自动刷新要在验收窗口（30s）内有确定上限：缩短应用层心跳的探测时延。
4. 保持既有架构与约定：不动 `packages/core` 共享层；不加全局 `invalidateQueries()` sweep；不重构实时层（各 feature 各自 `onReconnect` + updater 的现有形态不变）。

## Acceptance Criteria

- [ ] `WSClient` 的 dial URL 携带调用方给的 `client_os`；`clientOS: "android"` 时不再出现 `ios`。
- [ ] 单测：`onopen` 后无 `auth_ack` → 超过握手窗口后自动重拨（新 socket 实例出现）；`auth_ack` 到达后该看门狗被清除（不会误重拨）。
- [ ] 单测：重连通知触发 issue 详情 + 时间线缓存失效（`use-issue-realtime` 的 reconnect 契约）。
- [ ] 最坏情况的僵尸探测时延 < 30s（心跳 interval + timeout）。
- [ ] `pnpm --filter @multica/mobile typecheck` / `lint` / `test` 通过。
- [ ] 结论写清两处缺陷各自的复现步骤、修复说明与 FEATURE-558 的复验步骤（含 `adb` 断网/恢复与后端插评论的判据）。

## Boundaries

- 设备/模拟器验收不在本任务内（用户要求「一次性改完、一次性验收」，设备复验归 FEATURE-558）。
- 不同步改 `packages/core/api/ws-client.ts`（web/desktop 行为不变）。
- 不新增实时事件类型、不动 `WSEventType` / 协议。

## Notes

- 平台约束（客户端身份上报必须来自 `Platform.OS`，取值集以 `client_usage.go` 为准）写回 `.trellis/spec/mobile/frontend/android-platform.md`。
