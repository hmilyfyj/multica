# 实施计划

## 新增

| 文件 | 内容 |
|---|---|
| `apps/mobile/components/ui/action-sheet.tsx` | `ActionSheetOptions`、`showActionSheet()`、`ActionSheetHost`；iOS 转发 `ActionSheetIOS`，其余平台渲 JS 底部面板；内部的单例 store 不对外导出 |

## 修改

| 文件 | 改动 |
|---|---|
| `apps/mobile/app/_layout.tsx` | 在 `<PortalHost />` 旁挂 `<ActionSheetHost />`（1 行 import + 1 行挂载） |
| `app/(app)/[workspace]/(tabs)/inbox.tsx` | import 由 `ActionSheetIOS` 换成 `@/components/ui/action-sheet`；`ActionSheetIOS.showActionSheetWithOptions(` → `showActionSheet(`；文件头注释里的 iOS-only 说明改写 |
| `app/(app)/[workspace]/issue/[id].tsx` | 同上（含 `onPressMore` 上方注释里 “ActionSheetIOS + Alert.alert” 的措辞） |
| `app/(app)/[workspace]/more/settings/profile.tsx` | 同上（`handleAvatarPick`） |
| `app/(app)/[workspace]/project/[id].tsx` | 同上（`onPressMore`），含文件头注释 |
| `components/chat/message-long-press.tsx` | 同上（`useChatMessageLongPress`）；头部注释中「iOS-native first / ActionSheetIOS」段落改写为封装说明 |
| `components/issue/comment-context-menu.tsx` | 同上（`useCommentLongPress` 与 `presentReactSheet` 两次调用）；头部注释（含「iOS 会拒绝呈现第二张」的说明）改写 |

调用点回调体、文案、`Alert.alert` 二次确认、`Haptics` 调用一律不动。

## 文档

| 文件 | 改动 |
|---|---|
| `.trellis/spec/mobile/frontend/android-platform.md` | 「已知 iOS 专有点位」表里 `ActionSheetIOS` 行标注已由 FEATURE-545 收敛到 `components/ui/action-sheet.tsx`；补一句后续动作菜单一律走该封装 |
| 两个长按 hook 与两个列表组件的注释 | 去掉对 `ActionSheetIOS` 的直接引用（它们是旧实现的描述，改完即失实） |

`apps/mobile/docs/android-probe.md` 是 FEATURE-542 的历史探针报告，保留原文（它记录的是修复前状态）。

## 验证

1. `pnpm --filter @multica/mobile typecheck` / `lint`（改动直接相关的检查，收尾统一跑）
2. Android 模拟器（`Medium_Phone_API_35`，Debug，经 `pnpm android:mobile:device:staging`）逐个走 6 个入口：
   打开 → 选一项 → 取消；重点看 comment 的 React… 二级面板与 profile 的 Remove Photo 红色项
3. iOS 模拟器回归 6 个入口，确认与改动前一致
4. `rg "ActionSheetIOS"` 命中范围核对

## 回滚

封装尚无人调用时删文件即可；已接入后回滚 = 把 7 个调用点换回 `ActionSheetIOS` + 删封装与宿主挂载。
