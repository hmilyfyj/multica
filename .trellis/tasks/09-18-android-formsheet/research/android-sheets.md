# FEATURE-547 · Android formSheet 路由实测记录

24 条以 `SHEET_OPTIONS` 注册的路由，逐条在 Android 模拟器上实测并截图。
所有数字与结论都来自本目录 `screens/` 下的截图与本机命令输出；复现方式见 §2。

- 截图目录：`research/screens/`（1080×2400，文件名 = 路由序号 + 名字）
- 驱动脚本：`research/capture-sheets.sh`（可重复执行，`ANDROID_SERIAL=<serial>` 指定设备）

> 行号坐标一律是设备像素（1080×2400）。表格里的「首帧 top%」= 截图里 sheet 上边缘距屏幕顶部的
> 百分比，用来反推挡位：40% ≈ 0.6 挡，56%~60% ≈ 内容高度（0.6 挡以内由内容决定），≈9% ≈ 0.95 挡
> （maxHeight）。

---

## 1. 结论摘要

| # | 结论 | 证据 |
|---|---|---|
| 1 | iOS 那四组参数在 Android **全部生效**，只是语义不同（见 §3） | 源码 + 截图 |
| 2 | 24 条路由全部能打开、有内容、可返回；无空白 sheet、无零高度 | `screens/01..24` |
| 3 | 拖拽关闭、上拖展开、展开后滚动、BACK 关闭、点遮罩关闭 —— 都正常 | §5 |
| 4 | 叠放 sheet（new-issue → picker）返回父级正确，chip 同步更新 | §5.5 |
| 5 | 深链直达 picker 后返回，落在 `(tabs)` 锚点（Inbox） | §5.6 |
| 6 | **due-date 两个路由在 Android 上原本完全不可用，已修**（`presentation: "modal"` + body 平台分支） | §4、§6.1 |
| 7 | `headerShown: true` 的 4 条路由在 Android 上不渲染标题与搜索框 —— 属 FEATURE-546 范围，本轮只记录 | §6.2 |
| 8 | `sheetGrabberVisible` 在 Android 无实现（抓手不绘制） | §6.3 |

---

## 2. 复现方式（本机已验证）

1. **后端**：仓库根 `.env`（gitignored）沿用探针环境，`PORT=8090`、`APP_ENV=development`、
   `MULTICA_DEV_VERIFICATION_CODE=888888`；`COMPOSE_PROJECT_NAME=multica-probe542 docker compose
   -f docker-compose.selfhost.yml up -d postgres backend`（复用 542 的卷，种子数据仍在）。
2. **移动端 env**：`apps/mobile/.env.development.local`（gitignored）写
   `EXPO_PUBLIC_API_URL=http://10.0.2.2:8090` / `EXPO_PUBLIC_WEB_URL=http://10.0.2.2:3000`。
3. **构建**：`JAVA_HOME=/opt/homebrew/opt/openjdk@21 ANDROID_HOME=$HOME/Library/Android/sdk
   pnpm android:mobile`（= `expo prebuild -p android` + `expo run:android`），包名
   `ai.multica.mobile.dev`；Metro 由该命令一并起在本机 8081，`adb reverse tcp:8081 tcp:8081`。
4. **模拟器**：`Medium_Phone_API_35`（API 35，1080×2400）。本机可能同时跑着别的任务的 AVD，
   所有 adb 命令都要带 `-s <serial>`。
5. **登录**：任意邮箱 + 验证码 `888888`（development 环境的 `MULTICA_DEV_VERIFICATION_CODE`）。
6. **截图**：`ANDROID_SERIAL=emulator-5554 bash research/capture-sheets.sh research/screens 3`。

种子数据（542 探针留下）：工作区 `Probe 542`（slug `probe542`）、issue `PRO-1`/`PRO-2`、
项目 `探针项目`、一条 comment、一条 inbox 记录。

驱动脚本里三个踩过的坑（已写进脚本注释）：深链必须带 `-n <pkg>/.MainActivity`（dev 与 staging 两个包
注册了同一个 `multica` scheme，裸 VIEW 会弹系统选择器）；**不能用 force-stop 做路由间重置**
（dev 冷启动会落到 expo-dev-client 的开发服务器列表页）；重置手段是 BACK。

---

