# FEATURE-558 · Android 阶段 5 收尾验收（研究目录）

本目录是这一轮**唯一一次设备会话**的全部材料：夹具、驱动脚本、假 runtime daemon、
一次跑的原始产物（`run/`）与定向重测产物（`rm-*.png` + `remeasure558.sh` 追加的结果行）。

本轮要收口的三件事（来源：issue FEATURE-558）：

1. 541 验收总纲第 2 条要求「真机」——本轮如实记录是否具备真机条件；
2. 551 因夹具缺失未覆盖的两项：**图片查看器**、**聊天发送后的状态机**；
3. 复验 FEATURE-559 的两处修复：断网恢复后时间线秒级刷新、WS 的 `client_os=android`。

---

## 1. 怎么跑（复现步骤）

前置：

```bash
# 后端（已在本机常驻）
docker ps --filter name=multica-probe542          # backend + postgres 两个容器
# 设备：模拟器 Medium_Phone_API_35（4 核 / 4G，见 §3「环境事实」）
adb devices
# 构建（一次）：Debug staging 变体，API 指向本地后端
#   JAVA_HOME=/opt/homebrew/opt/openjdk@21/...  ANDROID_HOME=~/Library/Android/sdk
#   EXPO_PUBLIC_API_URL=http://10.0.2.2:8090 pnpm android:mobile:staging
```

一次跑完（唯一入口；等待一律轮询）：

```bash
cd .trellis/tasks/09-19-android-final-acceptance/research
OUT="$PWD/run" bash acceptance558.sh      # 夹具复位 → C/K/B/V/E/M/D → C11 → 汇总
```

定向重测（只补判定源有缺陷的条目，见 §4）：

```bash
OUT="$PWD/run" bash remeasure558.sh       # 结果追加进同一个 run/results.tsv
```

产物：

| 文件 | 内容 |
|---|---|
| `run/results.tsv` | 编号 ⇥ 判定 ⇥ 说明（人读结论的原始表） |
| `run/summary.txt` | 设备 / 构建 / 判定计数汇总 |
| `run/env.txt`、`run/env-extra.txt` | 设备型号、Android 版本、包名、是否接真机 |
| `run/*.png` | 每条判定对应的截图（命名与 551 一致，便于对照） |
| `run/state.log` | 键盘避让（K 组）的逐次观测 |
| `run/d2-timing.txt` | 断网恢复的实测时延 |
| `run/d4-*.txt` | 后端 WS/HTTP 日志中 `client_os` 的取证 |
| `run/c8-task-snapshot.txt` | 聊天任务的库侧终态（assistant 消息条数、失败原因） |
| `run/fake-daemon*.log` | 假 runtime 的逐条请求日志 |

---

## 2. 与 551 的差异（本目录相对 `09-19-android-full-regression/research/`）

| 文件 | 关系 |
|---|---|
| `lib558.sh` | 551 `lib551.sh` 的副本 + 3 处改动：dump 路径、`double_tap_xy` / `image_block_bounds` / `png_diff_ratio` 三个新原语、`texts_re` 正则匹配、ANR 兜底 |
| `groups-core558.sh` | 551 `groups-core.sh` 的副本；**C8 段重写**：待发 / 运行中 / 完成 / 失败四态（`C8b`–`C8e`） |
| `acceptance558.sh` | 551 `acceptance.sh` 的副本；**B5 段重写**（图片查看器 6 条）、**D 组加 D4/D4b**、夹具准备加图片与 daemon、main 加汇总 |
| `seed-fixtures.sql` | 551 夹具 + §11 图片夹具（专用 issue + 2 条 attachment）+ §12 聊天 runtime 绑定与 daemon 预期 + 会话复位 |
| `make-fixture-images.py` | 生成两张棋盘格夹具图（PIL，确定性） |
| `fake-daemon.py` / `fake-daemon.md` | 假 runtime daemon：注册 / 心跳 / 认领 / start / messages / complete（或 fail），支持运行中切模式（success / fail / pending） |
| `remeasure558.sh` | 定向重测（551 的 `remeasure.sh` 口径） |
| `driving-plan*.md` | 551 的驱动计划，原样带入（选择器与夹具口径仍适用，未改） |

---

## 3. 环境事实（本轮记录）

