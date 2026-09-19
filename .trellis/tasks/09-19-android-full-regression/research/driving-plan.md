# Android 全量回归 · 驱动计划 — C 组（核心流程）+ B 组（返回路径）

只读侦察产出，覆盖 `.trellis/tasks/09-19-android-full-regression` 的 **C1–C10（核心流程）** 与 **B1–B5（返回路径）**。
每条的判据都给到设备上可观测的层面；每条都带 `src:` 源码依据（`文件:行`，相对 `apps/mobile/`）。

> 本文件只含 C/B 两组。K / E / V / M / D 组在 `driving-plan-regressions.md`。两文件共用下文的「§0 口径」。

---

## §0 口径与前置（写脚本前先读这段）

### 0.1 设备 / 包 / 工作区

| 项 | 值 | 依据 |
|---|---|---|
| 序列号 | `emulator-5554`（`ANDROID_SERIAL` 覆盖） | `.trellis/tasks/09-18-android-input-keyboard-nav/research/lib.sh:29` |
| 包名（dev） | `com.ehaier.zgq.shop.mall.dev` | `apps/mobile/app.config.ts:104-108` |
| 包名（staging） | `com.ehaier.zgq.shop.mall.staging` | `app.config.ts:107` |
| scheme | `multica` | `app.config.ts:38` |
| 工作区 | `probe550` | `lib.sh:31` |
| 深链 | `goto <path>` → `multica://probe550/<path>` | `lib.sh:166-169` |

**坑 1（必须改）**：`lib.sh:30` 的默认 `PKG=ai.multica.mobile.dev` 是 FEATURE-557 改名前的旧值。本次跑之前必须显式传 `PKG=com.ehaier.zgq.shop.mall.dev`（或 `.staging`），否则所有 `am start -n "$PKG/.MainActivity"` 全部失败。

**坑 2**：深链必须带 `-n "$PKG/.MainActivity"`——dev 与 staging 两个包注册同一个 `multica` scheme，裸 VIEW intent 会弹系统「打开方式」选择器（`lib.sh:165` 注释、`09-18-android-formsheet/research/capture-sheets.sh` 文件头第 2 条）。

**坑 3（C1/C2/C3 专用）**：`lib.sh` 的 `goto` 永远拼 `multica://$WS/$1`，而登录 / 验证码 / 工作区选择三条路由**没有 workspace 段**。需要另加一个原语：

```bash
goto_raw() { adb_ shell am start -n "$PKG/.MainActivity" -a android.intent.action.VIEW -d "$1" >/dev/null 2>&1; }
```

### 0.2 取元素 / 点击（沿用 lib.sh，不要另起一套）

- `tap_text "…"`（`lib.sh:181`）= 在 uiautomator dump 里按 `text="…"` 精确匹配，取 `head -1` 的 bounds 点中心。
- `tap_desc "…"`（`lib.sh:182`）= 按 `content-desc="…"` 精确匹配。RN 的 `accessibilityLabel` 落到 Android 的 `content-desc`。
- 匹配是**区分大小写、逐字面**的；省略号一律是单字符 `…`(U+2026)，不是三个点。
- **placeholder 可以当 `text` 匹配**（既有先例：`drive-input.sh` 的 `tap_text "you@example.com"`、`tap_text "Issue title"`、`tap_text "Sign in to Multica"`）。
- 判断按钮禁用：`Button`（`components/ui/button.tsx`）把 `disabled` 透传给 `Pressable`，无障碍节点上是 `enabled="false"`。可用 `rg -F 'text="Save"' | rg -o 'enabled="[a-z]+"'` 断言。

### 0.3 需要补的驱动原语（lib.sh 目前**没有**，脚本里要先加）

| 原语 | 实现 | 用途 |
|---|---|---|
| `long_press_text <t>` / `long_press_desc <d>` | `adb shell input swipe <cx> <cy> <cx> <cy> 600` | 评论气泡 / 聊天气泡的动作面板。两处都是 `Pressable onLongPress` + `delayLongPress={500}`（`components/issue/comment-card.tsx`、`components/chat/chat-message-list.tsx`），**按下停留必须 ≥500ms**，普通 `input tap` 不会触发，`input tap` 也无法模拟长按 |
| `swipe_left_text <t>` | `adb shell input swipe x1 y1 $((x1-400)) y1 250` | 收件箱左滑出 `Archive` |
| `wait_text <t> [tries]` | 直接搬 `09-18-android-input-keyboard-nav/research/drive-input.sh:56-62` | 等页面就绪，别用固定 sleep |
| `input_text <s>` | `adb shell input text "<s>"` | 填空；空格写 `%s` |
| `clear_field <t>` | 点住 → `input keyevent KEYCODE_MOVE_END` → 连按 `KEYCODE_DEL` | 覆盖已有文本 |
| `tap_text_last <t>` / `tap_id_button1` | 取**最后**一个匹配 / 直接点 `resource-id="android:id/button1"` | 原生 Alert 的标题与按钮同名时必须用（见 C10） |

`tap_id_button1` 的取法照抄 `capture-sheets.sh` 的 `tap_dialog_button`（它取的是 `android:id/button2` = CANCEL）：

```bash
# 取 android:id/button1（原生 Alert 的「确定」位）bounds 后点中心
adb_ shell cat /sdcard/ui.xml | tr '>' '\n' \
  | sed -n 's/.*resource-id="android:id\/button1".*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p' | head -1
```

### 0.4 夹具（决定很多判据能不能跑）

`research/seed-fixtures.sql` 描述了一套喂给本地后端（compose 项目 `multica-probe542`，`127.0.0.1:8090`）的数据。**下面所有具体文本都建立在「夹具已导入」之上**；未导入时只能用 `未确认` 的形态判据。

| 夹具 | 值 | 用在哪 |
|---|---|---|
| 登录用户 | `probe551@example.com`，开发码 `888888` | C1 / C2 |
| 工作区成员 | 用户同时属于 `probe550` 与 `probe542` → 工作区选择器有 **2** 个可选项 | C3、C10 工作区段 |
| 项目 | `Android 回归项目`（probe550，in_progress / high / lead = probe551） | C6 project chip、C8 |
| 标签 | `android`、`回归`、`P0` | C5 / C6 label chip |
| issue#1（probe550） | 已设 status=in_progress、priority=high、project=Android 回归项目、assignee=probe551、due_date=今天+7、labels=android+回归 | C5 / C6 |
| issue#2（probe550） | status=todo、priority=medium、assignee=probe551 | C4 已读行、C5 备选 |
| issue#1 上的表情 | `👍`（actor×1） | C5 反应条 |
| issue#1 的评论 | 3 条：`…**加粗**、`行内代码`、列表。` / 带 ts 代码块 / `@probe551 这是一条提及评论…` | C5 评论卡 + 长按菜单 |
| 评论表情 | 第 1 条评论上 `🎉`×1 | C5 反应条 |
| 收件箱 | 未读 2 条（`probe550 把 PRB-1 指派给了你`、`probe550 在 PRB-1 的评论中提到了你`）+ 已读 1 条（`PRB-2 有一条新评论`） | C4 |
| 聊天 | 会话 `Android 回归会话`，2 条历史消息（一条 user、一条 assistant 带代码块） | C7 |

**路由里 issue/project/comment 一律用 UUID，不要用 identifier。** 夹具 SQL 的正文写 `PRB-1`，而 M 组笔记写 `PROB-1`——identifier 前缀本身就不确定，且 `PROB-1` 这类 **identifier 过长会被前序任务**截断导致 `Date.now()` 兜底、路由解析失败（见 §0.6）。UUID 免疫这两件事。

### 0.5 断言口径

- 「出现 X」= `ui_dump | rg -F 'text="X"'` 命中（可能有多个节点命中，属正常，见 §0.6）。
- 「X 可见」= 命中节点的 bounds 非空且 y 落在屏幕内。
- 「X 消失」= `ui_dump` 里**不再**有该文本（关浮层的主判据）。
- 「没离开应用」= `adb shell dumpsys window | rg -o 'mCurrentFocus=Window\{[^}]*'` 仍是 `$PKG/.MainActivity`。B2/B4 必须同时断言这两条，否则「面板关了」与「应用退到后台」区分不开（这正是 FEATURE-548 修的缺陷）。

