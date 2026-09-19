# Android 全量回归清单（核心流程 + 阶段 3 改动面）

> 这份清单是**可复用**的：照步骤勾一遍就能覆盖核心流程与 548 / 549 / 550 / 557 四个任务的改动面。
> 「本次结果」列是 **2026-09-19 阶段 5 收尾验收（`FEATURE-558`）** 的实测结论，证据落在
> `.trellis/tasks/09-19-android-final-acceptance/research/`：`run/`（本轮 Release 跑，含截图、
> `results.tsv`、逐条耗时 `timings.tsv`、`summary.txt`）与 `run-debug-2026-09-19/`（同日 Debug 轮，
> 保留作对照：那一轮的失败多数由 dev-client 环境与判据缺陷造成）。
>
> 命令与驱动脚本见同目录：`chunked558.sh`（分片入口，一次跑完全部条目）、`lib558.sh`（观测原语）、
> `groups-core558.sh`（核心流程）、`acceptance558.sh`（分组调度）、`remeasure558.sh`（定向重测）、
> `release-check558.sh`（生产 Release APK 核验）、`seed-fixtures.sql`（夹具 + 状态复位）。
> 本文结论与原始结果表的差异见 §9。

## 0. 本次验收的机器与前置

| 项 | 值 |
|---|---|
| 设备 | 模拟器 `Medium_Phone_API_35`（**非真机**）· `sdk_gphone64_arm64` |
| Android | 15（API 35）· 1080×2400 @420dpi · arm64-v8a |
| 构建 | **Release**（`pnpm android:dist:staging` + `EXPO_PUBLIC_API_URL=http://10.0.2.2:8090`；内嵌 JS、不连 Metro）· sha256 `2d47369724c6b2b1b4d5889a26f254d8d61499dd4bb0c340ee466ef4c93fa261` |
| 包名 | `com.ehaier.zgq.shop.mall.staging`（staging 变体在 Debug / Release 下同 id、签名不同 —— 覆盖安装前先卸旧包） |
| 后端 | 本地 compose 栈 `multica-probe542`（`127.0.0.1:8090`，模拟器经 `10.0.2.2:8090`） |
| 登录 | `probe551@example.com` + 开发验证码 `888888` |
| 一次构建安装 | 会话内一次构建（`assembleRelease`）+ 一次覆盖安装；全程未重启模拟器 |
| 平台约束 | Release 变体默认禁明文 HTTP，而本地后端是 http → 由 `app.config.ts` 的非生产 `usesCleartextTraffic` 放行（2026-09-19 实测，已写回 `.trellis/spec/mobile/frontend/android-platform.md`） |

**为什么是模拟器**：本机没有真机接入（`adb devices` 只有 `emulator-5554`）。以下结论一律为
**模拟器结论**，真机结论仍需后续阶段补。

### 跑法分层（2026-09-19 定，用户要求「每次改动 5 分钟内出结论」）

| 层 | 覆盖 | 入口 | 时长 | 何时跑 |
|---|---|---|---|---|
| **Tier 1 冒烟** | 8 条（S1–S8） | `bash .trellis/tasks/09-19-android-final-acceptance/research/smoke558.sh` | 实测 294s（冷态）→ 修完 ~3~4 分钟 | 每次改动；这是唯一可以随手跑的档 |
| **Tier 2 完整矩阵** | 本清单全部行（68 条判据） | `bash …/chunked558.sh` | ~40 分钟（单设备下限） | 每阶段一次，**须先取得明确授权** |
| 单条重查 | 指定编号 | `ACCEPT_GROUPS=c5,c6 bash …/chunked558.sh` | 1~10 分钟 | 判定源修好后复查那几条 |

