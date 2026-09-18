# Android 端到端可行性探针报告

> 探针时间：2026-09-18 · 代码基线：`origin/main` @ `733b0a3fb` · 设备：Android 模拟器（非真机）
> 关联任务：FEATURE-542（父任务 FEATURE-553）· 平台 spec：`.trellis/spec/mobile/frontend/android-platform.md`

本报告只做定位，不含任何修复。除「为跑通探针临时加 `android.package`」外，未改动业务代码
（该临时改动已在提交前回滚，见 §3 A1）。所有结论都能对应到本文引用的命令输出原文或截图文件。

---

## 0. 结论摘要

- **能跑起来**：在 **JDK 21 + `ANDROID_HOME`** 两个条件下，`expo prebuild -p android` 与
  `expo run:android` 都成功，Debug APK 装进模拟器并正常启动，主流程各页面**全部能打开**，
  没有白屏、没有启动崩溃。（生成物 wrapper 的 Gradle 9.0.0 无需降级，见 §1.3。）
- **3 个阻塞运行的环境/配置项**（§3 A 组）：缺 `android.package`、默认 JDK 25 不能构建、
  `ANDROID_HOME` 未设置。三者互相独立，都要处理。
- **Android 上真正坏掉的功能是 5 处 `ActionSheetIOS` 菜单**（§3 B1）：点一下就红屏
  `Uncaught Error: ActionSheetManager doesn't exist`，功能完全不可用——这是本轮最需要优先处理的项。
- **7 个 picker 路由在 Android 上没有搜索框**（§3 B2）：`headerSearchBarOptions` 在 Android 无效，
  代码里也没有回退输入框，长列表只能肉眼滚。
- 已有安卓预留（`text-field`、OTP、下拉菜单）与带安卓实现的原生库（markdown / shiki / 图片选择器）
  实测**可用**，这部分估算成立。

---

## 1. 环境与命令

### 1.1 环境

| 项 | 实测值 |
|---|---|
| 主机 | Apple M1 Max / macOS 26.3.1 (Darwin 25.3.0) |
| 设备 | AVD `Medium_Phone_API_35`，Android **15 (API 35)**，1080×2400 @420dpi（**模拟器，非真机**） |
| adb | 1.0.41（`/opt/homebrew/bin/adb`） |
| Android SDK | `~/Library/Android/sdk`；探针开始时只有 `platforms/android-34` + `build-tools/{34,35}.0.0` |
| 构建期自动补齐 | Gradle 自行下载 `platforms/android-36`、`build-tools/36.0.0`、`ndk/27.1.12297006` |
| JDK（默认） | OpenJDK **25.0.2**（Homebrew）—— **不能用于构建**，见 A2 |
| JDK（实际使用） | Temurin **21.0.12.1**（探针中下载到 `~/jdk21/jdk-21.0.12.1+1/Contents/Home`）；同期 `brew install openjdk@21` 也装好（`/opt/homebrew/opt/openjdk@21`） |
| `JAVA_HOME` / `ANDROID_HOME` | 探针开始时**都未设置** |
| 后端 | 本机隔离自托管栈（compose project `multica-probe542`，宿主 `127.0.0.1:8090`，模拟器经 `10.0.2.2:8090` 访问），`APP_ENV=development` + `MULTICA_DEV_VERIFICATION_CODE=888888` |
| 生成物 wrapper | `gradle-9.0.0-bin.zip`（Expo SDK 55 模板默认）——**保持默认即可**，见 §1.3 |
| 构建类型 | **Debug**（`assembleDebug`，dev-client + Metro）；Release 未测 |

### 1.2 实际执行的命令与结果

工作目录 `apps/mobile`。命令按执行顺序排列，报错原文见 §7。