### 0.6 三个会影响判据的运行时事实（都不是猜测，有源码依据）

1. **RN 的可点容器会把子文本合并到自己的节点上**，同时子节点仍在树里。实测 dump 里同一个 tab 会出现两行 `Inbox`（`.trellis/tasks/09-18-android-picker-search/research/screens/02-issue-label-01-baseline.txt`、`04-mention-picker-01-baseline.txt`）。所以 `tap_text` 命中多个是常态，`head -1` 取到的合并节点中心与子节点中心通常同区域，可直接用；但**当同一屏上有两个语义不同的同名文本时**（C10 的 `Sign out`）必须改用 §0.3 的 `tap_text_last` / `tap_id_button1`。
2. **`Stack.Screen` 的 `anchor: "(tabs)"`**：直接深链任一 picker/详情路由时，路由会自行把 tab UI 作为隐含底层屏挂上（`app/(app)/[workspace]/_layout.tsx:98-104` 注释）。所以「深链进 picker 后按 BACK 回到哪」与「从详情点 chip 进 picker 后按 BACK 回到哪」是两条不同路径——B1 必须走**点击进入**那条，才有 sheet 叠 sheet。
3. **tab 按钮没有 content-desc**。`(tabs)/_layout.tsx` 只传了 `title`，没传 `tabBarAccessibilityLabel`；`@react-navigation/bottom-tabs` 只在拿到 label 时才写 `aria-label`（`node_modules/@react-navigation/bottom-tabs/src/views/BottomTabItem.tsx:347-348`）。→ B4/C7 一律用 `tap_text "More"` / `tap_text "Chat"`，**不要** `tap_desc`。

---

## C 组 · 核心流程

### C1 登录（邮箱 → Send code）
route: 无（需点击进入）。尝试值 `multica://login`（`goto_raw`）——**未确认**；可靠路径是「无会话冷启后自动落到 /login」：`app/index.tsx:27` 的 `if (!user) return <Redirect href="/login" />`，以及 `app/(app)/_layout.tsx:13` 的同名重定向。
src: apps/mobile/app/(auth)/login.tsx:47,50,59,61,75-79,28,33；app/index.tsx:27
steps:
  1. `ensure_app`（lib.sh:150）
  2. 清掉会话以保证落在登录页：`adb shell pm clear "$PKG"`，然后用 dev-client intent 冷启（`exp+multica-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081`）
  3. `wait_text "Sign in to Multica"`
  4. `tap_text "you@example.com"`（TextField placeholder；该输入框 `autoFocus`，正常冷启后已聚焦，可跳过本步直接 `input_text`）
  5. `input_text "probe551@example.com"`
  6. 断言 `Send code` 的节点从 `enabled="false"` 变 `enabled="true"`
  7. `tap_text "Send code"`
expect: 首屏可见 `Sign in to Multica`（login.tsx:47）、`Enter your email and we'll send you a verification code.`（login.tsx:50）、`Send code`（login.tsx:79）。邮箱为空时 `Send code` 为 `enabled="false"`（login.tsx:75-77 `disabled={submitting || !email.trim()}`），填入邮箱后变 `enabled="true"`——这是「输入框真的收到了文本」的最硬判据。点击后 push 到验证码页，出现 `Enter verification code`（verify.tsx:82）。失败时输入框下出现 `Couldn't send the code. Try again.`（login.tsx:33，经 `lib/auth-error` 映射）。
note: 提交中按钮文案瞬时为 `Sending...`（login.tsx:79，**三个 ASCII 点**，与 C2 的 `…` 不同），只能当瞬时判据，不要当稳定断言。
未确认: `multica://login` 的深链形式；`@` 在 `adb shell input text` 中的可传性（失败则用 `%40` 或 `input keyevent` 逐字）。

### C2 验证码（OTP 6 格 → Verify）
route: 无（需点击进入）。尝试值 `multica://verify?email=probe551%40example.com`——**未确认**；可靠路径是从 C1 点 `Send code` 后 push 过来（login.tsx:28）。
src: apps/mobile/app/(auth)/verify.tsx:45,82,85,95,97,106,111,117,126-130,139；components/ui/otp-input.tsx:41-57；node_modules/input-otp-native/src/input.tsx:77-93,122
steps:
  1. 从 C1 `tap_text "Send code"` 跳过来
  2. `wait_text "Enter verification code"`；OTP `autoFocus`（verify.tsx:95）→ 键盘应已弹起（`mInputShown=true`）
  3. `input_text "888888"`（夹具开发码，seed-fixtures.sql:5）
  4. 逐格判据：6 个格子依次出现 `text="8"`（共 6 个同级 Text 节点）
  5. 若只想验按钮：只输 5 位 → 断言 `Verify` 仍 `enabled="false"` → 补第 6 位
expect: 标题 `Enter verification code`（verify.tsx:82）、副标题 `We sent a 6-digit code to probe551@example.com`（verify.tsx:85，**邮箱是模板拼接**）。
**OTP 是 1 个 input，不是 6 个**：`input-otp-native` 只渲染**一个** `TextInput`（`node_modules/input-otp-native/src/input.tsx:77-93`，`testID="otp-input"`，Android 上 `opacity: 0`），6 个「格子」是 6 个 `View`（`components/ui/otp-input.tsx:41-46`），有值时每格渲染一个 `Text`（:52-58）。→ **不要试图 `tap_text` 找第 n 格**（空格子没有 text 节点）；用整串 `input_text`（依赖 autoFocus），或 `tap_edit 1` 聚焦那个隐藏 `EditText` 后再输入。
`Verify`（verify.tsx:111）在 `code.length < 6` 时 `enabled="false"`（:106）。**输入满 6 位会自动提交**（verify.tsx:97 `onComplete={submit}`）——所以正常流程下 `Verify` 按钮几乎点不到，这条要按「自动提交」写期望，不要按「点按钮」写。提交中按钮瞬时为 `Verifying...`（:111，ASCII 三点）。
倒计时行是**动态文本**：`Resend code in 60s` → 逐秒递减 → 到 0 后变 `Resend code`（verify.tsx:126-130）。倒计时中该行 `disabled`（:117），不可点。断言只用前缀 `Resend code in`，**不要**匹配 `Resend code` 字面（会和就绪态/`Resend code in …` 同时命中）。
出错时 `Couldn't verify the code. Try again.`（verify.tsx:45）。底部 `Use a different email`（:139）→ 回登录页。
未确认: 隐藏 EditText 在 uiautomator 里的 bounds（`opacity:0` 不改布局，理论上仍在 OTP 容器处，故 `tap_edit 1` 是可行兜底）；后端是否接受开发码 `888888`（不接受就得从服务端日志取真码）。

### C3 工作区选择
route: 无 workspace 段。尝试值 `multica://select-workspace`（`goto_raw`）——**未确认**；可靠路径是登录成功后无 slug 时自动重定向（`app/index.tsx:28`），或 `more/settings` 里点另一个工作区（`more/settings.tsx:52-56` 的 `onSwitch`）。
src: apps/mobile/app/(app)/select-workspace.tsx:28,30,35,52-55,63-71,82-83；components/ui/card.tsx:20-42；app/index.tsx:28
steps:
  1. 跑完 C1 + C2（`verify.tsx:48` 成功后 `router.replace("/")`）
  2. `wait_text "Select a workspace"`
  3. `ui_dump` 取真实工作区名（夹具下应有 2 项：`probe550`、`probe542` 两个工作区的**名称**字段未在 SQL 里设置 → **未确认**，只能先 dump）
  4. `tap_text "<工作区名>"`
expect: 顶部 `Signed in as`（:28）+ 当前邮箱（:30，动态）；标题 `Select a workspace`（:35）。
每个列表项是一个 `CardPressable`（`components/ui/card.tsx:20-42`，**无 accessibilityLabel**），内含 `<Text>{ws.name}</Text>`（:63-68）与 `/{ws.slug}`（:69-71）→ uiautomator 里会出现「合并节点（`<name>, /<slug>`）」+「`text="<name>"`」+「`text="/<slug>"`」三类节点（对照 §0.6 第 1 条）。所以 `tap_text "<name>"` 可用，`tap_text "/probe550"` 也可用（slug 是确定值，比 name 更稳）。
点任一项 → `setCurrentWorkspace()` + `router.replace('/<slug>/inbox')`（:24-26），落到收件箱（出现 `Inbox` 标题）。
空态：`You don't belong to any workspaces yet. Contact your workspace admin to be invited.`（:52-55）；加载失败：`Failed to load workspaces: <message>` + `Retry`（:42-49）。底部 `Sign out`（:83）→ 回登录页。
未确认: 工作区**名称**字段；`multica://select-workspace` 深链形式。