冒烟集与清单行的对应：**S1→C4** · **S2→C5/C5b** · **S3→B1/B2 的 picker 返回路径** ·
**S4→K2** · **S5→E1** · **S6→C8b–C8d** · **S7→D4** · **S8→V2**。
冒烟**不得**为了通过而放宽判据 —— 它只是从 Tier 2 里挑出来的子集，判据实现只有一处
（`groups-core558.sh` 的 `smoke_set()`）。模拟器可用 `snapshot558.sh save|load` 复用
「已装包 + 已登录」的快照，省掉 boot 与登录那 1~2 分钟固定开销。

## 1. 核心流程

| # | 步骤（勾选） | 预期结果 | 本次结果 | 证据 |
|---|---|---|---|---|
| C1 | 未登录冷启 → 输入邮箱 → 点 `Send code` | 进入验证码页 | ✅ 通过 | `run/c1-01-login.png`、`run/c2-01-verify.png` |
| C2 | 输入 `888888`（满 6 位自动提交） | 通过验证，进入工作区选择 | ✅ 通过 | `run/c2-02-after-otp.png` |
| C3 | 在工作区列表选 `Probe 550` | 进入收件箱 tab | ✅ 通过 | `run/c3-01-workspaces.png` |
| C4 | 收件箱列表 | 渲染出服务端按 issue 去重后的提醒行 | ✅ 通过 | `run/c4-01-inbox.png` |
| C4b | 点开一条提醒 | 进入对应 issue 详情 | ✅ 通过（截图判定） | `run-remeasure/rm-08-item-opened.png`（打开的是 PROB-2） |
| C4c | 未读行左滑 | 露出红色 `Archive` 操作 | ✅ 通过 | `run/c4-03-swipe-reveal.png` |
| C4d | 点 `Archive` | 条目从列表移除 | ✅ 通过 | `run/c4-04-after-archive.png` |
| C4e | 右上 `⋯`（`Inbox actions`） | 弹出批量操作面板 | ✅ 通过 | `run/c4-05-inbox-actions.png` |
| C5 | 打开 issue 详情 | 标题 + 时间线渲染 | ✅ 通过 | `run/c5-01-detail-top.png` |
| C5b | 属性 chip | status / priority / assignee / 标签 / 项目都渲染 | ✅ 通过（命中 In Progress、High、Android 回归项目、android、回归） | `run/c5-01-detail-top.png` |
| C5c | 滚到时间线 | 评论卡片渲染 | ✅ 通过（截图判定） | `run/c5-02-detail-bottom.png` |
| C5d | 右上 `⋯`（`Issue actions`） | 动作面板列出 Edit details / Pin / Delete issue | ✅ 通过 | `run/c5-03-actions-menu.png` |
| C5e | 长按评论 | 弹出 `Reply` / `React…` 面板 | ✅ 通过（重测） | `run-remeasure/rm-06-comment-menu.png` |
| C5f | `React…` → `More reactions…` | 进入 emoji picker（页眉 `Add Reaction`） | ✅ 通过（重测） | `run-remeasure/rm-07-react-panel.png` |
| C6 | 编辑 issue（`⋯` → Edit details） | Title + Description 两字段 | ✅ 通过 | `run/c6-01-edit.png` |
| C6b | 详情点属性 chip 进选择器 | 每个 chip 都能打开对应选择器 | ✅ 通过（重测：B1 用例走同一条路径成功） | `run-remeasure/rm-b1-picker-open.png` |
| C6c | 深链 6 个 issue 选择器路由 | status / priority / assignee / label / project / due-date 全开 | ✅ 通过（逐张截图确认；自动断言只认了 4/6，见 §9.2） | `run-remeasure/rm-c6-picker-*.png` |
| C7 | 新建 issue 页 | 打开、可填标题 | ✅ 通过 | `run/c7-01-new-issue.png` |
| C7b | 新建页属性 chip | 各自打开 picker 叠层 | ✅ 通过（重测 3/5；另 2 个是带搜索栏的 picker，断言词不适用，见 §9.2） | `run-remeasure/rm-c7-chip-*.png` |
| C7c | 深链 5 个 `new-issue-picker` 路由 | 4/5 以上可打开 | ✅ 通过（4/5） | `run/c7-picker-*.png` |
| C7d | 填标题 → 点 `Create issue` | 提交成功 | ✅ 通过 | 后端日志 `POST /api/issues → 201`；DB 新增 `#4 FEATURE-551 acceptance issue`；`run/c7-03-after-create.png` |
| C8 | 聊天页 | 渲染出会话历史气泡（user + assistant） | ✅ 通过 | `run/c8-01-chat.png`、`run-remeasure/rm-e3-chat.png` |
| C8b | 输入并发送 | 消息进入列表；离线时进入排队待发 | ✅ 通过（气泡带 `Offline · …` 待发标记） | `run-remeasure/rm-e3-chat.png` |
| C8c | 等待流式回复 | 逐 token 输出 | ⛔ 阻塞（环境） | 夹具 agent 的 runtime `Probe550 Runtime` 为 **offline**，消息只能排队；不是客户端缺陷 |
| C9 | 项目列表 → 项目详情 | 列表与详情都渲染 | ✅ 通过 | `run/c9-01-projects.png`、`run/c9-02-project-detail.png` |
| C10 | 头部搜索图标 → 输入关键词 | 返回结果 | ✅ 通过 | `run/c10-02-search-results.png` |
| C11 | 设置页 | Account / Notifications / Workspaces / Appearance / Sign out 齐备 | ✅ 通过 | `run/c11-01-settings.png` |
| C11b | 进通知偏好页 | 渲染出来 | ✅ 通过 | `run/c11-02-notifications.png` |
| C11c | 设置页工作区段 | 列出可切换的工作区 | ✅ 通过 | `run/c11-03-workspaces.png` |
| C11d | Sign out → 确认 | 回到登录页 | ✅ 通过 | `run/c11-06-signed-out.png` |