- 设备：**模拟器** `Medium_Phone_API_35`（`sdk_gphone64_arm64`，Android 15 / API 35，1080×2400 @420dpi，arm64-v8a）。
  **本机没有真机接入**（`adb devices` 只有 `emulator-5554`），`run/env-extra.txt` 有 `real_device_count=0` 的现场记录。
- 构建：**Release**（`pnpm android:dist:staging` + `EXPO_PUBLIC_API_URL=http://10.0.2.2:8090`；内嵌 JS、不连 Metro）
  · `multica-mobile-staging-0.1.0-vc1.apk` · sha256 `2d47369724c6b2b1b4d5889a26f254d8d61499dd4bb0c340ee466ef4c93fa261`
  · 会话内一次构建 + 一次覆盖安装（Debug / Release 同 id 不同签名，装前先卸）。
- 后端：本地 compose 栈 `multica-probe542`（`127.0.0.1:8090`，模拟器经 `10.0.2.2:8090`）。
- 登录：`probe551@example.com` + 开发验证码 `888888`。

**环境侧两处坑（都会毁掉整轮验收，已记在此处备查）**：

1. **expo dev-client 的 Tools 悬浮球默认叠在右上角**，正是 issue 详情页 ⋯（`Issue actions`）的位置：
   点 ⋯ 会打开 dev menu 而不是应用的 action sheet（主跑 C5d 的截图就是 dev menu）。
   处理：把悬浮球拖到左下角（长按拖动），或在 dev menu 里关掉 `Tools button`。
2. **`/auth/send-code` 有频率限制**（实测 5 次/分钟）。假 daemon 启动时要登录一次，
   若与应用登录同秒发生，应用那次会拿到 **429**，登录页显示「Couldn't send the code」。
   处理：daemon 改到**应用登录完成之后**（C8 之前）启动，并复用 `.fake-token` 缓存。

3. **Release 变体默认禁明文 HTTP**（Android 9+），而本地验收后端是 `http://10.0.2.2:8090`：
   首跑时登录页点 `Send code` 后停在原页，`logcat` 只有 `[api] → POST /auth/send-code`、
   后端命中 **0** 次（详见 `.trellis/spec/mobile/frontend/android-platform.md`）。
   处理：`app.config.ts` 的非生产构建 `usesCleartextTraffic: !isProd`（本轮改的就是这一处产品配置）。
4. **`uiautomator dump` 会在「界面永不 idle」的页面上挂住**：实测在 PROB-1 详情页卡了 **11 分钟**，
   设备侧 uiautomator 停在 `__arm64_sys_nanosleep`，本地 adb 与整轮验收一起僵住、没有任何日志。
   处理：`lib558.sh` 的 `_dump_bounded` 给每次尝试加 `DUMP_TIMEOUT_SECS=8` 上限，
   到点杀本地客户端 + 设备侧 uiautomator 再重试（健康路径只多 ~0.1s）。
5. **上一轮留下的登录态会让核心流程起点不对**（C1 会被跳过）：`main()` 在跑 `core` 前
   `pm clear "$PKG"` 复位到首次安装后的状态。

---

## 4. 判定口径与重测的边界

- 每组判据的原始来源仍是 551 的 `driving-plan*.md`；本轮只改**判定实现**，不改验收项本身。
- `run/results.tsv` 是主跑原始表。主跑里判 `fail`/`blocked` 的条目，只有在
  **判定源本身有缺陷**（判据词写错、等待偏紧、dump 覆盖限制、环境遮挡）时才进
  `remeasure558.sh` 重测，重测结果同样写回 `results.tsv`（编号相同，说明里标「重测」）。
- **截图判定**（与 551 同口径）：评论/长文档类页面，原生 markdown 视图的文本节点不进
  `uiautomator` 树，这一条只能看截图；脚本负责把内容滚进视口并留图。
- 真机 / 模拟器的边界：本轮全部结论来自**模拟器**，与 551 相同；真机项如实标注，不冒充。
- **V1 判据修正（2026-09-19）**：V1 原来是**空判据**。`icons` 里的 `My Issues` 带空格，
  `printf '%s\n' $icons` 会把它拆成 `My` 与 `Issues=x` 两个词，事后 `sed 's/.*=//' | sort -g`
  取到的是字符串 `My`；awk 拿字符串跟数字比会退化成字符串比较（`"My" > "0.01"` 为真），
  于是「只要四个 tab 标签在就恒 pass」——两次运行里四个图标 ink 全为 0.0 也判 pass。
  已改成循环内按数值取最小（`acceptance558.sh` 的 `v_group`）。**因此旧 run 里的 V1 pass
  无效，本项必须在下一次设备会话重判。**