### C4 收件箱（列表 / 未读态 / 左滑归档 / 顶部批量菜单）
route: `inbox`
src: apps/mobile/app/(app)/[workspace]/(tabs)/inbox.tsx:56-63,73-79,85,92-100,112,118,185,188；components/inbox/inbox-row.tsx:32,38,44-52,63,80,95；components/inbox/swipeable-inbox-row.tsx:35-41,46,64-72,100-107；lib/inbox-display.ts；components/ui/app-header-actions.tsx:29,37；data/mutations/inbox.ts:67-72
steps:
  1. `goto inbox`；`wait_text "Inbox"`
  2. 断言顶部三个可点元素：`tap_desc "Inbox actions"`（inbox.tsx:118）、`Search`、`New issue`（app-header-actions.tsx:29,37）
  3. `tap_text "probe550 把 PRB-1 指派给了你"`（夹具第 1 条未读行）→ 进入 issue 详情
  4. `press_back` 回收件箱，再 `ui_dump` 确认该行**圆点消失**（已读）
  5. 左滑第 2 行：`swipe_left_text "<该行标题>"` → 出现 `Archive`
  6. `tap_desc "Archive"`（或 `tap_text "Archive"`，两者都命中同一按钮）
  7. `tap_desc "Inbox actions"` → 面板；`ui_dump` 校验 5 个选项文本
expect: 标题 `Inbox`（inbox.tsx:112，`components/ui/header.tsx:44-52` 渲染 `text-lg`）。
**行内可匹配文本**：行本身是 `Pressable`（inbox-row.tsx:38，**无 accessibilityLabel**）→ 行内文本会合并。可匹配：标题 `text="<displayTitle>"`（:63，`getInboxDisplayTitle(item)`，非 quick_create / autopilot 类型时就是 `item.title` 原样）；副标题来自 `InboxDetailLabel`（:80，**按 type 变文案**，动态）；右侧 `timeAgo` 相对时间（:95，动态）。
夹具下三行的标题**确定**为（`item.title` 原样）：`probe550 把 PRB-1 指派给了你`、`probe550 在 PRB-1 的评论中提到了你`、`PRB-2 有一条新评论`。
**未读态（源码口径，不是分组）**：未读 = 标题左侧一个 `size-1.5 rounded-full bg-brand` 圆点（:44-45）+ 标题字重 `font-medium text-foreground`（:51）；已读 = 无圆点、标题 `text-muted-foreground`（:52）。**没有「未读分组」**：列表是**一层** `FlatList`，数据先经 `deduplicateInboxItems` 去掉已归档 + 按 `issue_id` 去重，再按 `created_at` 倒序（`lib/inbox-display.ts` 末段 `sort`）。点开一行时会**先乐观置 read 再导航**（inbox.tsx:56-63 → `data/mutations/inbox.ts:67-72` 在 `await cancelQueries` **之前**同步 `setQueryData`）→ 「点进再返回，圆点应消失」是最可靠的未读判据。
**左滑**：`react-native-gesture-handler/ReanimatedSwipeable`（swipeable-inbox-row.tsx:35-41 + `:69` 只给 `renderRightActions`）→ **只有左滑**（从右向左拖）出 80px 宽红色按钮，按钮 `content-desc="Archive"` 且内文 `text="Archive"`（:101-107）。`friction={2}`、`rightThreshold={80}`（:64-67）。**只露不自动执行**（文件头 :4-8）——必须再点一次 `Archive`。点后该行从列表消失（乐观 `archived:true`，`data/mutations/inbox.ts:104-110`）。
**顶部批量菜单**（`tap_desc "Inbox actions"` 之后，Android 是 JS `Modal` 面板，`components/ui/action-sheet.tsx`）：选项文本 `Cancel` / `Mark all read` / `Archive all read` / `Archive completed` / `Archive all`（inbox.tsx:73-79），面板标题 `Inbox`（:85）。选 `Archive all` 会再弹**原生 Alert**：标题 `Archive all?`、按钮 `Cancel` / `Archive all`（:92-100）。
空态：`Inbox zero` + `Mentions, assignments, and agent updates appear here.`（:185,188）。
note: 行标题 / 副标题 / 时间全是运行时数据——脚本必须**先 dump 取第一行真实文本**再点，不要硬编码（夹具值仅供人工核对）。
未确认: 夹具导入后 `InboxDetailLabel` 对 `issue_assigned` / `mentioned` / `new_comment` 三种 type 的确切文案（该文件本次未逐行读，文案按 type 拼）；`timeAgo` 的取值形态（`40m` / `3h` 之类）。

### C5 issue 详情（时间线 / 评论卡 / 表情 / ⋯ 菜单）
route: `issue/<ISSUE_ID>`（**UUID**，例：夹具 issue#1；不要用 `issue/1` 或 `issue/PROB-1`——identifier 过长会在前序任务里被截断/兜底成时间戳而解析失败）
src: apps/mobile/app/(app)/[workspace]/issue/[id].tsx:119-124,131,140,160,172；components/issue/timeline-list.tsx:361-367；components/issue/issue-header-card.tsx:22-27；components/issue/attribute-row.tsx:41-44,125,133,158,177,185,195,204,213；lib/issue-status.ts:76-84,93-99；components/issue/comment-card.tsx:225-286；components/issue/comment-context-menu.tsx:94-107,235-253；components/issue/reaction-bar.tsx:69-80；components/issue/inline-comment-composer.tsx:59-60；components/composer/message-composer.tsx:461-462,499-509,559,566,573,589；components/ui/icon-button.tsx；app/(app)/[workspace]/issue/[id]/comment/[commentId]/emoji-picker.tsx:73,77-81；app/(app)/[workspace]/_layout.tsx:275-278；lib/quick-emojis.ts:11-19
steps:
  1. `goto issue/<ISSUE_ID>`；`wait_text "Activity"`
  2. 头部：断言 identifier 文本（原生 header title）、issue 标题、6 个属性 chip 文本
  3. `tap_desc "Issue actions"` → 菜单；校验选项文本；`press_back`（这条同时是 B2）
  4. 长按第 1 条评论：`long_press_text "**加粗**"`（或评论里任意稳定片段）→ `tap_text "React…"`
  5. `tap_text "More reactions…"` → 进入 emoji-picker 页；`wait_text "Add Reaction"`；`press_back`
  6. `tap_desc "Add a comment, @ to mention…"` → composer 展开；校验 `Send` / `Mention someone or an issue` / `Add a comment…`