| # | 命令 | 结果 |
|---|---|---|
| 1 | `npx expo prebuild -p android` | ❌ 退出码 1：`Cannot automatically write to dynamic config at: app.config.ts` |
| 2 | 临时加 `android.package` 后再跑 `npx expo prebuild -p android` | ✅ `Created native directory` / `Finished prebuild`，生成 `apps/mobile/android/` |
| 3 | `npx expo run:android`（默认 JDK 25，wrapper Gradle 9.0.0） | ❌ `Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field 'JvmVendorSpec IBM_SEMERU'` |
| 4 | `./gradlew :app:assembleDebug`（wrapper Gradle 8.14.3，JDK 25） | ❌ `BUG! exception in phase 'semantic analysis' … Unsupported class file major version 69` |
| 5 | `./gradlew :app:assembleDebug`（wrapper 8.14.3，JDK 21，未设 `ANDROID_HOME`） | ❌ `SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path …` |
| 6 | `JAVA_HOME=<jdk21> ANDROID_HOME=~/Library/Android/sdk npx expo run:android` | ✅ `BUILD SUCCESSFUL in 7m 36s`，`Installing …/app-debug.apk`，`Starting Metro Bundler` |
| 7 | 保持 wrapper **Gradle 9.0.0** + JDK 21 + `ANDROID_HOME`，`./gradlew :app:assembleDebug` | ✅ `BUILD SUCCESSFUL in 3m 18s`（证明 wrapper 不需要降级） |
| 8 | `adb` 侧操作：`input tap/swipe/text`、`uiautomator dump`、`exec-out screencap` | ✅ 全部页面可操作、可取证 |

### 1.3 关于「Gradle 9 + foojay」的结论修正

排障过程中出现过 `JvmVendorSpec … IBM_SEMERU` 报错，一度被当成「Expo 模板 Gradle 9.0.0 与
RN 0.83.6 不兼容」。第 7 条命令推翻了它：**同一份 wrapper 9.0.0 在 JDK 21 下构建成功**。

因此该报错的触发条件是 **JDK 25**（Gradle 需要按构建脚本请求的工具链去解析 JDK 时才会走到那段
代码），不是 wrapper 版本。归因链：

- `node_modules/@react-native/gradle-plugin/settings.gradle.kts` 固定
  `id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0")`；
- 该版本引用了 `JvmVendorSpec.IBM_SEMERU`，而 Gradle 9.0.0 的 `gradle-jvm-services-9.0.0.jar`
  里 `JvmVendorSpec` 已无此字段（`unzip` 读常量池核对：只剩 `ADOPTIUM`、`AZUL` 等）；
- JDK 21 满足构建所需工具链 → 不走解析路径 → 构建正常；JDK 25 不满足 → 走解析 → 抛错。

**对后续任务的意义：不必给 wrapper 降级，也不必 patch 依赖，把 `JAVA_HOME` 固定到 21 即可。**

---

## 2. 主流程逐页结果

坐标系为 1080×2400；截图文件名对应 `apps/mobile/docs/android-probe/` 下的文件。

| # | 页面 | 结果 | 截图 |
|---|---|---|---|
| 1 | 启动 → 登录页 | ✅ 正常渲染（首启会先弹出 Expo dev menu 引导层，属 dev-client 行为） | `01-login.png` |
| 2 | 邮箱验证码登录 | ✅ 发码成功、跳转验证码页；6 位 OTP 输满**自动提交**（`input-otp-native`），无需点按钮 | `01-login.png` |
| 3 | 工作区选择 | ✅ 正确列出 `Probe 542 (/probe542)`；点选进入应用 | `02-workspace-select.png` |
| 4 | My Issues | ✅ 列表、Assigned/Created/Agents 分段、状态分组、行内优先级正常 | `03-my-issues.png` |
| 5 | 收件箱 | ✅ 冷启动后拉到记录、未读数角标 `1`；空态文案正常 | `04-inbox-list.png` |
| 6 | Issue 详情（PRO-2） | ✅ 标题、状态/优先级/指派人/标签/项目 chip、描述、Activity 全部渲染 | `05-issue-detail.png` |
| 7 | 发表评论 | ✅ 点开 composer → 输入 → Send，评论即时出现在 Activity | `06-comment-posted.png` |
| 8 | Markdown 渲染（PRO-1 描述） | ✅ 标题/粗体/斜体/行内码/链接/有序无序列表/嵌套/引用/表格全部正确 | `07-markdown-render.png` |
| 9 | 代码高亮（PRO-1 评论） | ✅ 语言标签 `ts`/`python`、`Copy code` 按钮、多色 token；见 §4 | `08-code-highlight.png` |
| 10 | formSheet：Label / Assignee 选择 | ✅ 以底部面板 + 遮罩呈现，Assignee 正确列出成员并标出当前选中项 | `09-formsheet-label.png`、`10-formsheet-assignee.png` |
| 11 | 项目列表 / 项目详情 | ✅ 列表（进度 `0/1`）、详情（进度条、Status/Priority 行）正常 | `18-projects.png` |
| 12 | 设置 / Profile | ✅ 设置页与个人资料页渲染、名称可编辑 | `19-account-settings.png` |
| 13 | 聊天 | ⚠️ 空态正常（`No agents available` + 禁用 composer）；本机无 agent，**消息气泡与长按菜单未测得** | `17-chat.png` |
| 14 | 全局搜索 | ✅ 自带输入框 `Search issues and projects` + RECENT 列表 | `20-search.png` |
| 15 | 图片选择器（评论 composer） | ⚠️ Android 系统 Photo Picker 能正常唤起；模拟器无图片，**选中后的上传链路未验证** | `16-image-picker.png` |
| 16 | ⋯ 菜单（issue / 评论 / 收件箱 / 项目 / 头像） | ❌ **红屏崩溃**，见 §3 B1 | `11-err-actionsheet-*.png` … `15-err-actionsheet-*.png` |