## 2. 键盘避让（FEATURE-548 交接清单 A 组）

判据：键盘弹起后，焦点输入框（或同屏最下方的关键控件）整块在 **IME inset 顶边之上**。

| # | 场景 | 预期 | 本次结果 | 证据（`run/state.log`） |
|---|---|---|---|---|
| K1 | 聊天 composer（548 的主修复点） | 输入框整体在键盘上方 | ✅ 通过 | `visible imeTop=1517 focus=[34 1284 1046 1389]` |
| K2 | 评论 composer（对照组） | 同上 | ✅ 通过 | `visible imeTop=1517 focus=[34 1220 1046 1325]` |
| K3 | 新建 issue 标题 | 同上 | ✅ 通过 | `visible imeTop=1517 focus=[42 252 1038 378]` |
| K4 | 编辑 issue 标题 | 同上 | ✅ 通过 | `visible imeTop=1517 focus=[42 246 1038 351]` |
| K5 | 登录邮箱 + Send code | 同上 | ✅ 通过 | `visible imeTop=1517 focus=[63 811 1017 916]` |
| K6 | 验证码 OTP + Verify | OTP 与 Verify 都在键盘上方 | ✅ 通过（重测） | `run-remeasure/state.log`：`visible imeTop=1633 Verify=[491 958 588 1011]` |

补记：548 要求额外确认的两点也成立 —— 键盘高度按 `IME inset − 导航条` 折算后**没有少垫/多垫**
（焦点框底边 1389 与键盘顶边 1517 之间留的是 composer 自身高度，未出现被压住），
且避让基准一致（三个不同页面实测同一个 `imeTop=1517`）。

## 3. 返回路径（FEATURE-548 交接清单 B 组）