expect: 原生 header 标题 = `issue.identifier`（issue/[id].tsx:160 `title: issue?.identifier ?? "Issue"`；布局里注册的初始值是 `Issue`，`_layout.tsx:181`）。
`⋯` 按钮：**`content-desc="Issue actions"`**（issue/[id].tsx:172，`IconButton` = `Button variant=ghost size=icon` + Ionicon，`components/ui/icon-button.tsx`）。点开走 `showActionSheet`（`components/ui/action-sheet.tsx`）→ Android 上是 **JS `Modal` 面板**（不是原生 Alert）。选项文本（全部静态字面量，可直接 `tap_text`）：`Cancel` / `Pin`|`Unpin` / `Edit details` / `Copy link`（仅当 `EXPO_PUBLIC_WEB_URL` 有值） / `Open on web`（同上） / `Delete issue`（issue/[id].tsx:119-124）；面板标题 = identifier（:131）。`Edit details` → `issue/<id>/edit`（:140）。`Delete issue` → 原生 Alert `Delete issue?`，按钮 `Cancel` / `Delete`（:214-220）。
时间线结构（`components/issue/timeline-list.tsx:361-367`）：`IssueHeaderCard` → `IssueDescription` → `IssueReactionRow` → 分节标题 **`Activity`**（:365-367 静态字面量）→ 评论卡…→ 底部 composer。
头部卡片（issue-header-card.tsx:22-27）：`issue.identifier`（小字）+ `issue.title`（2xl 粗体）+ `AgentActivityRow`（无 task 时自渲染 null）+ 属性 chip 行。
**属性 chip 的可匹配文本**（`attribute-row.tsx`，chip 本身是 `Pressable` 无 accessibilityLabel，靠内文匹配）：
- status chip = `labelOf(issue.status)`。内置词表 `lib/issue-status.ts:76-84`：`Backlog` / `Todo` / `In Progress` / `In Review` / `Done` / `Blocked` / `Cancelled`；自定义 status 用工作区目录名（**动态**）。夹具 issue#1 → **`In Progress`**。
- priority chip = `PRIORITY_CHIP_LABEL[priority]`（attribute-row.tsx:41-44 把 `none` 改写成 `Priority`，其余取 `lib/issue-status.ts:93-99`：`Low`/`Medium`/`High`/`Urgent`）。夹具 issue#1 → **`High`**；issue#2 → **`Medium`**。
- assignee chip：有值 = 显示名（:149），无值 = **`Assignee`**（:158）。夹具 → probe551 的显示名（用户姓名未在 SQL 设置 → **未确认**，可能是邮箱前缀）。
- label chip：每个标签一个 chip，文本 = 标签名（:177）；一个都没有时单个 chip 文本 = **`Label`**（:185）。夹具 issue#1 → `android`、`回归`。
- project chip：有值 = 项目标题（:195），无值 = **`Project`**（:204）。夹具 → **`Android 回归项目`**。
- due date chip = `formatDueDate(due_date)`（`Jul 3` 这种 `月 日`），无值 = **`Due date`**（:213）。夹具 issue#1 → 今天+7 的 `M D`（**动态**）。
**评论卡**（`components/issue/comment-card.tsx`）：整块气泡外面是 `Pressable onLongPress`（`delayLongPress={500}`）→ **只有长按**才出动作面板（`useCommentLongPress`）。面板选项（`comment-context-menu.tsx:94-107`，条件显示）：`Reply` / `React…`（恒有）、`Copy` 与 `Select Text`（有正文时）、`Copy Link`（有 webUrl + identifier 时）、`Resolve Thread`|`Unresolve Thread`（仅根评论）、`Delete`（仅自己的）、`Cancel`。选 `Reply` 会让 composer 自动展开并显示 `Replying to <名字>`（`components/composer/message-composer.tsx:499-509`，前缀 `Replying to ` 是静态字面量）。已解决线程默认收成一条 bar：`Resolved · N message(s) by <作者>`（comment-card.tsx:283-286），点击展开；展开后有 `Collapse`（:332）。
**表情链路**：`React…` → 第二张面板（**替换**第一张，不是叠加——action-sheet.tsx:66-73 注释），选项 = 前 5 个 emoji + `More reactions…` + `Cancel`（comment-context-menu.tsx:235-236）。前 5 个取自 `lib/quick-emojis.ts:11-19` 的 `👍 👌 ❤️ ✅ 🎉 😕 🚀 👀` 前 5 位 → 面板上就是 **`👍` `👌` `❤️` `✅` `🎉`**（emoji 本身就是按钮文本，可直接 `tap_text "👍"`）。点 `More reactions…` → push formSheet 路由 `issue/<id>/comment/<commentId>/emoji-picker`（comment-context-menu.tsx:239-253；注册见 `_layout.tsx:275-278`）。
**emoji-picker 页**（`…/comment/[commentId]/emoji-picker.tsx`）：静态页眉 **`Add Reaction`**（:73）；下方是 `rn-emoji-keyboard` 的 `<EmojiKeyboard enableSearchBar enableRecentlyUsed categoryPosition="top">`（:77-81）。选中任一 emoji → `toggle.mutate(...)` + `router.back()`（:60-64）。
**反应条**（`components/issue/reaction-bar.tsx`）：有反应才渲染。每个 chip 是可点 `Pressable`，内含两个 `Text`（emoji 与数量，:69-80），**无 accessibilityLabel** → 只能按 emoji 字符或坐标命中；数量动态。夹具：issue#1 有 `👍`×1（渲染成 `👍` 与 `1`），评论#1 有 `🎉`×1。
**评论 composer**：收起态是一个 `Pressable`，`content-desc` 就等于 `pillLabel`（message-composer.tsx:461-462），本屏值是 **`Add a comment, @ to mention…`**（inline-comment-composer.tsx:60）。展开后：TextInput placeholder = **`Add a comment…`**（:59），工具条四个 `IconButton` 的 content-desc = `Mention someone or an issue`、`Upload image`、`Upload file`、**`Send`**（message-composer.tsx:559,566,573,589）；有回复目标时多一个 `Cancel reply`（:501）。
未确认: emoji-picker 里**单个 emoji** 的可匹配文案（第三方库 `rn-emoji-keyboard` 内部节点，未读源码）；其搜索框 placeholder（`enableSearchBar` 已开，placeholder 值未知）；反应条 chip 在 uiautomator 里的节点形态（可能是合并的 `👍, 1`，也可能是两个相邻 Text）；probe551 的**显示名**；due date chip 的具体日期字符串。

### C6 编辑 issue 与新建 issue
route: 编辑 `issue/<ISSUE_ID>/edit`（`presentation: "modal"`，标题 `Edit Issue`，`_layout.tsx:202-206`）；新建 `new-issue`（modal，标题 `New Issue`，`_layout.tsx:372-376`）
src: apps/mobile/app/(app)/[workspace]/issue/[id]/edit.tsx:20-23,127,141,163,167,175,180-190；app/(app)/[workspace]/new-issue.tsx:120；components/issue/create-form-attribute-row.tsx:76-79,85,91,112,124,136；components/issue/submit-issue-button.tsx:24；app/(app)/[workspace]/_layout.tsx:202-206,300-322,372-376
steps:
  1. `goto issue/<ISSUE_ID>/edit`；`wait_text "Edit Issue"`
  2. 断言 header：左 `Cancel`（edit.tsx:127）、右 `Save`（:141，初始 `enabled="false"`——`canSave` 要求 dirty，edit.tsx:82-83）
  3. `tap_text "Issue title"` → `input_text " <后缀>"` → 断言 `Save` 变 `enabled="true"`；`tap_text "Save"` → modal 关闭回详情
  4. 重新进入，改成别的再 `tap_text "Cancel"` → 出现原生 Alert `Discard changes?` / `Keep editing` / `Discard`（edit.tsx:90-99）
  5. `goto new-issue`；`wait_text "New Issue"`
  6. `tap_text "Issue title"`（placeholder，new-issue.tsx:120）→ `input_text "<标题>"`
  7. 逐个进属性 picker：`tap_text "Priority"` → `wait_text "Priority"` → `tap_text "Urgent"` → 回表单，chip 变 `Urgent`
  8. `tap_text "Assignee"` → picker（标题 `Assignee`）→ 选一项
  9. `tap_text "Due date"` → Android 上降级成**全屏 modal** + 原生 DatePicker 对话框（`_layout.tsx:93-96`）→ `Done` / `Clear`
  10. `tap_text "Project"` → picker → 选 `Android 回归项目`
  11. `tap_desc "Create issue"` → 创建并回上一屏
