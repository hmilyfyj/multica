# 核心流程 Android 全量回归验收

## Goal

在 Android 上做**唯一一次**验收：一次构建安装、一个脚本、一轮结论，覆盖全部核心流程与阶段 3（FEATURE-548 / 549 / 550 / 557）的改动面。

对应 Multica issue：**FEATURE-551**（父 FEATURE-553）。本任务**不改业务代码**，只产出设备证据与一份可复用的验收清单。

## Requirements

### R1 唯一一次（用户硬要求）

用户 2026-09-18：「一次性改完，一次性验收，不要重复跑好几次验收。目前启动了太多次安卓模拟器了。」
纪律见 `.trellis/spec/mobile/frontend/android-platform.md`「验收证据要求 → 一次性验收」。

- 一次构建安装（Debug；会话内允许再装一次 FEATURE-552 的 Release APK），全程不改代码、不重启模拟器、不重复安装同一类型
- 一轮取证：**一个入口脚本**跑完全部验收项，产物一次性落进 `.trellis/tasks/<task>/research/`
- 等待一律轮询（等元素出现 / 等画面稳定），不用固定 `sleep` 猜时长
- 只有「脚本自身缺陷」或「验收项本身写错」才允许重跑，并在结论里写明重跑原因

### R2 覆盖范围

1. **核心流程**：登录验证码 → 工作区选择 → 收件箱（列表/未读/滑动操作/批量菜单）→ issue 详情（时间线/评论/表情/⋯ 菜单）→ 编辑 issue → 新建 issue（含 picker 叠层）→ 聊天（发送/待发/重试）→ 项目列表与详情 → 全局搜索 → 设置（主题/通知偏好/工作区/退出登录）
2. **键盘避让 6 场景**（FEATURE-548 交接清单 A 组）：登录、验证码、聊天、新建 issue、编辑 issue、评论
3. **返回路径**（B 组）：sheet 叠 sheet / modal 套 modal / picker → back / More 菜单 + BACK / 图片查看器
4. **edge-to-edge 系统栏**（C 组，FEATURE-548 交接）：底部 tab bar（手势/三键两套）/ 聊天输入框 / 状态栏前景色 / picker 与设置页列表末尾
5. **视觉面**（FEATURE-549）：底部 tab bar 图标、深浅色两套、启动屏与桌面图标、scope pill 组
6. **渲染面**（FEATURE-550）：Markdown 12 项语法、代码高亮（含未知语言降级）、12 语言夹具、前后台内存回收序列、长文档滚动
7. **品牌面**（FEATURE-557）：应用列表名「海尔商城」、包名 `com.ehaier.zgq.shop.mall.staging`、启动屏与桌面图标
8. **三个易漏场景**：深链冷启动直达 picker 后 BACK 的落点、断网重连后的实时同步、前后台切换与进程被杀后的恢复

### R3 环境

- 设备：优先真机；本机无真机 → 模拟器 `Medium_Phone_API_35`（Android 15 / API 35 / 1080×2400 @420dpi），结论如实标注「模拟器验收」
- 环境：**JDK 21** + 显式 `ANDROID_HOME`
- 后端：本地 compose 栈 `multica-probe542`（`127.0.0.1:8090`，模拟器经 `10.0.2.2:8090` 访问），开发验证码 `888888`
- 夹具：`research/seed-fixtures.sql`（工作区成员、项目、标签、issue 属性、评论与表情、收件箱、聊天会话）——**是后端数据，不是应用代码改动**
- Release 项用 FEATURE-552 的签名产物；若本机装不上，记为「阻塞 + 原因」，不为它额外起一轮

## Acceptance Criteria

- [ ] AC1 `apps/mobile/docs/android-regression-checklist.md` 存在，含**可勾选步骤 + 预期结果**，并逐条标注本次结果（通过 / 失败 / 阻塞）
- [ ] AC2 每条结果标注**设备型号、Android 版本、构建类型（Debug / Release）**
- [ ] AC3 失败项给出**最小复现 + 报错**；未覆盖项记为已知问题并写明影响面
- [ ] AC4 全部证据（截图 / logcat / `dumpsys` / 脚本与结果表）落在 `.trellis/tasks/09-19-android-full-regression/research/`
- [ ] AC5 不把「单测通过」当验收证据；区分模拟器结论与真机结论
- [ ] AC6 结论按仓库授权自行 squash 合并进 `main`

## Notes

- 前置：阶段 3 全部合并（548 / 549 / 550 / 557）**且 FEATURE-552 已产出 Release 产物** —— 开工核对为已满足（`main` @ `28f025e22`）。
- 计划产物：本任务 `research/` 下 `driving-plan.md`（C/B 组）、`driving-plan-regressions.md`（V/M/D/E 组）、`acceptance.sh` + `lib551.sh` + `groups-core.sh`（一次性入口）、`seed-fixtures.sql`（夹具）。
- 本任务不归档 trellis 之前的历史任务目录（那些属各自任务）。