- **本轮其余判定源修正（都是"脚本/判据的问题"，不是产品问题）**：
  - `C4b` 判据词用了 `PRB-2`（那是收件箱行正文）与子串 `长文档性能夹具` —— `any_text` 是**整值相等**，
    而界面上的 identifier 是 `PROB-2`、标题是 `PROB 长文档性能夹具`，于是详情页明明渲染好了也判 fail
    （两轮都踩到）。已改成界面真实文本。
  - `on_issue_detail`（详情页等待判据）原来只认 `Activity` 与 PROB-1 的标题：从收件箱打开 PROB-2 时
    必然等满 45 次 ≈ 90s（新加的等待进度行暴露的）。已改成 `. ⋯ 按钮（Issue actions）在任意详情页都有`。
  - `C5e` 长按评论：旧版无条件滚 25 次把评论推出视口，`long_press_text` 取不到 bounds 直接失败，
    而且**失败分支没有截图**。已改成有界滚动 12 次 + 长按前后都截图。
  - `C5c` 滚动从 25 次收到 8 次，判 `blocked`（以截图人工复核）——见 §4 的"截图判定"口径。
  - `C6c` / `C7c` 的 picker 路由按用户 2026-09-19 的决定**抽样 2 个**（status / priority），
    其余路由沿用 551 结论；判定说明里写明抽样口径。

---

## 5. 提速：分片入口 + 快速档 + 可见化

主跑一轮 70+ 条判据的墙钟是 1 小时上下，大头不是设备慢，而是**失败条目要等满超时**：
等待上限写在判定源里（`wait_for` 20/45/60 次轮询 ≈ 40/90/120s），主跑 16 条 fail/blocked
光等超时就 15~25 分钟。2026-09-19 用户反馈「每次都卡在某个页面很久、不知道在等啥」，
当轮实测出来的时间账：

| 现象 | 实测 | 出处 |
|---|---|---|
| 盲等（裸 `sleep`） | **280s / 72 处**（`acceptance558.sh` + `lib558.sh`） | `grep -oE '\bsleep [0-9.]+'` 求和 |
| 单次 dump | 1.8~2.0s，而判据普遍「一次判断一次 dump」 | `run/summary.txt` 的 dump 次数/跨度 |
| 一次运行里最长的单块停顿 | **28.6 分钟**（V 组：冷启动 + 深浅主题各切一遍） | `run/*` 产物 mtime 相邻差 |
| 次长三块 | 15.7 分钟（D1 picker 深链）、12.0 分钟（B3 picker）、7.5 分钟（C6 属性选择器） | 同上 |
| 整轮被外层时限截断 | 2 次（1 小时上限） | `run-vem-interrupted.log` |

### 5.1 分片入口 `chunked558.sh`（推荐默认入口）

```bash
OUT=$PWD/run bash chunked558.sh               # 全部分组逐片跑，默认 ACCEPT_FAST=1
GROUPS="v,e" OUT=$PWD/run bash chunked558.sh  # 只跑指定分组（重查失败项，分钟级）
APPEND=1 OUT=$PWD/run bash chunked558.sh      # 追加，不清空已有结果
```

**每个分组一个进程**，各自远低于 1 小时上限：被截断最多丢一片，其余分组的结论已经在
`results.tsv` 里；每片打印 `┌─ 分片 v 起跑…` / `└─ 分片 v 结束，用时 Ns`。
（`continue558.sh` 仍在，用于「主跑被杀后手工接着跑」；分片入口是**从一开始**就不依赖上一次死在哪。）

### 5.2 快速档（`ACCEPT_FAST=1` / `fast558.sh`）

同一套判据的快速档，只改「等多久」，不改判据：

| 项 | 默认 | `ACCEPT_FAST=1` |
|---|---|---|
| 手势后的等待上限 | 判定源原值（20 次 ≈ 40s） | 8 次 ≈ 16s（可用 `ACCEPT_FAST_TRIES` 覆盖） |
| 判定源显式长等待（>20 次，如 issue 首屏 45 次 ≈ 90s） | 原值 | 原值（不收紧，避免把首屏慢渲染误判成 fail） |
| ANR / 系统无响应对话框 | 等满上限 | 第 4 次轮询起检测到就收手，记 `run/fast-abort.log` |