expect: **编辑页只有两个字段、没有属性 chip**：文件头 edit.tsx:20-23 明确「Properties（status / priority / assignee / labels / project / due_date）**不在**这里编辑，它们在详情页的 chip picker 上」。页面结构：`Field label="Title"`（:163）+ `<TextInput placeholder="Issue title">`（:167）、`Field label="Description"`（:175）+ `DescriptionField`（:176）。`Field` 把 label 渲染成 `text-xs uppercase tracking-wider`（:180-190）→ 屏幕上是 **`TITLE`** / **`DESCRIPTION`**（大写）。
新建页结构（new-issue.tsx）：`<TextInput placeholder="Issue title">`（:120，`text-2xl`、`autoFocus`）+ `DescriptionField`（:127）+ `CreateFormAttributeRow`（:131）。
**新建页属性 chip 的入口文本**（`components/issue/create-form-attribute-row.tsx`，chip 均无 accessibilityLabel，靠内文匹配）：
- status chip = `labelOf(draft.status)`（:85）；draft 初始值 `todo` → **`Todo`**（`lib/issue-status.ts:78`）
- priority chip = `priorityLabel`，draft 初始 `none` → **`Priority`**（:78-79 显式把 none 写成占位文案）
- assignee chip = assignee 显示名，未选 → **`Assignee`**（:76-77, :112）
- due date chip = `formatDueDate(dueDate)`，未选 → **`Due date`**（:124）
- project chip = `project?.title ?? "Project"`，未选 → **`Project`**（:136）
点击分别 push `new-issue-picker/{status,priority,assignee,due-date,project}`（:59-65；注册 `_layout.tsx:300-322`，`due-date` 用 `DUE_DATE_OPTIONS` = Android 降级全屏 modal）。picker 里选中后**回到新建表单且 chip 文本变成新值**（draft store 跨屏，create-form-attribute-row.tsx 文件头注释）。
提交按钮：`content-desc="Create issue"`（`components/issue/submit-issue-button.tsx:24`），标题为空时 `disabled`（new-issue.tsx:56 `canSubmit = !isSubmitting && title.trim().length > 0`）。
失败时原生 Alert `Failed to create issue` / `<message>`（new-issue.tsx:79-82）。
未确认: `DescriptionField`（`components/issue/description-field.tsx`）内部 TextInput 的 placeholder（本次未读）——描述字段请先用 `ui_dump` 找那个 `android.widget.EditText`（`tap_edit 1` 兜底）；picker 里各选项的行文本（priority 取 `PRIORITY_LABEL`，status 取目录名，project 取项目标题，均在 C5/C6 上半部分有词表）。

### C7 聊天（composer / 气泡 / 待发重试）
route: `chat`
src: apps/mobile/app/(app)/[workspace]/(tabs)/chat.tsx:405-455,479-500,307-329；components/chat/chat-composer.tsx:109-116,141；components/composer/message-composer.tsx:462,501,559,566,573,589；components/chat/chat-session-actions.tsx:29,36；components/chat/chat-title-button.tsx:33；components/chat/status-pill.tsx:81,94,95,102-114,155-160；components/chat/chat-message-list.tsx:308-325,507-522；components/chat/chat-empty-state.tsx:27-38；components/chat/offline-banner.tsx:35-58；components/chat/runtime-required-banner.tsx:10-12
steps:
  1. `tap_text "Chat"`（tab；**不要用 tap_desc**，见 §0.6 第 3 条）
  2. `wait_text "Message…"`；断言 header：`tap_desc "Sessions and agent picker"`（标题按钮）、`tap_desc "Session actions"`（有活跃会话时）、`tap_desc "New chat"`（恒有）
  3. 断言夹具历史消息文本：`这条消息用于检查聊天页的历史气泡渲染。`（user 气泡）、`已收到。`（assistant 气泡，Markdown 列表）
  4. `tap_desc "Message…"` → composer 展开；断言 `Send` / `Mention someone or an issue` / `Upload image` / `Upload file` 四个 content-desc 出现
  5. `input_text "回归探针 <时间戳>"` → `tap_desc "Send"`（或直接回车）
  6. 断言发送中：composer 收起态文案变 `Agent is working…`，且 `Send` 被替换为 `tap_desc "Stop agent"`；消息流末尾出现状态行
expect: 头部三个按钮的 content-desc：`Sessions and agent picker`（`chat-title-button.tsx:33`）、`Session actions`（`chat-session-actions.tsx:29`，仅有活跃会话）、`New chat`（:36）。注意会话 `⋯`（`Session actions`）触发的是删除确认 Alert（chat.tsx:487-500：`Delete this chat?` / `Cancel` / `Delete`），**不是** picker。
**composer content-desc = `Message…`**（`chat-composer.tsx:115` 的 `pillLabel` → `message-composer.tsx:462` 的 `accessibilityLabel`）。发送中变为 **`Agent is working…`**（chat-composer.tsx:112）。若 agent 不可用则显示 `disabledReason`：`No agent selected` / `You can no longer run this agent` / `No agents in this workspace` / `This chat is archived` / `Agent needs a runtime`（chat.tsx:440-455）。展开后 TextInput 的 placeholder 同为 `Message…`（chat-composer.tsx:109）。
**发送按钮**：展开态的工具条最右是 `content-desc="Send"`（`message-composer.tsx:589`）；`sending===true` 时整颗被替换成 `content-desc="Stop agent"`（`chat-composer.tsx:120,141`）——**这是「发送中」最硬的判据**（默认 `allowStop` 为真，只有 `pendingTask.status === "queued"` 时 chat.tsx:435 传 `allowStop=false`，那时不渲染 Stop）。
**气泡**（`chat-message-list.tsx`）：user 气泡 = 右对齐 `max-w-[80%] bg-muted` 的 `Pressable`（:308-325），**无 accessibilityLabel** → 只能匹配气泡里的 Markdown 文本（夹具文本见上）。assistant 行有 Markdown + 附件卡 + 结束语（`Replied in <N>` / `Finished in <N>` / `Failed after <N>`，`chat-message-list.tsx:515-519`，**动态**）。长按任一气泡出动作面板（与评论同一套 `showActionSheet`）。
**待发 / 重试状态的可匹配文本**：消息流末尾的 `StatusPill`（`components/chat/status-pill.tsx`）是**一行静态文案 + `· <秒数>`**（:155-160）：`Queued`（:94）/ `Starting up`（:95）/ `Thinking`（:107,110）/ `Typing`（:111）/ `Retrying`（:81）/ `Offline`（:88）/ `Reconnecting`（:91）/ `Running command`|`Reading files`|`Searching code`|`Making edits`|`Searching web`|`Working`（:43-53,114-116）。`Offline` 是静态（不带动画点），其余带三个呼吸点。断言用前缀匹配（`text` 后面还跟 ` · 12`）。
**注意**：聊天**没有**「发送失败 → 就地 Retry/Discard」的行内affordance（那是**评论**才有的，见 C5 的 `FailedActions`）。聊天发送失败走 `Alert.alert("Message not sent", <原因>)` + composer 恢复草稿（chat.tsx:409-431）。
空态（无消息时）：标题 `Hi, I'm <agent 名>` 或 `Chat with your agents`（chat-empty-state.tsx:title），首次会话多一行 `Examples fill the composer without sending.`；三个起步按钮的 `content-desc` 就等于其 label：`What can you help with?` / `Suggest a first task` / `Recommend an action`（:27-38，agent 配了 `conversation_starters` 时换成自定义 label —— **动态**）。
横幅（在 composer 上方）：agent 离线 = `<名字> is offline. Messages will wait until its runtime is back.`（offline-banner.tsx:56）；不稳 = amber 版文案（:35-48，**未逐字确认**）；无 runtime = `<名字> needs a runtime before it can run. Bind one on web or desktop.`（runtime-required-banner.tsx:11）；工作区无 agent = `NoAgentBanner`（点它进 `more/agents`）。
未确认: offline-banner 的 unstable 分支逐字文案；`StatusPill` 秒数部分的具体格式（`· 12` 还是 `· 12s`，取决于 `lib/format-elapsed`，本次未读）。

### C8 项目列表与详情
route: 列表 `more/projects`（原生 header 标题 `Projects`，`_layout.tsx:346-349`）；详情 `project/<PROJECT_ID>`
src: apps/mobile/app/(app)/[workspace]/more/projects.tsx:105-106,114-119；components/project/project-row.tsx:33-70；app/(app)/[workspace]/project/[id].tsx:90-96,114-116,131-138,157-160；components/project/project-properties-section.tsx:52-104,127-132；components/project/project-header-card.tsx；components/project/project-resources-section.tsx；components/project/project-related-issues.tsx
steps:
  1. `goto more/projects`；`wait_text "Projects"`
  2. 断言 header 右侧 `tap_desc "New project"`（projects.tsx:106）
  3. `tap_text "Android 回归项目"`（`ProjectRow` 的行文本 = `project.title`，project-row.tsx:38-43）→ 进详情
  4. 详情：断言属性区三行 `Status` / `Priority` / `Lead`（project-properties-section.tsx:59,70,81 的 `label`）
  5. `tap_text "Status"` → picker（`project/<id>/picker/status`）→ 选一项 → 回详情，右值变新值
  6. `tap_desc "Project actions"` → 菜单；校验 `Cancel` / `Pin`|`Unpin` / `Edit details` / `Open on web`（有 `EXPO_PUBLIC_WEB_URL` 时）/ `Delete`（project/[id].tsx:89-96）
