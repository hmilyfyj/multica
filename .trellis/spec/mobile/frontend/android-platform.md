# Android 平台约定

> `apps/mobile` 从 iOS-only 扩展到 Android 的平台差异约定。新平台分支照此执行。

---

## 本仓库定位

- fork 自 `multica-ai/multica`（Go 后端 + React Native 移动端 + web/desktop 的 monorepo）。
- 本仓库当前主要开发方向：为 `apps/mobile`（Expo SDK 55 / React Native 0.83 / expo-router）打开 Android 平台。
- 同步上游：本地 remote `upstream` 指向 `multica-ai/multica`，需要时 `git fetch upstream && git merge upstream/main`。

## 平台差异原则

1. **差异集中封装，不散落**。同一类平台差异只实现一处（hook / 共享组件 / 集中配置），调用方无感。禁止在多个路由里各写一遍 `Platform.OS` 判断。
2. **不改 iOS 既有行为**。Android 适配以新增平台分支的方式实现，iOS 路径保持原样；改动后必须有 iOS 不受影响的确认。
3. **优先复用已有模式**。项目已有 body 渲染头部、formSheet、RNR 原语等模式；先复用再加新抽象，新的通用原语需至少 3 个调用方。
4. **生成目录不手改**。`ios/` 与 `android/` 都是 `expo prebuild` 生成物且在 `.gitignore` 中，配置一律写进 `app.config.ts` / `expo-build-properties`。

## 已知 iOS 专有点位（基线 commit `0358b7d5d`）

| 能力 | 位置 | 数量 | Android 状态 |
|---|---|---|---|
| `ActionSheetIOS` | `inbox.tsx:80`、`issue/[id].tsx:126`、`more/settings/profile.tsx:67`、`project/[id].tsx:98`、`components/chat/message-long-press.tsx:56`、`components/issue/comment-context-menu.tsx:111,236` | 6 处 | 已收敛到 `components/ui/action-sheet.tsx`（FEATURE-545）：iOS 转发原生 sheet，其余平台渲 JS 面板 |
| `headerSearchBarOptions`（原 `useNativeSearchBar`，现 `usePickerSearchBar`） | `mention-picker`、`issue/[id]/picker/{assignee,label,project}`、`new-issue-picker/{assignee,project}`、`project/[id]/picker/lead` | 7 路由 | 已由 FEATURE-546 收敛到 `lib/use-picker-search-bar.tsx` + `components/ui/search-field.tsx`：iOS 用原生 `UISearchController`，其余平台用 body 内搜索框 |
| `presentation: "formSheet"` + detents/grabber | `app/(app)/[workspace]/_layout.tsx` 的 `SHEET_OPTIONS` | 24 路由 | 参数全部生效但语义不同（挡位→`peekHeight`/`maxHeight`、只圆上两角、抓手不绘制），24 条逐条实测见 FEATURE-547 |
| `KeyboardAvoidingView` 的 iOS 分支 | 8 个表单/聊天页面 | 8 处 | `behavior` 取值为 `undefined`，需确认是否需要 `height` |

### 选择器搜索栏（FEATURE-546）

搜索框的唯一入口：`lib/use-picker-search-bar.tsx` 的
`usePickerSearchBar(placeholder, { autoFocus }) → { query, searchBar }`。

- iOS：`searchBar` 为 `null`，hook 只做 `navigation.setOptions({ headerSearchBarOptions })`；该路由必须在
  `_layout.tsx` 注册 `headerShown: true` + `title`，否则导航栏被隐藏、原生搜索栏无处显示。
- Android / web：`headerSearchBarOptions` 无实现（`react-native-screens` 4.23 的 Android 侧没有读取方），
  hook 返回 `components/ui/search-field.tsx` 元素，由路由渲染在列表**上方**。
- 7 个 picker 路由的调用形状固定为 `<> {searchBar} <XxxPickerBody … /> </>`：iOS 上 fragment 里只剩 body，
  FlatList 仍是路由的直接子节点（`react-native-screens#3634` 要求，不能包一层 `<View>`）。