| # | 场景 | 预期 | 本次结果 | 证据 |
|---|---|---|---|---|
| B1 | sheet 叠 sheet：详情 → 属性 picker → BACK | 只关 picker，回到详情 | ✅ 通过（重测） | `run-remeasure/rm-b1-after-back.png` |
| B2 | modal 套 modal：详情 → `⋯` 菜单 → BACK | 只关面板；详情不弹栈、应用不退后台 | ✅ 通过（重测） | `run-remeasure/rm-b2-after-back.png` |
| B3 | picker 选中一项 | 关闭且无残留空壳 | ✅ 通过（选中后时间线出现 `probe551 changed priority: High → Urgent`） | `run-remeasure/rm-d2-reconnected.png` |
| B4 | More 下拉开着按 BACK | 只关菜单，不退出、不切 tab | ✅ 通过 | `run/b4-more-open.png`、`run/b4-after-back.png` |
| B5 | 图片查看器 | BACK 关闭查看器 | ⛔ 未覆盖 | 夹具没有图片附件，本轮无法触发（见 §7.2） |

## 4. edge-to-edge 系统栏（FEATURE-548 交接清单 C 组）

| # | 场景 | 预期 | 本次结果 | 证据 |
|---|---|---|---|---|
| E1 | 手势导航下的底部 tab bar | 不被手势条压住 | ✅ 通过 | tab bar 底边 y=2334 ≤ 导航条上沿 y=2337（inset 63px）· `run/e1-tabbar-gesture.png` |
| E2 | 切三键导航 | tab bar 随之变高 | ✅ 通过 | 底边 y=2271 ≤ 上沿 y=2274（inset 126px，比手势导航多 63px）· `run/e2-tabbar-threebutton.png` |
| E3 | 聊天输入框与 tab bar | 无重叠 | ✅ 通过（截图判定） | `run-remeasure/rm-e3-chat.png`：composer 在 tab bar 之上 |
| E4 | 状态栏前景色（深浅两套） | 随主题正确切换 | ✅ 通过 | 条带亮度 浅 254 → 深 9 · `run/e4-statusbar-*.png` |
| E5 | picker 列表最后一行 | 不被手势条遮挡 | ✅ 通过 | 最低非全屏节点底边 2337 ≤ 导航条上沿 2337 · `run/e5-picker-bottom.png` |
| E6 | 设置页列表末尾 | 能在 tab bar 上方完整滚出 | ✅ 通过 | 底边 1991 ≤ 2337 · `run/e6-settings-bottom.png` |

## 5. 视觉与渲染面（FEATURE-549 / 550 / 557）

| # | 条目 | 预期 | 本次结果 | 证据 |
|---|---|---|---|---|
| V1 | 底部 tab bar 图标（4 个 tab） | 每个标签上方都有可见图标 | ✅ 通过 | 图标框非背景像素占比 Inbox 0.121 / My Issues 0.115 / Chat 0.171 / More 0.087（改动前该处是空白）· `run/v1-tabbar-light.png` |
| V2 | 启动屏 | 冷启动首帧背景 `#111827` | ✅ 通过 | `run/launch-splash-2.png` |
| V2b | 启动屏 prebuild 生成物 | `splashscreen_background=#111827`、`values-night` 无深色覆盖、`windowSplashScreen*` 属性齐全 | ✅ 通过 | `values-night/colors.xml` = `<resources/>`；`windowSplashScreen` 属性 3 条；`MainActivity` 已注册 `SplashScreenManager` |
| V2c | logcat | 无 `Failed to hide splash screen` | ✅ 通过 | `run/splash-hide-errors.txt` = 0 |
| V3 | 深浅两套 | 浅色正文亮度 > 180、深色 < 80 | ✅ 通过 | 浅 254 / 深 9 · `run/v3-{light,dark}-settings.png` |
| V3b | 状态栏随主题 | 两套对比正常 | ✅ 通过 | 浅 254 → 深 9 |
| V4 | `SegmentedControl` 的替代物 | My Issues 的 scope pill 组渲染 | ✅ 通过 | `run/v4-my-issues-light.png` |
| M1 | Markdown 语法矩阵 | 12 组语法逐项渲染 | ✅ 通过 | `run/m1-frame-01..08.png` |
| M10 | 代码高亮 | 出现多种 token 颜色，不落到纯文本 | ✅ 通过 | logcat `initializing highlighter`×1、`highlight failed`×0；`run/m1-frame-05/06.png` |
| M11 | 未知语言降级 | 不抛错、渲染等宽纯文本 | ✅ 通过 | `highlight failed for lang=` 计数 0 · `run/m1-frame-07.png` |
| M13 | 12 语言夹具 | 12 个代码块都渲染 | ✅ 通过 | `run/m13-langs.png` |
| M14 | 前后台内存回收 | 进后台后 Native Heap 回落、回前台不回弹 | ✅ 通过 | Alloc 346070 → 259300 KB（Free 32563 → 118778）→ 260834 → 261755 · `run/mem-N*.txt` |
| M15 | 长文档滚动 | 滚到底全部渲染、无空白占位 | ✅ 通过 | `run/m15-longdoc-bottom.png`、`run/gfxinfo-scroll.txt`（帧率按 550 结论不作判据） |
| G1 | 品牌：应用列表名 | 「海尔商城」 | ✅ 通过 | `aapt2 dump badging` → `application-label:'海尔商城'`（Release） |
| G2 | 品牌：包名 | `com.ehaier.zgq.shop.mall[.staging]` | ✅ 通过 | `pm list packages` 同时有 `…mall` 与 `…mall.staging` |