expect: 列表页：header 标题 `Projects`（`_layout.tsx:348`）+ headerRight 的 `content-desc="New project"`（projects.tsx:106）。每行 `ProjectRow` 是 `Pressable`（project-row.tsx:33，**无 accessibilityLabel**）→ 可匹配内文：标题 = `project.title`（:38-43）；副行左侧 = 项目状态文案（`projectStatusLabel(project.status)`，`lib/project-status.ts`，**动态**）；有优先级时再跟一个优先级文案；右侧 `done/total`（:56，动态，无 issue 时是 `—`）与 `timeAgo`（:64，动态）。空态：`No projects yet` + `Create project`（projects.tsx:115,118）。
详情页：header 标题 = 项目标题（project/[id].tsx:title），headerRight `content-desc="Project actions"`（:159）。属性区（`project-properties-section.tsx`）是 3 个 `Pressable` 行，行内文本 `Status`（:59）/ `Priority`（:70）/ `Lead`（:81，右侧值 `leadName` 或 `Unassigned`）。夹具项目 → `In Progress`（或对应文案）/ `High` / probe551 显示名。
筛选 sheet 路由：`project/<id>/picker/status`、`.../priority`、`.../lead`（project/[id].tsx:onPress*）；`.../add-resource`（formSheet，`_layout.tsx:292-295`）。`Lead` picker 的搜索框 placeholder = `Search members or agents`（`app/(app)/[workspace]/project/[id]/picker/lead.tsx:21`）。
`Project actions` 菜单选项（project/[id].tsx:89-96）：`Cancel` / `Pin`|`Unpin` / `Edit details` / `Open on web`（条件） / `Delete`；`Delete` → 原生 Alert `Delete project?` / `Cancel` / `Delete`（:130-138）。
未确认: `projectStatusLabel` / `projectPriorityLabel` 的词表逐字（本项目未读 `lib/project-status.ts`）；`ProjectHeaderCard` / `ProjectResourcesSection` / `ProjectRelatedIssues`（C8 只要求列表与详情入口，这三块的内部文本本次未展开）。

### C9 全局搜索（入口 + 输入框）
route: `search`（modal，标题 `Search`，`_layout.tsx:379-385`）
src: apps/mobile/app/(app)/[workspace]/search.tsx:436-456,468-474；components/ui/app-header-actions.tsx:24-30；components/ui/modal-close-button.tsx:20-27；app/(app)/[workspace]/_layout.tsx:379-385
steps:
  1. 入口 A（推荐，走真实路径）：`goto inbox` → `tap_desc "Search"`（app-header-actions.tsx:29）
     入口 B：`goto search`
  2. `wait_text "Search issues and projects"`
  3. `tap_text "Search issues and projects"`（placeholder，search.tsx:446）→ `input_text "回归"`
  4. 断言分组标题与大写分组（`lib/search-rows.ts` 决定顺序：项目 → issue → Cancelled 段）
  5. 清空输入（`tap_desc "Clear search"` 或全选删除）→ 断言空查询态（Recent）
expect: 输入框 placeholder = **`Search issues and projects`**（search.tsx:446），`autoFocus` 已开（:448）。`search.tsx` 顶栏没有额外的搜索图标按钮（IconButton 未带 accessibilityLabel 的只有装饰性 `Ionicons name="search"`，:443）。modal 左上关闭按钮 `content-desc="Close"`（`components/ui/modal-close-button.tsx:26`）。
无结果：`No results for “<输入>”`（:472，**含中文全角引号 `“` `”`**，且 `<输入>` 是动态）。加载中转圈（:468-470）。分组标题是大写字面量（由 `lib/search-rows.ts` 产出，本次未逐字读 → **未确认**）。
结果行点击后 `router.replace` 到目标（search.tsx:138-146 注释明确：modal 被原子替换成 card 呈现），所以**从搜索结果进详情后按 BACK 回的是收件箱而不是搜索页**——这点与 B 组判据相关。
未确认: 分组标题逐字文案（`PROJECTS` / `ISSUES` / `CANCELLED` 之类）；Recent 段的标题与行文本；搜索结果行内是否带可匹配的 status 标签文本（`SearchIssueRow` 里有一个状态文案 `Text`，:300 附近，本次未逐字读）。

### C10 设置（主题 / 通知 / 工作区 / 退出登录）
route: `more/settings`（标题 `Settings`，`_layout.tsx`）、`more/settings/notifications`（标题 `Notifications`）、`more/settings/profile`（标题 `Profile`）
src: apps/mobile/app/(app)/[workspace]/more/settings.tsx:35-39,70-77,95,111-119,123,154,167-180,189；more/settings/notifications.tsx:29-56,105,135,140；more/settings/profile.tsx:188-190,198-202,221-222；components/ui/switch.tsx；components/ui/radio-group.tsx
steps:
  1. `goto more/settings`；`wait_text "Settings"`
  2. 断言分组标题 `Account`（:95）/ `Workspaces`（:123）/ `Appearance`（:154）；`Account` 组里 `Notifications`（:118）
  3. 主题：`tap_text "Dark"`（:37）→ 断言 `Light`/`Dark`/`System` 三行仍在、界面转深色（截图肉眼可判）
  4. `tap_text "Notifications"` → 通知页；断言 6 组开关 + `System notifications`
  5. `press_back` → 设置页；`tap_text "<工作区名>"`（`Workspaces` 组，:145-160）→ 切工作区（跳到 `/<slug>/inbox`）
  6. 退出登录：`tap_text "Sign out"`（页面底部按钮，:189）→ 原生 Alert → **用 `tap_id_button1`** 点「Sign out」（见下方 note）
expect: 设置页结构（settings.tsx）：`Account` 组 = NavRow（头像 + 用户名 + 邮箱，:96-113，点它 → Profile）+ `Notifications`（:118，副标题 `Inbox and system alerts`）；`Workspaces` 组 = 每个工作区一行（:145-160，行内文本 = 工作区名 + `/<slug>`，当前工作区行 `disabled` 且右侧是 `checkmark`）；`Appearance` 组 = `Light` / `Dark` / `System` 三行（:36-38，每行是 `Pressable`，行内文本就是词表值）；底部 `Sign out` 红色按钮（:189）。
主题切换：`RadioGroup` + 每行一个外层 `Pressable` + 内层 `RadioGroupItem`，文 **/点行/都调 `setPreference`**（:167-180 与 :155-166 的双入口注释）。判据：点 `Dark` 后界面转深色、`Light` 行不再选中（radio 圆点位置变化，截图可判）。
通知页（notifications.tsx）：分组 `Inbox notifications`（:105）下 6 行，行文本 = 开关左侧的 label：**`Assignments` / `Status changes` / `Comments` / `Mentions` / `Issue updates` / `Agent activity`**（:29-56），其中 4 行还有灰色描述行；分组 `System`（:135）下 1 行 `System notifications`（:140）。每行右侧是 `Switch`（**无 accessibilityLabel**，需按行坐标或直接 `tap_text "<label>"` 命中整行区域外的开关——建议按行 bounds 右侧 1/4 处坐标点）。
Profile 页（profile.tsx）：头像 `Pressable`（无 label，下方静态提示 **`Tap to change photo`**，:189）；字段标题 `Name`（:198）+ `TextField placeholder="Your name"`（:202）；`Email` 段只读；底部 `<Button>` 内文 `Save`（`enabled="false"` 直到 dirty，:221-222），保存中瞬时 `Saving…`（U+2026）。点头像出动作面板：`Take Photo` / `Choose from Library` / `Remove Photo`（仅有头像时）/ `Cancel`（profile.tsx:73-90）。
**退出登录的坑**：点页面上的 `Sign out` 后弹原生 Alert，其**标题也是 `Sign out`**，按钮是 `Cancel` 与 `Sign out`（settings.tsx:69-77）→ 此刻 `ui_dump` 里 `text="Sign out"` 至少命中 3 个节点（页面按钮、Alert 标题、Alert 按钮），`tap_text` 的 `head -1` 很可能点回标题（无效果）。**必须**用 §0.3 的 `tap_id_button1`（Alert 的 positive 按钮 = `resource-id="android:id/button1"`）或按 `class="android.widget.Button"` 过滤后取最后一个匹配。退出后断言：回到登录页（出现 `Sign in to Multica`）。
未确认: 开关的确切 bounds 策略（`Switch` 无 label）；工作区行的显示名（同 C3）。