- 搜索框禁止放进 `ListHeaderComponent`（列表刷新会带走 `TextInput` 焦点）。
- 清空语义：iOS 由原生取消按钮走 `onCancelButtonPress` 重置 query（原生清空不触发 `onChangeText`）；
  Android 由 `SearchField` 的清除按钮走 `onChangeText("")`。两端最终都回到空 query，
  `useScrollToTopOnChange(query)` 契约不变。
- `_layout.tsx` 里的 `headerShown: true` 在 Android 实测**完全不渲染**（无标题、无搜索框、不占高度），
  所以该配置只对 iOS 有意义，不需要平台分支；Android 的语义提示由 chip 与行内容承担。
- 既有缺口（本轮未修，属 iOS 可见行为）：`issue/[id]/picker/{label,project}`、`new-issue-picker/project`、
  `project/[id]/picker/lead` 注册的是裸 `SHEET_OPTIONS`（`headerShown: false`），导航栏隐藏 →
  原生搜索栏不显示，这 4 个路由在 iOS 上今天也没有搜索框。

### 已有的 Android 预留（不要重复造）

- `components/ui/text-field.tsx`：`includeFontPadding` / `textAlignVertical` 已按 Android 语义写好
- `components/ui/otp-input.tsx`：一次性验证码自动填充已由底层库承担
- `components/ui/dropdown-menu.tsx`：popover 行为按 iOS/Android 通用语义实现
- `components/ui/action-sheet.tsx`：动作菜单唯一入口（FEATURE-545）。`showActionSheet(options, onSelect)` 的字段与索引语义同 `ActionSheetIOS`，宿主 `ActionSheetHost` 挂在 `app/_layout.tsx`；调用点禁止直接 import `ActionSheetIOS`
- `components/ui/search-field.tsx`：选择器搜索框唯一入口（FEATURE-546）。由 `TextField` + 放大镜 + 清除按钮组成；
  `usePickerSearchBar` 在 iOS 返回 `null`、其余平台返回该元素，7 个 picker 路由只负责把它渲染在列表上方
- `.gitattributes`：`.trellis/workspace/*/journal-*.md` 使用 `merge=union`

### 原生依赖的 Android 支持（已核实）

| 依赖 | 状态 |
|---|---|
| `react-native-enriched-markdown@0.6.0` | tarball 内含 `android/src/main/jni/` C++ 桥接与 `build.gradle` |
| `react-native-shiki-engine` | 支持 arm64-v8a / armeabi-v7a / x86 / x86_64；Android 内存回收需 AppState 驱动 |
| `input-otp-native` | 纯 JS，无原生代码 |
| `@react-native-segmented-control/segmented-control` | Android 为 JS 模拟实现，视觉与 iOS 有差异 |

## Android 应用配置（FEATURE-543 实测，基线 commit `733b0a3fb`）

`app.config.ts` 是动态配置（`export default ({ config }) => …`），Expo 无法把缺失的平台字段回写进去，
所以下面每条都必须显式写在配置里；`android/` 是生成物，一律不手改。

