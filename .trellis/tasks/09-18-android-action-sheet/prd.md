# FEATURE-545 ActionSheetIOS 六处调用替换为跨平台动作菜单

## Goal

把 `apps/mobile` 里 6 个文件、7 次 `ActionSheetIOS.showActionSheetWithOptions` 调用替换为集中封装的跨平台
动作菜单：iOS 继续走 `ActionSheetIOS`（视觉与交互逐字节不变），Android / Web 走自带的 JS 底部动作面板。

不引入新依赖；不改这 7 个入口除「动作菜单容器」以外的任何交互。

## Requirements

1. 新增 `apps/mobile/components/ui/action-sheet.tsx`，对外暴露命令式 API
   `showActionSheet(options, onSelectIndex)` 与宿主组件 `ActionSheetHost`；平台分支只在封装内部。
2. 7 次调用点全部改为调用封装；iOS 侧参数与回调语义与现状完全一致。
3. 体现两端差异：Android 没有原生 `destructiveButtonIndex` 红色语义、没有 `cancelButtonIndex` 的分离呈现。
   封装内 Android 分支要把 destructive 选项渲成红色，并把 cancel 选项单独成卡；取消路径（点遮罩、返回键、
   点 Cancel）要按 iOS 语义回调 `cancelButtonIndex`。
4. 宿主挂载在根布局（`app/_layout.tsx`），7 个调用点无需 Provider 包裹。
5. 遵循 `apps/mobile/AGENTS.md` 的 Sheets and navigation 约定：短动作菜单仍用动作菜单，不改成 formSheet 路由。

## Verified Facts（本轮核实，非推测）

- `ActionSheetIOSOptions` 由 `react-native` 类型入口导出（`node_modules/react-native/types/index.d.ts:73`
  re-export `Libraries/ActionSheetIOS/ActionSheetIOS`），封装可复用其字段类型；`showActionSheetWithOptions` 的
  回调在「点 Cancel / 点外部关闭」时同样以 `cancelButtonIndex` 触发。
- 7 次调用点的索引契约已逐个读过，语义一致：命中 cancel 索引时要么 `if (i === cancelIndex) return;`
  （profile、message-long-press、comment-context-menu 内层），要么走 `options[i]` 查表后无分支命中
  （inbox、issue/[id]、project/[id]、comment-context-menu 外层）。
- `apps/mobile` 现有唯一 Modal 用法是 `components/chat/agent-picker-sheet.tsx`（透明 `Modal` + 遮罩 `Pressable`
  + 内部再套一层 `Pressable` 吞掉点击 + `continuousCorners`）；项目没有 bottom-sheet 库。
- 根布局 `app/_layout.tsx` 已挂 `<PortalHost />`；`react-native-safe-area-context`、`react-native-reanimated`
  均在依赖内（`package.json` 依赖清单已核）。
- Android 侧失效证据来自 FEATURE-542 探针（`apps/mobile/docs/android-probe.md` §3 B1）：点开即
  `Uncaught Error: ActionSheetManager doesn't exist`，5 处实测复现。

## Boundary

- 只动上表的 6 个调用点文件、新增的封装与宿主，以及根布局里挂载宿主的那一行。
- 不改 `app/(app)/[workspace]/_layout.tsx` 的 `SHEET_OPTIONS`（FEATURE-547）；不改 picker 路由搜索框
  （FEATURE-546）。
- 不改 `apps/mobile/docs/android-probe.md`（历史探针报告，记录修复前状态）。
- 不改这 7 个入口的动作集合、文案、后续副作用（含 `Alert.alert` 二次确认）。

## Acceptance Criteria

- [ ] 业务代码内 `rg "ActionSheetIOS"` 只命中 `components/ui/action-sheet.tsx`，且该文件内有平台分支
- [ ] `pnpm --filter @multica/mobile typecheck` / `lint` 通过
- [ ] Android 模拟器（Medium_Phone_API_35）逐个验证 6 个入口：打开、选择、取消都不崩
- [ ] iOS 侧 6 个入口行为与改动前一致（模拟器实测，逐个确认）
- [ ] 无新增依赖（`package.json` 依赖段无变化）

## Notes

- 平台交互改动必须同时给 Android 实测与 iOS 未受影响的结论，不用单测代替真机/模拟器验证
  （`.trellis/spec/mobile/frontend/android-platform.md` §验收证据要求）。
