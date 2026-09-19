# FEATURE-546 · Android 选择器搜索框实测记录

7 个搜索型 picker 路由在 Android 模拟器上逐条实测：搜索框是否存在、能否输入过滤、清除后是否恢复。
所有结论都来自本目录 `screens/` 的 dump 与截图；复现方式见 §2，原始文本清单为同名的 `.txt`（由 dump 抽取）。

- 截图/dump 目录：`research/screens/`（1080×2400）
- 驱动脚本：`research/capture-search.sh`（`ANDROID_SERIAL=<serial> bash capture-search.sh <out-dir> [wait]`）
- 每路由 4 个阶段：`01-baseline`（初始）→ `02-filtered`（输入正例关键字）→ `03-nomatch`（追加 `zzzq`）
  → `04-cleared`（点 ✕ 清除）

---

## 1. 结论摘要

| # | 结论 | 证据 |
|---|---|---|
| 1 | 7 条路由在 Android 上都渲染出搜索框（`android.widget.EditText`，占位符文本可见），无一条缺失 | `screens/*-01-baseline.txt` |
| 2 | 输入关键字后列表被正确过滤，追加 `zzzq` 后进入空态，点 ✕ 清除后恢复全量 | `screens/*-04-cleared.txt` 与 baseline 逐字一致 |
| 3 | ✕ 清除按钮存在且可点（`content-desc="Clear search"`），驱动脚本 7/7 找到 | 脚本退出码 0（failures: 0） |
| 4 | 首帧 sheet 顶到 maxHeight（top ≈ 5%）—— `autoFocus` 触发输入框聚焦的既有 Android 行为，同 FEATURE-547 §6.4 | `screens/*-01-baseline.png` |
| 5 | iOS 侧无可用模拟器运行时（`xcrun simctl list runtimes` 为空），只给代码级证据，见 §5 | — |

---

## 2. 复现方式（本机已验证）

1. **后端**：`COMPOSE_PROJECT_NAME=multica-probe542 docker compose -f docker-compose.selfhost.yml up -d postgres backend`
   （复用 542/547 的卷，种子工作区 `Probe 542` 仍在；`.env` 里 `PORT=8090`、`MULTICA_DEV_VERIFICATION_CODE=888888`）。
2. **移动端 env**：`apps/mobile/.env.development.local` → `EXPO_PUBLIC_API_URL=http://10.0.2.2:8090`。
3. **构建**：`JAVA_HOME=/opt/homebrew/opt/openjdk@21 ANDROID_HOME=$HOME/Library/Android/sdk pnpm android:mobile`
   （= `expo prebuild -p android` + `expo run:android`，包名 `ai.multica.mobile.dev`，Debug）。
   注意本机 `pnpm` 需用仓库锁定的 10.28.2（`/opt/homebrew/bin/pnpm` 是 11.15.1，会在 `pnpm -C` 这一步报版本不符）：
   用 `PATH=~/.local/share/fnm/node-versions/v24.15.0/installation/bin:$PATH`。
4. **模拟器**：`Medium_Phone_API_35`（API 35，1080×2400），所有 adb 命令带 `-s emulator-5554`。
5. **加载 bundle**：`am start -n ai.multica.mobile.dev/.MainActivity -a android.intent.action.VIEW -d "exp+multica-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081"`
   （直接点 dev-client 的最近列表也行；用 `10.0.2.2` 而非局域网 IP，emulator 一定能到）。
6. **种子标签**：`Probe 542` 工作区原本没有任何标签，label picker 只有空态。为拿到正例，先在 label picker 里
   输入 `android546` 并点 `Create “android546”` 建一个标签（顺带验证了 body 的 inline create 路径）。
7. **驱动**：`ANDROID_SERIAL=emulator-5554 bash research/capture-search.sh research/screens 3`。

深链用 `multica://probe542/<path>`（必须带 `-n <pkg>/.MainActivity`，dev/staging 共用 scheme）；路由间重置用 BACK。

---

## 3. 逐路由结果

`baseline → 输入关键字 → +zzzq → ✕ 清除`。表格里的「行」是 dump 里可见的列表文本。