崩溃均表现为 RN 的错误覆盖层（`Uncaught Error` + 源码定位 + Call Stack + Dismiss），
页面本身还在，Dismiss 后可以继续操作；在正式构建里则是「点了没反应」。

---

## 3. 阻塞项清单

### A. 阻塞运行（不解决则构建/启动不了）

**A1. `app.config.ts` 缺 `android.package`，prebuild 直接退出**

> **包名已于 FEATURE-557 变更**：正式的 `android.package` 现为品牌包名 `com.ehaier.zgq.shop.mall[.dev/.staging]`。
> 以下内容保留 FEATURE-542 当时的临时值 `ai.multica.mobile.dev`，未回改。

- 现象：`npx expo prebuild -p android` → 退出码 1，输出
  `Cannot automatically write to dynamic config at: app.config.ts`，并要求补
  `{"android":{"package":"ai.multica.mobile.dev"}}`。
- 原因：`app.config.ts` 是动态配置，Expo 无法回写；iOS 侧有 `bundleIdentifier`，Android 侧没有对应字段。
- 最小复现：干净 worktree → `cd apps/mobile && npx expo prebuild -p android`。
- 本轮处理：**临时**加 `android: { package: "ai.multica.mobile.dev" }` 让探针跑通，提交前已 `git checkout` 回滚。
  正式修复应参照 iOS 的三段式（dev/staging/prod 各自 package）。

**A2. 默认 JDK 25 不能构建 Android**

- 现象 1（JDK 25 + wrapper Gradle 9.0.0，即 `expo run:android` 默认路径）：
  `Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field 'JvmVendorSpec IBM_SEMERU'`
  （触发原因见 §1.3）。
- 现象 2（JDK 25 + wrapper 8.14.3）：
  `BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_' Unsupported class file major version 69`。
- 结论：**JDK 25 不可用**，21 可用（JDK 21 下 Gradle 9.0.0 与 8.14.3 都构建成功）。
- 最小复现：`java -version` 为 25.x 时，在 `apps/mobile/android` 跑 `./gradlew :app:assembleDebug`。
- 建议：在项目文档/脚本里固定 `JAVA_HOME`（`/opt/homebrew/opt/openjdk@21` 或 `~/jdk21/...`）；
  `expo run:android` 不会替你挑 JDK。

**A3. `ANDROID_HOME` 未设置**

- 现象：`SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by
  setting the sdk.dir path in your project's local properties file at '…/apps/mobile/android/local.properties'`。
- 结论：**Gradle 不会自行探测 `~/Library/Android/sdk`**，必须显式给 `ANDROID_HOME`（或生成 `local.properties`）。
  Expo CLI 在 `expo run:android` 里也没有替我们补上，本次是手动导出后才通过。
- 最小复现：不设 `ANDROID_HOME` 直接 `./gradlew :app:assembleDebug`。

### B. 影响体验（能运行，但功能不可用或退化）

**B1. 5 处 `ActionSheetIOS` 在 Android 上运行时崩溃，菜单完全不可用**（**最高优先**）

统一报错：`Uncaught Error: ActionSheetManager doesn't exist`，Android 上不存在 `ActionSheetIOS` 原生模块。

| 触发路径 | 源码定位 | 截图 |
|---|---|---|
| Issue 详情右上角 ⋯ | `app/(app)/[workspace]/issue/[id].tsx:126` (`onPressMore`) | `11-err-actionsheet-issue.png` |
| 长按评论 | `components/issue/comment-context-menu.tsx:111` | `12-err-actionsheet-comment.png` |
| 收件箱右上角 ⋯ | `app/(app)/[workspace]/(tabs)/inbox.tsx:80` | `13-err-actionsheet-inbox.png` |
| 项目详情右上角 ⋯ | `app/(app)/[workspace]/project/[id].tsx:98` | `14-err-actionsheet-project.png` |
| 个人资料点头像 | `app/(app)/[workspace]/more/settings/profile.tsx:67` | `15-err-actionsheet-profile.png` |