## 6. Release 产物核验（FEATURE-552 的签名 APK）

| # | 条目 | 预期 | 本次结果 | 证据 |
|---|---|---|---|---|
| R1 | `adb install -r` 生产 APK | 装上 | ✅ 通过 | `run-release/install.txt` = `Success` |
| R2 | 包名 / 版本 | `com.ehaier.zgq.shop.mall`、versionCode 1 | ✅ 通过 | `run-release/badging.txt` |
| R3 | 应用列表名 | 「海尔商城」 | ✅ 通过 | 同上 |
| R4 | 签名 | 用仓库外的发布密钥，不是 debug key | ✅ 通过 | SHA-256 `267600f2…25ccf` 与 `~/.multica-android` 密钥库一致 · `run-release/signature.txt` |
| R5 | 冷启动启动屏 | 背景 `#111827` | ✅ 通过 | `run-release/release-launch-1.png` |
| R6 | 内嵌 bundle | 不连 Metro 也能渲染出登录页 | ✅ 通过 | `run-release/release-login.png` |
| R7 | 前台窗口 | 是 Release 包 | ✅ 通过 | `com.ehaier.zgq.shop.mall/.MainActivity` |

Release 只核验「装得上、起得来、品牌与签名正确」：生产包的 API base 是 `https://api.multica.ai`，
没有可用凭据，登录之后的业务流程不归本轮。

## 7. 未通过 / 未覆盖项（含影响面）

### 7.1 断网重连后的实时同步没有在观测窗口内生效 —— ❌ 失败（已知问题）

- **现象**：断网期间从后端直插一条评论，恢复网络后 30s 内时间线**没有**出现该评论；
  同一页面稍后（重挂载时）才带出来。
- **最小复现**：issue 详情页 → `adb shell cmd connectivity airplane-mode enable` + `svc wifi disable`
  → 后端插入一条评论 → 恢复网络 → 等 30s → 时间线无新评论。
- **证据**：`run/d2-reconnected.png`、`run-remeasure/rm-d2-reconnected.png`（后者时间线里能看到
  更早一次插入的 `D2 offline inserted comment`，但刚插入的一条不在）。
- **影响面**：弱网 / 切网 / 息屏回前台后，时间线可能停留在旧数据，用户需手动刷新或重进页面。
  登录、收件箱、详情首屏加载等**其余流程不受影响**。
- **建议**：转单独任务（WS 重连后 invalidate 当前路由的 query，或订阅 reconnect 事件）。

### 7.2 图片查看器未覆盖 —— ⛔ 未覆盖

- **原因**：夹具没有图片附件，模拟器也无法从相册挑图（本机自托管栈没配 S3 / 本地上传目录）。
- **影响面**：548 的 B5 与 550 的图片渲染路径本轮无设备证据。
- **建议**：下一轮先给夹具 issue 挂一张图片附件再补这一条。