| 路由 | 关键字 | 过滤后 | 追加 zzzq | ✕ 清除 |
|---|---|---|---|---|
| `issue/[id]/picker/assignee` | `probe` | `Unassigned` 消失，`probe542` / `Probe Agent` 保留 | `No matches.` | 三行全部恢复 |
| `issue/[id]/picker/label` | `android` | `Create “android”` 行 + `android546` | `Create “androidzzzq”`（无精确匹配时创建行优先，符合设计） | 恢复为 `android546` |
| `issue/[id]/picker/project` | —（见 §4） | — | `No matches.`，`No project` 行消失 | `No project` + `探针项目` 恢复 |
| `mention-picker` | `probe` | `Everyone (@all)`/`SQUADS` 消失，PEOPLE/AGENTS/ISSUES 命中保留（PRO-1/PRO-2） | `No matches.` | 恢复 |
| `new-issue-picker/assignee` | `probe` | 同上 assignee | `No matches.` | 恢复 |
| `new-issue-picker/project` | —（见 §4） | — | `No matches.`，`No project` 行消失 | 恢复 |
| `project/[id]/picker/lead` | `probe` | `Unassigned` 消失，`probe542` / `Probe Agent` 保留 | `No matches.` | 恢复 |

7 条路由的 `04-cleared` 文本清单与 `01-baseline` **逐字一致**（脚本里逐路由对比过），说明清除语义与
`useScrollToTopOnChange(query)` 的复位路径在 Android 上成立。

---

## 4. 两个 project picker 为什么没有「正例过滤」步骤

`adb shell input text` 只能注入 ASCII，而种子工作区唯一的项目名是 `探针项目`（纯中文），无法从模拟器输入；
本轮也刻意不在业务库里造第二个项目。因此这两条路由用负例证明 query 确实进了过滤逻辑：
非空 query 下 `No project` 行会消失（`ProjectPickerBody` 只在 `!q` 时把 `No project` 放进 rows），
输入 `zzzq` 后只剩 `No matches.`，清除后两者回来。这条代码路径与 assignee/lead 完全相同。

---

## 5. iOS 侧证据（本机无法跑模拟器）

`xcrun simctl list runtimes` 输出为空 —— 本机没有任何 iOS 运行时，无法启动模拟器（同 FEATURE-547 的处境）。
改为代码级证据：

1. `usePickerSearchBar` 的 iOS 分支与改动前逐字相同：同样的 `navigation.setOptions({ headerSearchBarOptions })`、
   同样的 `placeholder` / `autoCapitalize: "none"` / `hideWhenScrolling: false` / `autoFocus` /
   `onChangeText` / `onCancelButtonPress`。
2. iOS 上 `searchBar === null`，7 个路由返回的 fragment 里只剩原来那一个 body 节点 —— 渲染子树与改动前一致
   （FlatList 仍是路由的直接子节点，`react-native-screens#3634` 的头部偏移前提不变）。
3. `_layout.tsx` 里这 7 条 `<Stack.Screen>` 的 options 值一个都没改（只改了注释）；`SHEET_OPTIONS` 与
   `DUE_DATE_OPTIONS` 的取值未动。
4. 平台判断只在 `lib/use-picker-search-bar.tsx` 与 `components/ui/search-field.tsx` 内部，7 个路由文件里没有
   `Platform.OS`（`rg -n "Platform" apps/mobile/app/(app)/[workspace]/*picker*` 无命中）。

---

## 6. 平台观察（写回 spec 的部分）

- **`headerShown: true` 在 Android 完全不渲染**：本轮的 7 条路由里 3 条带该配置，实测 sheet 顶边就是搜索框，
  没有标题节点、没有额外高度 —— 与 547 §6.2 的 `uiautomator dump` 结论一致。故 Android 不需要为它写平台分支。
- **`autoFocus` 会把 formSheet 顶到 maxHeight**：搜索框 `autoFocus: true`（对齐 iOS 的「搜索优先 picker 打开即聚焦」）
  会让 sheet 首帧展开（top ≈ 5%），同 547 §6.4 记录的 `project/[id]/add-resource`。这是 Android 平台行为，
  不是本轮引入；本轮不改 `SHEET_OPTIONS`，也不为它加平台分支。
- **占位符可从 dump 读到**：RN `TextInput` 的 placeholder 在 uiautomator dump 里以 `text` 属性出现
  （`Search people` / `Search labels` / `Search projects` / `Search members or agents` / `Search people or issues`），
  所以脚本可以据此确认「搜索框存在且文案正确」，而不只是看到一个 `EditText`。