- 最小复现：进任意 issue → 点右上角 ⋯（先在 dev menu 里关掉 Expo 悬浮按钮，见 B3）。
- 未点验但同源（`comment-context-menu.tsx:236`、`components/chat/message-long-press.tsx:56`）：
  代码路径相同，预计同样崩溃；聊天消息长按因本机无 agent 会话未能实测。
- 影响：这几个入口在 Android 上等于**没有**（编辑/删除/复制链接/移除头像等操作全部拿不到）。

**B2. 7 个 picker 路由在 Android 上没有搜索框**

- 触发：Assignee / Label / Project / Lead / Mention 等 picker（`lib/use-native-search-bar.ts` 的
  7 个调用方）。该 hook 只做 `navigation.setOptions({ headerSearchBarOptions })`，**没有 Android 回退输入框**。
- 实测：Assignee 面板（`10-formsheet-assignee.png`）只有列表，没有任何输入框——`autoFocus: true` 的
  「键盘自动弹出」同样失效。本机只有 1 个成员，所以只能证明「没有搜索入口」，不能证明长列表下的可用性差异。
- 影响：成员/标签/项目变多以后无法筛选，只能滚动找。
- **已修（FEATURE-546）**：hook 改名为 `lib/use-picker-search-bar.tsx` 的 `usePickerSearchBar`，非 iOS 平台
  由它返回共享的 `components/ui/search-field.tsx` 渲染在列表上方；7 条路由在 Android 上都有搜索框与清除按钮。
  实测记录见 `.trellis/tasks/09-18-android-picker-search/research/android-search.md`。（本报告其余内容保持探针时的原文）

**B3. dev 构建下 Expo 的悬浮 Tools 按钮遮挡右上角 ⋯**（仅 dev-client）

- 现象：Expo dev menu 的悬浮按钮固定在右上角（约 `910,77–978,145`），正好压住应用的 `Issue actions`
  按钮（`933,84–1038,189`），点击落到 dev menu 上。
- 本轮处理：在 dev menu 里关掉 `Tools button` 开关后正常。
- 结论：**只影响 dev 构建**，Release 无此问题；但会给所有开发者的手工验证带来误导。

### C. 可忽略 / 待观察

- **C1. Python 代码块着色偏弱**：`ts` 块多色明显（关键字/标识符/类型分色），`python` 块只有
  `def`/`return` 着色，列表推导式基本是单色。属 shiki 主题/语言包的观感问题，不影响功能。
- **C2. Markdown 表格**在窄屏按列渲染（`列1/列2/列3`），未观察到内容截断。
- **C3. 收件箱为空是数据问题**：本地后端里 `inbox_item` 由 autopilot / task / agent 流程写入，
  普通成员的指派与 `@提及` 不产生收件箱记录；探针为验证列表渲染手工插入了一条记录（`04-inbox-list.png`）。
  这不是缺陷，但说明**新自托管实例的收件箱天然为空**。
- **C4. 键盘避让**：评论 composer 输入时输入框被顶到键盘上方，未被遮挡，暂未见 `KeyboardAvoidingView`
  Android 分支缺失导致的可见问题；深色模式、横屏、平板未测。
  **（FEATURE-548 补记）** 该结论只对评论 composer 成立 —— 它走 `KeyboardStickyView`；聊天页与 6 个表单页
  那 8 处 `KeyboardAvoidingView` 在 Android 是空操作，API 35 模拟器实测聊天 composer 被键盘盖住，已改。

---

## 4. 原生化模块实测