纪律：快速档只用于**复验与收尾**；新增判定或口径变更仍以默认档为准。同一分组分别用
开/不开 FAST 各跑一次，逐条比对 `results.tsv`，判定必须一致、只允许耗时不同；一旦出现差异，
以未开 FAST 的那次为准，并把该条当判定源缺陷去修判据。

### 5.3 可见化：慢在哪、在等什么，不再靠猜

| 产物 / 行 | 内容 |
|---|---|
| `WAIT  12s 等 has_text My Issues（第 6/20 次仍未命中）` | 等待进度：第 4 次轮询仍未命中起，每 10s 一行（`WAIT_TRACE` / `WAIT_TRACE_AFTER` / `WAIT_TRACE_EVERY` 可调，`WAIT_TRACE=0` 关） |
| `WAITTMO 40s has_text Continue 未命中（20 次轮询用满）` | 超时归因：这条判据的时间花在等哪个条件上 |
| `SLOW   C6b 用了 132s（本条判定 + 它自己的等待）` | 单条判定超过 `CHECK_SLOW_SECS`（默认 60s）就地报一行 |
| `run/timings.tsv`：编号 ⇥ 判定 ⇥ 秒 | 逐条耗时；`summary.txt` 里给「最慢 10 条」与合计 |
| `GROUP  m 用时 213s` / `└─ 分片 d 结束，用时 640s` | 分组级与分片级计时 |

等待进度行刻意不以 `[` 开头：`[pass]/[fail]` 是判定行的专属前缀，结果展示走 `grep -E '^\['`，
混进去会让「等待」和「结论」在日志里分不开。

### 5.4 Tier 1 冒烟门禁（`smoke558.sh` + `snapshot558.sh`，2026-09-19 定）

完整矩阵（Tier 2，68 条）单设备下限 ~40 分钟，不适合每次改动都跑。冒烟集是它的**子集**
（判据实现只有一处：`groups-core558.sh` 的 `smoke_set()`），8 条：S1 收件箱 · S2 详情+chip ·
S3 picker→BACK · S4 评论框键盘避让 · S5 edge-to-edge · S6 聊天完成（库侧断言）·
S7 `client_os`（后端日志断言）· S8 启动屏帧。

```bash
bash snapshot558.sh load     # 6.2s 进入「已装 Release 包 + 已登录」的快照态
bash smoke558.sh             # 8 条冒烟；退出码 0=全过 / 1=有 fail / 2=前置不满足
```

实测（Release staging 包，模拟器 `Medium_Phone_API_35`）：

| 场景 | 用时 | 结果 |
|---|---|---|
| 冷态（新装包，含驱动登录） | **3 分 48 秒** | 7/8（S8 当时还是精确色判据，见下） |
| 快照态（`load` 6.2s + 已登录） | **2 分 39 秒** | **8/8 通过** |
| 单条耗时（快照态） | S1 21s · S2 16s · S3 21s · S4 32s · S5 23s · S6 38s · S7 0s · S8 8s | — |

三个让它能压进 5 分钟的取舍，都写清了原因：

1. **直达路由用深链**（`goto`），不用 `reset_to_tab_root` 的 BACK 循环 —— 实测 S1 从 92s 降到 21s。
2. **能落库侧/日志的判据不点界面**：S6 判 `agent_task_queue.status`、S7 数后端日志里的
   `client_os=android`，0~1 秒出结论；也比读聊天页的无障碍树可靠（那一页 pill 在动画，
   取树次次等满上限）。
3. **S8 的启动屏判定在 Tier 1 用「深蓝底」容差**：Android 12+ 的 splash 有缩放/淡入过渡，
   首帧采样实测是 `15,14,24` 而不是精确 `17,24,39`；Tier 1 接受「三通道都暗且偏蓝」，
   Tier 2 的 V2 仍求精确 `#111827`。白/灰/浅色一律不算。

纪律：冒烟**不得**为了通过而放宽判据 —— 把 68 条压成 8 条是「挑子集」，不是「改判据」。
Tier 2 每阶段一次，且**须先取得明确授权**。
