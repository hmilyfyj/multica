# FEATURE-562e 后台会话取证：冻结 vs 静默

## Goal

用户最新反馈：澎湃 OS、**已设省电策略为无限制**、**确认 App 未被杀掉**，但后台仍收不到数据（收件箱要回前台才刷新）。
用户要求「想办法确认一下原因」。本任务把原因做成 App 自己能读出来的数字，并给出判定结论行。

## 已核实事实

- 应用侧已无「主动断连」：vc3 起 `realtime-provider` 不再在 Android 后台 `pause()`；全仓 AppState 消费者已逐个核对
  （`_layout.tsx` / `query-client.ts` / `realtime-provider.tsx` / `settings/notifications.tsx` / `shiki.ts` / `use-agent-presence.ts`），
  除该 provider 外没有任何一处在后台停 socket。
- 因此后台收不到只剩两种机制：**进程被系统冻结**（Android 冻结 *cached* 进程，与省电策略不是同一个开关；
  被冻结时内存全在、回前台秒恢复，所以「没被杀」≠「有运行」），或**进程在跑但数据/网络没到**。
- 两种机制的处理完全不同（前者只能上前台服务/推送；后者查连接），必须能在设备上当场区分。

## Requirements

1. `lib/background-forensics.ts`：记录后台会话（起止时间、JS 心跳次数、WS 帧数、HTTP 探针成功/失败），
   为纯逻辑模块（不 import react-native），可单测。
2. `_layout.tsx`：两个常驻定时器——15s JS 心跳、60s 后台 HTTP 探针（仅后台会话内真正发请求）。
3. `realtime-provider.tsx`：帧计数接进现有 `ws.onAny`。
4. 设置页「On this device」给出结论行，例如
   `Background 12m · JS ran 48× · frames 0 · probe 12/12 ok → the app ran, but no realtime data arrived`。
5. 判定与平台结论写回 spec：省电策略 ≠ 冻结豁免；普通应用做不到后台持续收事件。
6. 交付 vc5 Release APK（arm64-v8a、production），给出文件名/大小/SHA-256/证书指纹/下载链接。

## Acceptance Criteria

- [x] `pnpm --filter @multica/mobile typecheck` / `lint` / `test` 通过（新增 6 例取证单测）。
- [x] 单测覆盖：会话只在后台期间计数（前台 tick / 回前台后的 tick 都不计入）、帧计数同理、再次进后台开新会话、
      探针成功与失败分别记录、非后台会话不发探针。
- [x] 设置页可读出结论行；构建号在一行内可确认（vc5）。
- [x] APK vc5 已构建并核实：仅 arm64-v8a、versionCode 5、签名证书与 vc1–vc4 相同、bundle 含新文案。
- [x] 合并进 `main` 并以 GitHub Release 交付。

## 边界

- 本任务只做「确认原因」与可观测性，**不改后台投递机制**；是否上前台服务/厂商推送需用户决策（已在评估里给过选项）。
- 取证读数仍由真机产生：本任务不起模拟器，也不能用单测代替真机结论。