## 3. 四组参数在 Android 的实际语义

版本：`react-native-screens@4.23.0`（`node_modules/react-native-screens/android/src/main/java/com/swmansion/rnscreens/`）。

| 参数 | iOS（现有注释） | Android 实测语义 | 源码位置 |
|---|---|---|---|
| `presentation: "formSheet"` | `UISheetPresentationController` | Material `BottomSheetBehavior`（`isDraggable`/`isHideable` 都开） | `ScreenModalFragment.configureBehaviour` |
| `sheetAllowedDetents: [0.6, 0.95]` | 两个可吸附挡位 | 2 挡位 → `peekHeight = 0.6·H`、`maxHeight = 0.95·H`，并强制 `isFitToContents = true`，初始态 = 收起；收起高度实际是 `min(0.6·H, 内容高度)` | `SheetDetents.kt`、`ScreenModalFragment.kt:252-262`、`SheetDelegate.updateMetrics` |
| `sheetCornerRadius: 20` | 卡片四角 | 只用 `ShapeAppearanceModel` 圆**上**两角 | `Screen.onSheetCornerRadiusChange` |
| `sheetGrabberVisible: true` | 原生抓手 | 只赋值给 `Screen.isSheetGrabberVisible`，全工程无读取方 → **不绘制** | `ScreenViewManager.kt:391`、`Screen.kt:77` |
| `contentStyle: { flex: 1 }` | sheet 内铺满 | 同义（内容 wrapper 高度） | `SheetDetents.maxAllowedHeightForFitToContents` |

额外两条 Android 特有的返回方式（iOS 不成立）：BACK 键关闭 sheet（RNS 把返回键接到
`dismissSelf`）；点击遮罩关闭（Material 默认行为）。

**因此 `SHEET_OPTIONS` 的四个数值不需要平台分支** —— 它们本来就是"Android 上也能表达同样意图"的取值；
真正需要分支的是 due-date 路由的呈现方式（§6.1）。

---

## 4. 逐路由实测（24 条）

| # | 路由 | 首帧形态（top%） | 内容 | 返回方式 | 备注 |
|---|---|---|---|---|---|
| 01 | `inbox/[id]` | sheet 45.9% | header + "This notification is no longer available." | 右上 ✕ / BACK / 拖拽 | 种子那条通知已过期，走的是失效分支 |
| 02 | `issue/[id]/picker/status` | sheet 40.0% | Status + 7 行状态 | 选中即回 | 裸 ScrollView（无 flex-1）也正常，未见零高度 |
| 03 | 同上 `priority` | sheet 40.0% | Priority + 5 行 | 选中即回 | |
| 04 | `assignee`（`headerShown: true`） | sheet 43.9% | Unassigned / probe542 / Probe Agent | 选中即回 | **无标题、无搜索框**，见 §6.2 |
| 05 | `label` | sheet 40.0% | "No labels in this workspace yet." | 不自动返回（多选） | 空态文案正常 |
| 06 | `project` | sheet 42.8% | No project / 探针项目 | 选中即回 | |
| 07 | `due-date` | **全屏 modal 页** | Due date + Clear/Done + 日期行 | Done / Clear / BACK | 本轮修法见 §6.1 |
| 08 | `issue/[id]/runs` | sheet 40.0% | Agent Runs + 空列表 | BACK / 拖拽 | 种子无 run |
| 09 | `comment/[commentId]/emoji-picker` | sheet 43.5% | Add Reaction + 分类栏 + emoji 网格 | 选中即回 | emoji 图片是异步加载的，3 秒截图可能仍是占位方框 |
| 10 | `mention-picker`（`headerShown: true`） | sheet 43.9% | @all / PEOPLE / AGENTS / SQUADS / Issues | 不自动返回 | 同 §6.2 |
| 11 | `project/[id]/picker/status` | sheet 40.0% | Status + 6 行 | 选中即回 | |
| 12 | `project/[id]/picker/priority` | sheet 40.0% | Priority + 5 行 | 选中即回 | |
| 13 | `project/[id]/picker/lead` | sheet 43.9% | Unassigned / probe542 / Probe Agent | 选中即回 | 同 §6.2 |
| 14 | `project/[id]/add-resource` | sheet 9.0% | Attach repository + 两个输入框 | Attach / BACK | 输入框 `autoFocus`，首帧就顶到 maxHeight（§6.4） |
| 15 | `new-issue-picker/status` | sheet 40.0% | Status + 7 行 | 选中即回 | |
| 16 | `new-issue-picker/priority` | sheet 40.0% | Priority + 5 行 | 选中即回 | |
| 17 | `new-issue-picker/assignee` | sheet 43.9% | 同 04 | 选中即回 | 同 §6.2 |
| 18 | `new-issue-picker/project` | sheet 42.8% | 同 06 | 选中即回 | |
| 19 | `new-issue-picker/due-date` | **全屏 modal 页** | 同 07（默认今天） | Done / BACK | 同 §6.1 |
| 20 | `new-project-picker/status` | sheet 40.0% | Planned/In Progress/Paused/Completed/Cancelled | 选中即回 | |
| 21 | `new-project-picker/priority` | sheet 40.0% | Priority + 5 行 | 选中即回 | |
| 22 | `issues-filter` | sheet 40.0% | Filter：STATUS + PRIORITY 两组多选 | BACK / 拖拽 | 长列表，60% 内可滚动 |
| 23 | `chat-sessions` | sheet 40.0% | Chats + 会话行 | 选中即回 | |
| 24 | `switch-workspace` | sheet 43.7% | Probe 542 | 两步确认后切换 | |