---

## B 组 · 返回路径

> 判据共用两条硬断言：**① 该关闭的浮层文本消失；② `mCurrentFocus` 仍是 `$PKG/.MainActivity`（没退到后台、没换 tab）。** 只做 ① 会把「面板关了」和「应用退到后台」混为一谈——那正是 FEATURE-548 修掉的缺陷。

### B1 sheet 叠 sheet（issue 详情 → 属性 picker → BACK）
route: 无（需点击进入）—— 必须**从详情页点 chip**进 picker，才有「两层」；直接深链 picker 时路由会用 `anchor: "(tabs)"` 自挂底层（§0.6 第 2 条），不是同一回事
src: apps/mobile/components/issue/attribute-row.tsx:99-105,125-135；app/(app)/[workspace]/issue/[id]/picker/status.tsx:22-29；components/issue/pickers/status-picker-body.tsx:41-43；app/(app)/[workspace]/_layout.tsx:72-79,217-224；lib/use-android-back-dismiss.ts:5-9
steps:
  1. `goto issue/<ISSUE_ID>`；`wait_text "Activity"`
  2. `tap_text "In Progress"`（status chip；chip 文本见 C5 词表）→ picker 打开
  3. `wait_text "Status"`（picker 页眉，status-picker-body.tsx:42 静态字面量）
  4. `press_back` **一次**
  5. 断言：`Status` 消失；`Issue actions` 仍在；`mCurrentFocus` 仍是本应用
  6. （可选）再 `press_back` 一次：应回到 tab 层
expect: 一次 BACK 只关掉**最上面一层**。机制依据：formSheet / modal 路由是 react-native-screens 的栈成员，BACK 由 RNS 弹栈（`lib/use-android-back-dismiss.ts:5-9` 文件头明确把浮层分成三类，这一类的 BACK 归 RNS）；picker 自己**没有**注册 `BackHandler`。`SHEET_OPTIONS` 在 Android 上把 `formSheet` 落成 Material BottomSheet（`_layout.tsx:50-71` 注释）。
可复用判据：picker 打开前后 `ui_dump` 的 text 集合做差集——增量应恰好是 picker 内容（`Status` 页眉 + 选项行），减量应恰好是它；`Issue actions` 从出现到出现一直在。
note: 第二段 BACK 的落点取决于栈底：从详情进来是 `[tabs → issue → picker]`，故第二次 BACK 回**详情**（`Issue actions` 仍在）；只有从 tab 根进来才回 tab。写判据时不要写死「回 tab」。
未确认: Android 上 Material BottomSheet 关闭时 `ui_dump` 是否残留一个不可见节点（若残留，改用 bounds 判「不在屏内」）。

### B2 modal 套 modal（详情 → ⋯ 菜单 → BACK）
route: 无（需点击进入）
src: apps/mobile/app/(app)/[workspace]/issue/[id].tsx:108-131,172；components/ui/action-sheet.tsx:66-73,105,118-136；lib/use-android-back-dismiss.ts:5-9
steps:
  1. `goto issue/<ISSUE_ID>`；`wait_text "Activity"`
  2. `tap_desc "Issue actions"` → 菜单开
  3. `wait_text "Edit details"`（任一选项文本；确认菜单真的开了）
  4. `press_back` **一次**
  5. 断言：`Edit details` 消失 + `Issue actions` 仍在 + `mCurrentFocus` 仍是本应用（**不是** launcher / 不是别的 activity）
expect: 一次 BACK **只关面板**，导航栈不动。机制：Android 上这不是原生 ActionSheet，而是 JS 的 RN `<Modal onRequestClose={dismissActionSheet}>`（`action-sheet.tsx:118-136`），RN 自己把 BACK 接到 `onRequestClose`（`lib/use-android-back-dismiss.ts:5-9` 第一节）；`dismissActionSheet` 关面板并按 iOS 语义回报 `cancelButtonIndex`（:129-136）。所以 BACK 不会冒泡到导航器（导航器收到 BACK 会弹栈到 tab 根，再 BACK 就退到后台——这是必须排除的失败模式）。
**两处容易误判**：① 面板是**替换**语义不是叠加——`open()` 直接 `set({current})`，注释明说「第二个 dialog 会被 Android 丢掉」（`action-sheet.tsx:66-73`）；所以别把「点了另一项后出现第二张面板」当成叠加测试，B2 只测 BACK。② 菜单选项随状态变（`Pin`/`Unpin`、`Copy link`/`Open on web` 的存在与否），断言挑一个**恒存在**的（`Edit details` 或 `Cancel`）。
未确认: RN `Modal` 关闭后 uiautomator 是否残留节点（`Modal transparent animationType="fade"`，通常卸载即无节点）。

### B3 picker 选中一项后的落点
route: 无（需点击进入）
src: apps/mobile/app/(app)/[workspace]/issue/[id]/picker/status.tsx:26-29；app/(app)/[workspace]/issue/[id]/picker/due-date.tsx:36-46,66-80；components/issue/pickers/label-picker-body.tsx:3-8；components/issue/attribute-row.tsx:36-38；app/(app)/[workspace]/_layout.tsx:93-96；components/issue/pickers/status-picker-body.tsx:44-64
steps:
  1. `goto issue/<ISSUE_ID>`；`tap_text "In Progress"` → picker
  2. `wait_text "Status"`
  3. `tap_text "Todo"`（status picker 的选项行；`statusOptions(catalog)` 的内置 7 项词表见 C5）
  4. 断言：`Status`（picker 页眉）消失；**详情页的 status chip 文本变成 `Todo`**
  5. 重复一次用 priority picker：`tap_text "High"` → `wait_text "Priority"` → `tap_text "Urgent"` → chip 变 `Urgent`
expect: **选中即提交 + 立即 `router.back()`**，没有中间态、没有残留空壳。依据：状态 picker 路由 `onChange` 里 `updateIssue.mutate({status: next})` 紧接着 `router.back()`（status.tsx:26-29）；priority / assignee / project 同构（都是自包含路由 + `useUpdateIssue` + `router.back()`）。
判据取「**详情页 chip 文本变成新值**」而不是「picker 消失」——因为 mutation 是乐观更新，chip 变化才是业务上真正落地的证据。
**两个例外必须分开写**：
- **`due-date` 不是这个模型**：它用页内 `Done` / `Clear` 按钮（due-date.tsx:71,79），点 `Done` 才 `updateIssue.mutate` + `router.back()`（:37-41），`Clear` 写 `due_date: null` 再 back（:42-45）；且 Android 上整条路由降级为**全屏 modal**（`_layout.tsx:93-96`，原因是 formSheet 里的 DatePicker DialogFragment 收不到输入）。
- **`label` 是多选且不关闭**：点一项只 toggle、sheet 保持打开（`attribute-row.tsx:36-38` 注释 + `label-picker-body.tsx:3-8` 文件头）。所以 label picker 的判据是「chip 列表新增/去掉一个 chip、picker 仍在」。
未确认: picker 里各选项行的确切文本（status = 目录标签、priority = `PRIORITY_LABEL`、project = 项目标题、assignee = 成员/agent 名 + `Unassigned`，见 C5/C8）；`assignee` picker 行在 uiautomator 里是否合并成 `Unassigned, <名>` 这种形态（对照 `screens/01-issue-assignee-01-baseline.txt` 里出现 `∅, Unassigned,` / `Unassigned` 两代节点）。

