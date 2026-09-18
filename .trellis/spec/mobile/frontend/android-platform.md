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
| `ActionSheetIOS` | `inbox.tsx:80`、`issue/[id].tsx:126`、`more/settings/profile.tsx:67`、`project/[id].tsx:98`、`components/chat/message-long-press.tsx:56`、`components/issue/comment-context-menu.tsx:111,236` | 6 处 | 该 API 在 Android 不存在，需替换 |
| `headerSearchBarOptions`（`useNativeSearchBar`） | `mention-picker`、`issue/[id]/picker/{assignee,label,project}`、`new-issue-picker/{assignee,project}`、`project/[id]/picker/lead` | 7 路由 | iOS 原生 `UISearchController`，Android 无效 |
| `presentation: "formSheet"` + detents/grabber | `app/(app)/[workspace]/_layout.tsx` 的 `SHEET_OPTIONS` | 18 路由 | 底层实现不同，参数语义需实测校准 |
| `KeyboardAvoidingView` 的 iOS 分支 | 8 个表单/聊天页面 | 8 处 | `behavior` 取值为 `undefined`，需确认是否需要 `height` |

### 已有的 Android 预留（不要重复造）

- `components/ui/text-field.tsx`：`includeFontPadding` / `textAlignVertical` 已按 Android 语义写好
- `components/ui/otp-input.tsx`：一次性验证码自动填充已由底层库承担
- `components/ui/dropdown-menu.tsx`：popover 行为按 iOS/Android 通用语义实现
- `.gitattributes`：`.trellis/workspace/*/journal-*.md` 使用 `merge=union`

### 原生依赖的 Android 支持（已核实）

| 依赖 | 状态 |
|---|---|
| `react-native-enriched-markdown@0.6.0` | tarball 内含 `android/src/main/jni/` C++ 桥接与 `build.gradle` |
| `react-native-shiki-engine` | 支持 arm64-v8a / armeabi-v7a / x86 / x86_64；Android 内存回收需 AppState 驱动 |
| `input-otp-native` | 纯 JS，无原生代码 |
| `@react-native-segmented-control/segmented-control` | Android 为 JS 模拟实现，视觉与 iOS 有差异 |

## 构建与验证

```bash
# 首次或在 app.config.ts 变更后（配置插件需要重新应用）
pnpm --filter @multica/mobile exec expo prebuild -p android
pnpm --filter @multica/mobile exec expo run:android
```

- 完整检查（typecheck / lint / test）在编码完成后一次跑完，不在迭代中途反复跑。
- 自动化测试只覆盖纯函数（`apps/mobile/lib/*.test.ts`，Node 环境），**不覆盖 RN 组件渲染与原生交互**。

## 验收证据要求

平台交互类改动必须同时给出：

1. **Android 侧**：真机或模拟器实测结果，标注设备型号、Android 版本、构建类型（Debug/Release）
2. **iOS 侧**：确认既有行为未变的结论（抽查或全量，说明范围）
3. 不通过单测结论替代真机验证

新发现的平台约束写回本文件；本文件是 `apps/mobile` 平台差异的唯一权威清单。