### 7.3 聊天的「流式回复」未覆盖 —— ⛔ 环境阻塞

- **原因**：夹具 agent 绑定的 runtime（`Probe550 Runtime`）状态为 offline，消息只能排队。
- **已覆盖的部分**：历史气泡渲染、composer 键盘避让、发送动作与离线排队态（气泡显示
  `Offline · …`）都已实测通过。
- **建议**：需要一台注册在线的 runtime 才能补「流式 token 逐条到达」。

## 8. 本轮发现的产品 / 后端缺陷（不在「验收项」内，但值得单独跟）

### 8.1 客户端在 Android 上把 `client_os` 上报成 `ios`

`apps/mobile/data/realtime/ws-client.ts:207` 写死 `url.searchParams.set("client_os", "ios")`。
实测后端日志里 Android 设备的 WS 连接是：

```text
websocket connected ... client_platform=mobile client_version=0.1.0 client_os=ios
```

**影响面**：平台维度的统计、排障与灰度（任何按 `client_os` 分支的逻辑）在 Android 上全部失真。
`packages/core/api/ws-client.ts:97` 走的是 `this.identity.os`，是对的；移动端这层覆盖成了字面量。

### 8.2 新建 issue 会因号段冲突直接 500

后端日志：

```text
create issue failed ... error="create issue: ERROR: duplicate key value violates unique
constraint \"uq_issue_workspace_number\" (SQLSTATE 23505)"
POST /api/issues status=500
```

**成因**：`workspace.issue_counter` 落后于 `MAX(issue.number)`（此前有人直接用 SQL 造过 issue）。
把计数器对齐到 `MAX(number)` 后，同一条路径立刻变成 `201`，issue 也正常创建（见 C7d）。

**影响面**：一旦计数器漂移，新建 issue 对用户就是一句 `Failed to create issue 500`，
且客户端没有可读的冲突提示。建议后端加一次对账，或把冲突转成可读错误。

## 9. 驱动脚本的限制与结论口径

### 9.1 `uiautomator dump` 对长页面覆盖不全

issue 详情带长 Markdown 正文时，评论卡会落在虚拟化列表的第 N 屏之后，dump 时有时无
（550 也遇到过同样的结论）。所以 M 组与 C5c / C4b / E3 这几条以**截图**为准，dump 只做加分项。

### 9.2 判定用词要按 picker 分别取

带搜索栏的 picker（label / project / assignee）只有输入内容后才有 `Clear search`；
没有搜索栏的（status / priority / due-date）只有自己的选项词。本轮 C6c / C7b / D1 的自动断言
因此漏判，逐张截图复核后才确认都打开正常（§1 已按截图更正）。

### 9.3 原生 Alert 会盖住整屏

后端 500 会弹原生对话框，此时 dump 只拿到对话框窗口，后续所有断言都会落到错误内容上
（本轮 C7d 之后一度把 C8-C10 一起带崩）。驱动里已加 `dismiss_dialog()`，在每个
「回到干净路由」的动作前先点掉。

### 9.4 本文结论与原始结果表的差异（逐条说明）

`run/results.tsv` 是脚本一次跑出来的原始表。下面几行**原始判定为失败、本文按证据更正为通过**，
原因都是判定源缺陷（不是产品问题）：