issue 正文写"约 18 个"，实际是 **24 条**：少了 `issue/[id]/picker/assignee`、`new-project-picker/{status,priority}`、
`issues-filter`、`chat-sessions`、`switch-workspace`。本轮按 24 条全覆盖。

---

## 5. 交互实测

都是 `adb shell input` 手势 + 截图核对，脚本与原始截图在 `screens/`。

| # | 场景 | 操作 | 结果 |
|---|---|---|---|
| 5.1 | 拖拽关闭 | status sheet 内从 (540,1300) 下甩到 (540,2380) | sheet 消失，露出底部 tab ✅ |
| 5.2 | 上拖展开 | status sheet 内上甩一次 | top 960 → 约 184（≈0.95 挡）✅；再上甩不越过 maxHeight |
| 5.3 | 展开态滚动 | 在展开后的 issues-filter / emoji 网格内继续上甩 | 内容滚动、sheet 不再动 ✅（嵌套滚动在展开态正常交接） |
| 5.4 | 收起回弹 | 展开态下甩一次 | 回到 0.6 挡（top 998）✅ |
| 5.5 | 叠放 + 返回父级 | new-issue(modal) → Priority chip → 选 High | 回到 new-issue 表单，chip 变 High ✅ |
| 5.5b | 叠放 + due-date | new-issue → Due date chip → 行内选 9/25 → OK → Done | 回到 new-issue 表单，chip 变 "Sep 25" ✅ |
| 5.6 | 深链锚点 | 冷启动式深链直达 due-date → Done | 落在 Inbox（`(tabs)` 锚点）✅ |
| 5.7 | pushed 页面 → sheet | issue 详情 → Status chip → 选 In Progress | 回到 issue 详情，chip 变 In Progress；DB `status=in_progress` ✅ |
| 5.8 | 破坏性 swipe 二次确认 | 收件箱行左滑 → 只露出红色 Archive → 点它 | 左滑不自动执行；点一下才归档 ✅（与 iOS 约定一致） |

---

## 6. 发现的问题与处理

### 6.1 due-date 两个路由在 Android 上原本完全不可用（已修）

**现象**（截图见本目录早期记录，修复后为 `screens/07`、`screens/19`）：

1. 打开 due-date sheet：sheet 本体只有一行自绘 header（Due date / Done），因为 Android 没有 inline
   日期选择器 —— `display="inline"` 与其它取值一样，最终都是一个 `DialogFragment`。
2. 日期对话框浮在 sheet 上方，但**拿不到输入**：点日期格、点 CANCEL/OK 全部无效；
   `dumpsys window` 显示两个 app 窗口，焦点始终在 activity 窗口（对话框窗口不获焦）。