### B4 More 菜单（`components/nav/more-tab-dropdown.tsx`）打开与 BACK
route: 无（需点击 tab）
src: apps/mobile/app/(app)/[workspace]/(tabs)/_layout.tsx:122-138；components/nav/more-tab-dropdown.tsx:79-92,102-107,139-140,146-150,171-189,216,290-292；lib/use-android-back-dismiss.ts；node_modules/@react-navigation/bottom-tabs/src/views/BottomTabItem.tsx:347-348
steps:
  1. 先停在任意 tab 根（例：`goto inbox`；`wait_text "Inbox"`）
  2. `tap_text "More"`（**不要** `tap_desc "More"`，见 §0.6 第 3 条）
  3. `wait_text "Pinned"`（菜单出现了）
  4. 断言菜单项文本：`Account settings` / `Switch workspace`(仅 >1 工作区) / `Pinned` / `Issues` / `Projects`
  5. `press_back` **一次**
  6. 断言：`Pinned` 与 `Projects` 消失；`text="More"` 仍在（tab 还在）；`mCurrentFocus` 仍是本应用；**没有换 tab**（例如原先在 Inbox，`Inbox` 标题仍在且是当前 tab）
expect: 「More」tab 是**动作**不是导航目标——`listeners.tabPress` 里 `e.preventDefault()` 后 `moreTriggerRef.current?.open()`（`(tabs)/_layout.tsx:130-137`）；菜单由与 `<Tabs>` 同级的 `MoreTabDropdownAnchor` 渲染（:141）。
菜单内容：顶部 `Account settings` 行（`more-tab-dropdown.tsx:216`，点它 → `more/settings`）→ 分隔线 → `Switch workspace` 行（:290-292，**仅当工作区数 > 1** 时可点；=1 时 `disabled` 且 accessibilityLabel 退化成工作区名）→ 分隔线 → `Pinned` / `Issues` / `Projects` 三行（:79-92 的 `NAV_ITEMS`，`accessibilityLabel` 与 `label` 同名，:175 → `tap_text` 与 `tap_desc` **都**能命中）。
BACK 行为：菜单是 `@rn-primitives` 画在 `PortalHost` 里的**普通视图**，既不注册 BACK 也不进导航栈 → 未修时按 BACK 会直接落到导航器，在 tab 根节点等于**把应用退到后台而菜单还留在屏幕上**。修法就是 `useAndroidBackDismiss(menuOpen, closeMenu)`（:105-107，hook 见 `lib/use-android-back-dismiss.ts`）。→ **这条是回归重点**，判据里第 6 步（没退到后台、没换 tab）不可省。
a11y 干扰项已排除：隐藏的锚点 Pressable 标了 `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`（:139-140），不会在 a11y 树里抢节点。
未确认: 单工作区时 `Switch workspace` 行的实际 content-desc（= 工作区名）；菜单打开动画期间 `ui_dump` 是否会 `could not get idle state` 失败（`lib.sh:39-46` 已重试 3 次，足够）。

### B5 图片查看器
route: 无（需点击进入）。触发点只有一种：**点一张图片**
src: apps/mobile/lib/markdown/lightbox-provider.tsx:24-31,60-88,104-116；apps/mobile/lib/markdown/markdown-image.tsx:100-112；apps/mobile/components/issue/comment-attachment-list.tsx:78-88；apps/mobile/components/issue/composer-attachment-row.tsx:187-203,220-226；apps/mobile/app/_layout.tsx:20,89；node_modules/react-native-image-viewing/dist/ImageViewing.js:44,49-52；node_modules/react-native-image-viewing/dist/components/ImageDefaultHeader.js:14-19；lib/use-android-back-dismiss.ts:5-9
steps:
  1. 准备一张图：任一 issue 的描述 / 评论正文里要有 `![](url)` 图片（**夹具 SQL 里没有造图片附件 → 跑之前必须先造一张**，否则本条无法执行）
  2. `goto issue/<ISSUE_ID>`；`ui_dump` 找图片节点（见下 note 的兜底）
  3. 点图片中心（`tap_xy`）
  4. 断言：整屏变黑底 + 图片；右上角出现 `✕`
  5. `press_back` **一次**
  6. 断言：`✕` 消失 + 回到详情页（`Add a comment, @ to mention…` 仍在）+ `mCurrentFocus` 仍是本应用
expect: 查看器是 `react-native-image-viewing` 的 `<ImageView>`，挂在 app 根部的 `LightboxProvider`（`app/_layout.tsx:20,89`）。它是一个 RN 原生 `<Modal onRequestClose={...}>`（`ImageViewing.js:44`）→ **BACK 由 RN 接到 `onRequestClose`**，直接关闭（`lib/use-android-back-dismiss.ts:5-9` 把原生 Modal 归为「不用管」的那一类）。
关闭按钮：默认页眉就是 `ImageDefaultHeader`，唯一元素是 `<Text>✕</Text>`（`ImageDefaultHeader.js:16-18`，U+2715）→ `tap_text "✕"` 是第二条可用的关闭路径。
多图时才有的计数：底部 `n / N`（`lightbox-provider.tsx:74-86`，仅当 `total > 1`；`ImageSequenceProvider` 由 `components/issue/timeline-list.tsx:101,392` 提供整屏图片数组）。
**触发点没有 accessibilityLabel**：`MarkdownImage` 只包了一层无名 `Pressable`（`markdown-image.tsx:100-112`），图片是 `expo-image` 的 `<Image>`。可点位置（三处，都用 `MarkdownImage`）：issue 描述里的图片（`components/issue/issue-description.tsx`）、评论正文里的 `![](url)`（`components/issue/comment-card.tsx`）、评论附件里未被正文引用的图片（`comment-attachment-list.tsx:78-88`）。→ 脚本兜底：`ui_dump` 里取 `class="android.widget.ImageView"`（或 `expo-image` 渲染的 View）节点中**面积最大**的那个，点它的中心。
**唯一带标签的入口**：composer 草稿里已上传完成的图片 chip，`content-desc` = `Open <filename>`（`composer-attachment-row.tsx:220-226`，点它 `open(item.localUri)` → `:187-203`）。但它只存在于**未发送的草稿**里，不能当常规路径。
未确认: 三方库关闭按钮 `✕` 在 uiautomator 里的 text 值（在 `Text` 节点上，理论上就是 `✕`，但 `includeFontPadding:false` 不影响 a11y）；`expo-image` 在 Android 上暴露的节点 class 与是否可点（必要时退化为「点 timeline 上半部固定坐标」并在报告里标注为坐标兜底）；**夹具是否真的会造出图片附件**。

---

## 缺口 / 阻塞清单（主 agent 收口时逐条销）

1. **`lib.sh:30` 的 `PKG` 默认值过时**（`ai.multica.mobile.dev` → 实际 `com.ehaier.zgq.shop.mall.dev` / `.staging`）。不改则所有深链与冷启失败。
2. **缺长按 / 左滑 / 等文本 / 点 id 四个原语**（§0.3）。C4（左滑归档）、C5（评论长按菜单 + 表情链路）、B5 都直接依赖长按与左滑，没有它们这几条跑不了。
3. **C1/C2/C3 的深链形式未确认**（三条路由没有 workspace 段，`lib.sh` 的 `goto` 拼法不适用）→ 需要 `goto_raw`，并接受「靠无会话冷启 / 点 Send code / 重定向进入」这条更稳的路径。
4. **必须运行时取值、不能写死的文本**：收件箱行标题/副标题/时间（C4）、工作区名（C3/C10）、各种 `timeAgo` 与 `formatDueDate` 输出（C5/C7/C8）、`Resend code in <N>s`（C2）、`StatusPill` 的 `· <秒数>`（C7）。脚本先 dump 再点。
5. **同名文本冲突（C10 退出登录）**：原生 Alert 的标题与按钮同名，必须用 `resource-id="android:id/button1"` 或取最后一个匹配。
6. **数据前置**：B5 需要至少一张真实图片附件，夹具 SQL 未造；C4 的滑动手势需要收件箱至少有 1 行（夹具给了 3 行）；C3/C10 需要 2 个工作区（夹具给了）；C7 需要 agent + runtime，夹具只造了会话与消息，**agent 可用性与 runtime 绑定未在夹具里体现** → C7 的「发送 → `Agent is working…` / `Stop agent`」这条可能因 `Agent needs a runtime` 而走不通，届时按 §C7 的 disabled 分支记录。
7. 其余 `未确认` 均在各条的 `未确认:` 行；它们都只需要跑一次 `ui_dump` 就能收敛，不阻塞脚本骨架的编写。
