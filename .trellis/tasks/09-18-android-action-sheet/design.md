# 设计：跨平台动作菜单封装

## 1. API 形态：镜像 `ActionSheetIOS`

```ts
export interface ActionSheetOptions {
  options: string[];
  cancelButtonIndex?: number;
  destructiveButtonIndex?: number;
  title?: string;
}

export function showActionSheet(
  options: ActionSheetOptions,
  onSelect: (index: number) => void,
): void;
```

字段与索引语义与 `ActionSheetIOS` 一一对应，因此：

- iOS 分支是**纯转发**（`ActionSheetIOS.showActionSheetWithOptions(options, onSelect)`），参数与回调不经过
  任何加工，iOS 行为与改动前逐字节相同。
- 7 个调用点只改 import 与调用名，不动各自的分支体，把「不改其他交互」的风险压到最小。

不采用「结构化选项 + 每项自带 onPress」的 API：那会重写 7 处回调体（里面还有 `Alert.alert` 二次确认、
Pin/Unpin 分支、`router.push` 等副作用），收益只是签名好看，风险是把 iOS 行为改掉的概率显著变高。

## 2. 平台分支放在封装内部

```ts
if (Platform.OS === "ios") { ActionSheetIOS.showActionSheetWithOptions(...); return; }
// 其余平台（android / web）走 JS 面板
```

按 `.trellis/spec/mobile/frontend/android-platform.md` §平台差异原则 1：差异只实现一处，调用方无感。
Web 一并落到 JS 分支：`react-native-web` 下同样没有 `ActionSheetIOS`。

## 3. 宿主：模块级单例 + 根布局挂载

命令式 API（无 React 上下文）需要一个常驻宿主渲染 Android 面板，用 zustand 存「当前请求」：

```ts
{ current: { id: number; options; onSelect } | null; open(...); close() }
```

- 调用点在 `app/_layout.tsx` 里只多一行 `<ActionSheetHost />`，7 个调用点保持纯函数式调用。
- 每次请求带自增 `id`，作为面板内容的 `key`，让「换一张菜单」与「同一张菜单重开」在 React 层可区分。

## 4. 嵌套菜单（comment-context-menu 的 React… 二级面板）

现状：外层面板的完成回调里再开一张 React… 面板（iOS 上必须等外层 dismiss 完，否则第二张会被拒绝呈现）。

Android 分支只维护 `current` 一份请求，选择时**先清空再执行回调**：

```
onPress(i) → close()（current = null） → onSelect(i) → 若回调里再次 showActionSheet，同一次提交把 current 换成新请求
```

React 会把这几次状态更新批处理成一次提交，`visible` 始终为 true → `Modal` 不卸载，面板内容原地替换。
这样不存在「一个 Dialog 正在 dismiss、另一个正在 show」的窗口期，比 `setTimeout` 延后呈现稳。
视觉上是面板内容直接换成二级条目，而非先收起再弹出；功能与索引语义不受影响。

## 5. Android 面板构成

参考 `components/chat/agent-picker-sheet.tsx`（项目现有 Modal 写法）：

```
Modal(transparent, animationType="fade", statusBarTranslucent, onRequestClose=取消)
└ Pressable(遮罩 bg-black/40, 点击=取消)
  └ View(justify-end, 底部留 safe-area inset, gap)
    ├ 卡片 1：title（小号 muted 文字，仅当传入）+ 各非 cancel 选项（行间 1px 分隔线）
    │          destructive 索引用 text-destructive，其余 text-foreground；active:bg-secondary
    └ 卡片 2：cancel 选项单独成卡（text-brand 加粗），对应 iOS 的分离呈现
```

- 选项行是 `Pressable`，回调传**原始索引**（跳过 cancel 项时保留原下标，不做压缩重排）。
- 取消路径统一回调 `cancelButtonIndex`（有则回调，无则仅关闭），与 iOS 点 Cancel / 点外部一致。
- 每行 `accessibilityRole="button"`；RN 视图会进 Android 无障碍树，自动化可用 `uiautomator` 取证。

## 6. 不采用的方案

| 方案 | 不采用的原因 |
|---|---|
| `@expo/react-native-action-sheet` 等三方库 | 需 Provider 包裹 + 新依赖；且验收要求封装内部有平台分支，三方库把分支藏进库里 |
| formSheet 路由（项目已有模式） | 动作菜单是命令式回调（回传索引 + 即时副作用），路由化要改写 7 处调用点的全部控制流；`AGENTS.md` 也规定短动作菜单用动作菜单 |
| Android 上退化成 `Alert.alert` | 无 cancel 分离、无标题、按钮数受限，达不到「两端行为一致」 |
| 每个调用点各写一份 `Platform.OS` 判断 | spec 明令禁止（差异集中封装） |