| 能力 | 实现 | 实测结果 | 证据 |
|---|---|---|---|
| Markdown 渲染 | `react-native-enriched-markdown` | ✅ 标题（a11y 带 `heading`）、粗体/斜体/行内码、链接可点、有序/无序列表与嵌套、引用块、表格全部正确 | `07-markdown-render.png` |
| 代码高亮 | `react-native-shiki-engine` + `@shikijs/*` | ✅ 代码块带语言标签与 `Copy code`；`ts` 多色、`python` 部分着色；代码行是横向可滚动容器（长行不被换行破坏） | `08-code-highlight.png` |
| OTP 输入 | `input-otp-native`（纯 JS） | ✅ 6 格布局、数字键盘、输满自动提交、无需点按钮 | `01-login.png` |
| SegmentedControl | `@react-native-segmented-control/segmented-control` | ✅ 未崩溃；`My Issues` 的 Assigned/Created/Agents 分段与 `Todo 1` 分组正常。**注意**：该库在 Android 是 JS 模拟实现，视觉与 iOS 有差异，本轮只验证功能可用，未做像素比对 | `03-my-issues.png` |
| 图片选择器 | `expo-image-picker` | ⚠️ Android 系统 Photo Picker 正常唤起、可取消；模拟器无媒体文件，**未验证选中→上传→回显**（本机自托管栈也没配 S3/本地上传目录） | `16-image-picker.png` |
| formSheet | `presentation: "formSheet"`（18 路由） | ✅ 在 Android 渲染为底部面板 + 遮罩，内容与选中态正确；`Label` 空态、`Assignee` 成员列表均正常。**面板内容不出现在 `uiautomator` 无障碍树里**（只能在截图里看到），自动化取证要按截图做 | `09-formsheet-label.png`、`10-formsheet-assignee.png` |
| ActionSheetIOS | iOS 专有 | ❌ Android 无此模块，5 处全部运行时崩溃 | `11-err-actionsheet-*.png` … `15-err-actionsheet-*.png` |
| `headerSearchBarOptions` | `react-native-screens` | ❌ Android 无搜索框、无回退（全局搜索页是自带输入框，不受影响） | `10-formsheet-assignee.png`、`20-search.png` |
| `expo-secure-store` | — | ✅ 冷启动后会话保持，无需重新登录 | `04-inbox-list.png` |
| 网络/实时 | — | ✅ 登录、列表、详情、评论发布全部打到本机后端成功；未验证 WebSocket 实时推送 | 后端日志 |

---

## 5. 与既有评估结论的差异

| 既有结论（`android-platform.md` / 项目说明） | 实测 | 差异 |
|---|---|---|
| 「JDK 25 很可能导致 Gradle 直接失败」 | 确认失败，但**报错有迷惑性**：JDK 25 下的 `IBM_SEMERU` 看起来像 Gradle 9 不兼容，实为工具链解析路径被触发（§1.3）；换成 JDK 21 后 Gradle 9.0.0 与 8.14.3 都能构建 | **修正**：只需固定 JDK 21，**不需要**降级 wrapper 或 patch 依赖 |
| 「Android SDK 已安装，adb 可用」 | 确认，但 SDK 组件不全：只有 `platforms/android-34`，实际构建需要 **android-36 + build-tools 36 + NDK 27.1**（构建期自动下载，首次构建 7m36s） | **补充**：需预留首次构建时间与磁盘 |
| 「原生工程目录是 prebuild 生成物，安卓不需要手写原生代码」 | 确认：`android/` 全量生成，无需手写 Java/Kotlin | 成立 |
| 「`ActionSheetIOS` 有 6 处，需替换」 | 确认且**加重**：不是「写错了 API」，而是**点一下就红屏**，5 处已实测复现，Android 上这些菜单完全不可用 | **加重**：应从「需替换」升级为高优先修复项 |
| 「`headerSearchBarOptions` 在 Android 无效」 | 确认，并补充：**代码里没有回退输入框**，7 个 picker 在 Android 上没有任何筛选入口 | **加重** |
| 「formSheet 参数语义需实测校准」 | 实测可用：Android 上是底部面板 + 遮罩，选中态正确；但无障碍树拿不到面板内容 | **修正**：功能可用，取证方式要改 |
| 「`KeyboardAvoidingView` 的 iOS 分支 8 处，需确认是否要 `height`」 | 本轮只测到评论 composer（它走 `KeyboardStickyView`，所以正常），未测聊天页与表单页 | **由「暂缓」改为必改（FEATURE-548）**：这 8 处在 Android 渲染成普通 `View`，实测聊天 composer 被键盘盖住；已收敛到 `components/ui/keyboard-avoiding-view.tsx` |
| 「已有安卓预留（`text-field`、`dropdown-menu`、OTP）」 | 未发现问题；输入框、picker、OTP 都正常 | 成立 |
| 「原生库均带安卓实现」 | 确认（markdown / shiki / OTP / segmented / image-picker 均在 Android 生效） | 成立 |
| 原评估未列 | **新增阻塞**：prebuild 因缺 `android.package` 直接失败；`ANDROID_HOME` 未设置时 Gradle 不自动探测；dev 构建悬浮按钮遮挡右上角菜单 | **新增** |