| 配置 | 写法 | 依据 |
|---|---|---|
| `android.package` | 三段式 `ai.multica.mobile[.dev/.staging]`；生产可用 `EXPO_ANDROID_PACKAGE_PROD` 覆盖 | 缺失时 `expo prebuild -p android` 退出码 1（动态配置无法回写）；Play 首次上传后 applicationId 不可改，故生产值留覆盖口 |
| `android.versionCode` | 字面量，随商店上传递增 | 同一 package 内复用 versionCode 会被 Play 拒绝；不从 `version` 推导，避免版本号一改就静默变动 |
| `android.adaptiveIcon` | 前景 `assets/adaptive-icon.png`（白标 + 透明）+ 背景 `#111827` | 前景由 `assets/icon.png`（白标压在 #111827 上）反解而来，回合成与源图最大通道差 1 个 8bit 级；白标半径 28.4dp，落在任何 launcher 遮罩都保留的 33dp 圆内，不会裁切 |
| `android.edgeToEdgeEnabled` | **不写** | SDK 55 已移除该键（Android 16 强制 edge-to-edge），写了 prebuild 会告警要求删除；实际行为由模板 `gradle.properties` 的 `edgeToEdgeEnabled=true` 与 targetSdk ≥ 35 保证 |
| `android.permissions` | **不写 `READ_MEDIA_IMAGES`** | 相册读取在 Android 13+ 走系统 photo picker（`getMediaLibraryPermissions` 返回空数组，无需权限），≤12 走 `READ_EXTERNAL_STORAGE`（模板 manifest 已声明 `maxSdkVersion="32"`）；多写会被 Play 要求声明宽泛的相册访问 |
| camera / microphone | 由 `expo-image-picker` 插件的 `cameraPermission: false` / `microphonePermission: false` 关闭 | 这两个选项不只作用于 iOS：Android 侧会转成 blocked permissions，把 `CAMERA` / `RECORD_AUDIO` 从合并 manifest 中移除。注意 `more/settings/profile.tsx` 的头像菜单仍有 "Take Photo" 入口，关着相机时该入口在 Android 只会弹权限提示（iOS 侧缺 `NSCameraUsageDescription` 的行为另行确认） |
| `userInterfaceStyle` | 保持顶层 `automatic` | Android 侧生效依赖已装的 `expo-system-ui`：prebuild 写入 `strings.xml` 的 `expo_system_ui_user_interface_style=automatic`，原生据此设 `MODE_NIGHT_FOLLOW_SYSTEM`；应用内主题切换经 NativeWind → RN `Appearance.setColorScheme` → `AppCompatDelegate.setDefaultNightMode` 覆盖原生主题 |
| `expo-build-properties` 的 `android` 段 | `compileSdkVersion` / `targetSdkVersion` 固定 36 | 安卓侧验收基线是 API 36；targetSdk 同时决定 edge-to-edge 强制行为与 Play 上传要求，SDK 升级不应静默改动它——升级后必须重跑模拟器验收再改。`minSdkVersion` 与 Kotlin 不写：无依赖抬高下限，且各原生模块都从 root project ext 读取 Expo 已设定好的 `kotlinVersion` |

改 `app.config.ts` 后必须重跑的核对：

```bash
cd apps/mobile
# 三个变体的包名互不相同
APP_ENV=staging npx expo config --type public --json | jq .android.package
npx expo prebuild -p android --clean
```

- 生成物核对点：`android/app/build.gradle` 的 `applicationId` / `versionCode`；
  `android/gradle.properties` 的 `android.compileSdkVersion` / `android.targetSdkVersion` / `edgeToEdgeEnabled`；
  `app/build/intermediates/merged_manifest/**/AndroidManifest.xml` 中无 `CAMERA` / `RECORD_AUDIO`；
  `res/values/strings.xml` 的 `expo_system_ui_user_interface_style`；`res/values/colors.xml` 的 `iconBackground`。
- 构建/合并 manifest 前必须 `JAVA_HOME=`（JDK 21）且 `ANDROID_HOME=~/Library/Android/sdk`：默认 JDK 25 会让
  Gradle 失败，未设 `ANDROID_HOME` 时 Gradle 不会自动探测 SDK（归因见 FEATURE-542 探针报告 §1.3，
  报告随 PR #1 落地到 `apps/mobile/docs/android-probe.md`）。

## 构建与验证

```bash
# 仓库根执行；包装脚本先 prebuild 再 run，保证 config plugin 的改动生效
# 前置环境：JAVA_HOME 指向 JDK 21、ANDROID_HOME 指向 Android SDK
pnpm android:mobile:staging          # 默认设备／模拟器，Debug
pnpm android:mobile:device:staging   # 从设备列表中选择，Debug
```

- 完整检查（typecheck / lint / test）在编码完成后一次跑完，不在迭代中途反复跑。
- 自动化测试只覆盖纯函数（`apps/mobile/lib/*.test.ts`，Node 环境），**不覆盖 RN 组件渲染与原生交互**。

## 验收证据要求

平台交互类改动必须同时给出：

1. **Android 侧**：真机或模拟器实测结果，标注设备型号、Android 版本、构建类型（Debug/Release）
2. **iOS 侧**：确认既有行为未变的结论（抽查或全量，说明范围）
3. 不通过单测结论替代真机验证

新发现的平台约束写回本文件；本文件是 `apps/mobile` 平台差异的唯一权威清单。