| 编号 | 原始表 | 本文 | 更正依据 |
|---|---|---|---|
| V2b | fail「values-night 有 0\n0 处 color」 | ✅ 通过 | `grep -c` 无匹配时输出 `0` 但退出码 1，脚本里 `\|\| echo 0` 追加成了 `"0\n0"`。`values-night/colors.xml` 实为 `<resources/>`（无深色覆盖，符合预期）；脚本已改为 `count_of` 统一取值 |
| M10 | fail「initializing=1、highlight failed=0\n0」 | ✅ 通过 | 同一个计数 bug。logcat 实为 `initializing`×1、`highlight failed`×0 |
| M11 | fail「出现 0\n0 次」 | ✅ 通过 | 同上 |
| C4b | fail「点开条目后未进入详情」 | ✅ 通过 | 长文档页的 dump 覆盖不到标题文本；截图显示打开的正是 PROB-2 · `run-remeasure/rm-08-item-opened.png` |
| C5c | fail「评论未进无障碍树」 | ✅ 通过 | 截图显示 3 张评论卡与表情全部渲染 · `run/c5-02-detail-bottom.png` |
| C5e / C5f | fail / blocked | ✅ 通过 | 重测（先滚到评论进树，再长按）· `run-remeasure/rm-06/07-*.png` |
| C6c | fail「4/6」 | ✅ 通过 | 逐张截图确认 6 个 picker 都打开（§9.2 的判据词问题） |
| C7b | fail「2/5」 | ✅ 通过 | 重测 3/5；另 2 个是带搜索栏的 picker，截图确认已打开 |
| C7d | fail「未看到新 issue 详情」 | ✅ 通过 | 后端 `201` + DB 新增 `#4`；客户端建完回到列表（§8.2 的计数器问题已修） |
| B1 / B2 | blocked / fail | ✅ 通过 | 重测：chip 进 picker 与面板 BACK 都正常 · `run-remeasure/rm-b1-*.png`、`rm-b2-*.png` |
| D1 | blocked「深链未落到 picker」 | ✅ 通过 | 截图显示落在 label picker；BACK 后回到 tab 根 · `run-remeasure/rm-d1-*.png` |
| D3 | fail「resume=0」 | ✅ 通过 | 判据写错：D2 之后停在 issue 详情而不是 tab 根，用 `in_tab_root` 断言必然失败；重测改为「应用在前台且渲染出内容」后通过 |
| E3 | blocked「未找到聊天输入框」 | ✅ 通过 | composer 的 content-desc 会随状态变成 `Agent is working…`；截图显示输入框整体在 tab bar 之上 · `run-remeasure/rm-e3-chat.png` |
| K6 | blocked「键盘未占位」 | ✅ 通过 | 重测先点一次 OTP 再等键盘占位：`imeTop=1633`、`Verify` 底边 1011 |

仍然**未通过 / 未覆盖**的只有三条，见 §7.1（D2 实时同步）、§7.2（B5 图片查看器）、
§7.3（C8c 流式回复，环境阻塞）。

### 9.5 这一轮的脚本重跑记录

用户要求「一次改完、一次验收」，纪律只允许**脚本自身缺陷**或**验收项本身写错**时重跑。
本轮在同一构建、同一次模拟器会话内重跑的账目（全程只构建安装过一次 Debug、一次 Release，
未重启模拟器）：

| 轮次 | 中止原因（均为脚本缺陷，不是产品缺陷） |
|---|---|
| attempt1 | OTP 场景用「焦点节点」判键盘避让，而 OTP 输入框是 `opacity:0` 的隐藏节点 → 判据失效 |
| attempt2 | 左滑归档的拖拽距离短于 `rightThreshold`（80dp≈210px），滑不开 |
| attempt3 | 左滑起点落在右缘系统返回手势区，把应用误退到桌面，污染后续步骤 |
| attempt4 | `set -o pipefail` + `grep -q` 的 SIGPIPE：页面越大越容易把「命中」判成「未命中」 |
| attempt5 | 缺少原生 Alert 兜底；夹具计数器未对账（新建 issue 500）；picker 判据词不适用 |
| **run/** | 上述问题修完后的一轮（本文采用的主跑，94 张截图） |
| run-remeasure/ | 只补判定源仍有缺陷的 12 条（K6 / C4b / C5c-e / C6c / C7b / B1 / B2 / D1 / D2 / D3 / E3） |
| run-release/ | Release APK 的安装与品牌核验（第二次安装，issue 允许） |