---

## 6. 复现方式

一次性准备 JDK 21：`brew install openjdk@21`（或用 Temurin 21，本轮实际使用的就是 Temurin）。

1. 根目录 `pnpm install --frozen-lockfile`。
2. 起本机后端：复制 `.env.example` 为 `.env`，设置 `PORT=8090`、`APP_ENV=development`、
   `MULTICA_DEV_VERIFICATION_CODE=888888`、`JWT_SECRET=$(openssl rand -hex 32)`、`DO_NOT_TRACK=1`，然后
   `COMPOSE_PROJECT_NAME=multica-probe542 docker compose -f docker-compose.selfhost.yml up -d postgres backend`。
3. 新建 `apps/mobile/.env.development.local`（被 `.gitignore` 覆盖），写入两行：
   `EXPO_PUBLIC_API_URL=http://10.0.2.2:8090` 与 `EXPO_PUBLIC_WEB_URL=http://10.0.2.2:3000`。
   模拟器经 `10.0.2.2` 访问宿主 loopback，不要写 `localhost`。
4. 构建（两个条件缺一不可）：导出 `JAVA_HOME`（JDK 21）与 `ANDROID_HOME=$HOME/Library/Android/sdk`，
   在 `apps/mobile` 跑 `npx expo prebuild -p android`（需要 `app.config.ts` 里有 `android.package`），
   然后 `npx expo run:android`。生成物 wrapper 保持模板默认（Gradle 9.0.0）即可。
5. 登录：任意邮箱收码，验证码固定 `888888`（development 环境的 `MULTICA_DEV_VERIFICATION_CODE`）。

探针用的种子数据（工作区 `Probe 542`、项目 `探针项目`、`PRO-1` 富文本 issue、`PRO-2` 指派 issue、
带代码块的评论、一条手工插入的收件箱记录）都通过后端 HTTP API 与 SQL 写入，未改动仓库文件。

---

## 7. 附录：原始报错

**① prebuild（缺 android.package）**

```text
Cannot automatically write to dynamic config at: app.config.ts
Add the following to your Expo config

{
  "android": {
    "package": "ai.multica.mobile.dev"
  }
}
```

**② JDK 25 + Gradle 9.0.0**

```text
FAILURE: Build failed with an exception.
* What went wrong:
Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field 'org.gradle.jvm.toolchain.JvmVendorSpec IBM_SEMERU'
```

**③ JDK 25 + Gradle 8.14.3**

```text
FAILURE: Build failed with an exception.
* What went wrong:
BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_' Unsupported class file major version 69
> Unsupported class file major version 69
```

**④ 未设置 ANDROID_HOME**

```text
* Where:
Build file '…/apps/mobile/android/build.gradle' line: 24

* What went wrong:
A problem occurred evaluating root project 'Multica (Dev)'.
> Failed to apply plugin 'com.facebook.react.rootproject'.
   > A problem occurred configuring project ':app'.
      > SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path in your project's local properties file at '…/apps/mobile/android/local.properties'.
```

**⑤ ActionSheetIOS（5 处，报错文本一致，仅源码定位不同）**

```text
Uncaught Error
ActionSheetManager doesn't exist
Source
> 126 | ActionSheetIOS.showActionSheetWithOptions({     # issue/[id].tsx
Call Stack  onPressMore, [id].tsx:126:46
```

> 环境备注：仓库自带的 `docker-compose.selfhost.yml` 固定 `name: multica`。本机已存在同名自托管栈
> （operator 的生产实例，`~/workspace/serverdata/multica`），**直接 `docker compose up` 会与之冲突**。
> 探针全程用 `COMPOSE_PROJECT_NAME=multica-probe542` 隔离，后续任务请沿用。

---

## 8. 本轮未覆盖（后续任务边界）

- **真机**：全部结论来自 API 35 模拟器；未测真机性能、输入法差异、系统返回手势。
- **Release 构建**：只跑了 Debug；Hermes 打包、R8/Proguard、签名与 AAB 未涉及。
- **附件链路**：图片/文件上传、S3/本地存储回显未验证。
- **聊天完整链路**：需要真实 agent（会话列表、消息气泡、长按菜单、实时推送）。
- **深色模式 / 横屏 / 平板**：未测。
- **多成员、多标签、多项目场景**：picker 搜索缺失的真实体验影响需在有数据量的环境复测。