3. 此时按 BACK，sheet 被关掉，**对话框却留在屏幕上盖住整个 App**：`uiautomator` 能查到它的节点，
   但窗口不获焦、点击无效、BACK 也关不掉 —— 只有杀进程才能清掉（后续 17 条路由的截图都被它污染，
   这本身就是这条 bug 的证据）。原因：该 `DialogFragment` 挂在 Activity 的 FragmentManager 上
   （`DatePickerModule.java:163 fragment.show(fragmentManager, NAME)`），sheet 退出后它继续存活。

**处理**：

- `_layout.tsx` 新增 `DUE_DATE_OPTIONS`：iOS = 原 `SHEET_OPTIONS`；
  Android = `{...SHEET_OPTIONS, presentation: "modal"}`（回到 activity 自己的窗口，对话框恢复正常）。
- `components/issue/pickers/due-date-picker-body.tsx`：`Platform.OS === "android"` 时渲染一行
  「当前日期 + Change」，点行用 `DateTimePickerAndroid.open()` 按需拉起系统日期对话框；
  iOS 分支与 `getIso()` 契约原样不动（路由代码零改动）。

**修复后实测**：Android 上 07/19 变成全屏 Due date 页；点行 → 对话框 → 选 9/22 → OK → 行内文案变
"Sep 22, 2026" → Done → 回到 issue 详情且 chip 变 "Sep 22"，DB `due_date=2026-09-22` ✅；
new-issue 草稿侧同流程 chip 变 "Sep 25" ✅。

### 6.2 `headerShown: true` 的 4 条路由在 Android 上无标题、无搜索框（转 FEATURE-546）

`issue/[id]/picker/assignee`、`new-issue-picker/assignee`、`mention-picker`、`project/[id]/picker/lead`
在 iOS 上是原生 header + `UISearchController`。Android 上 `uiautomator dump` 结果：sheet 从顶边开始就是
第一行内容，**没有标题节点、没有 `EditText`/`SearchView`**（`headerSearchBarOptions` 在 Android 无实现）。

按 issue 边界（"7 个 picker 相关的 `headerShown: true` / `title` 配置请保持不变，方便 546 在其上继续"），
本轮**不改**这两处，把证据留在这里给 FEATURE-546。

### 6.3 抓手在 Android 不绘制（记录，不改）

`sheetGrabberVisible` 在 Android 只被赋值、从不渲染（§3）。因此 Android 上拖拽关闭没有视觉提示，
但拖拽本身可用（5.1/5.2）。是否要在 Android 侧补一个自绘抓手，属交互设计决策，本轮不擅自加。

### 6.4 `add-resource` 首帧就是展开态（记录，不改）

唯一带输入框的 sheet：`TextInput autoFocus` 触发 IME，sheet 直接顶到 maxHeight（top 9%），
而其它 23 条首帧是 0.6 挡或内容高度。可用性没问题（输入框可见、可点 Attach），但和 iOS 的首帧挡位不同。
根因在路由 body 的自动聚焦，不在 `SHEET_OPTIONS`；改它需要动业务交互，超出本轮边界。

### 6.5 环境噪声（与本次改动无关，供后续任务参考）

- 该 dev 后端 `/api/me` 返回 401（App 内可见提示），但除它以外的接口与登录都正常；深链冷启动偶尔会因此
  退回登录页。
- `expo-dev-client` 冷启动落在开发服务器列表页，深链 URL 不会自动生效 —— 所以本轮所有验证都在已加载的
  会话里做，也意味着**「App 被杀后深链冷启动」这条路径无法在 dev 包上验证**（release 包才能；本轮没做）。
- 模拟器首次聚焦输入框会弹系统 "Try out your stylus" 引导层，会污染截图，点掉即可（一次性）。
- 本机同时可能有别的任务的 AVD 在跑（本轮就遇到 `Multica545`），adb 命令必须带 `-s`。

---

## 7. 未覆盖 / 遗留

1. **iOS 侧未跑模拟器**：本机 `xcrun simctl list runtimes` 为空（只有 Xcode 26.4 的 SDK，无模拟器
   runtime），装 runtime 才有意义。iOS 参数值本次一行未改，平台分支只在 `Platform.OS === "android"`
   时生效；如需真机复核，建议由有 iOS 环境的一方抽查 3 条不同路由。
2. §6.2 的 4 条路由待 FEATURE-546 处理。
3. release 包下的冷启动深链（本轮只验证了会话内深链的锚点行为）。
