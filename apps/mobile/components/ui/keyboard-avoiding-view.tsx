/**
 * 跨平台键盘避让容器 —— 本仓唯一允许直接使用的 `KeyboardAvoidingView`。
 *
 * 为什么不再直接用 RN 的 `KeyboardAvoidingView`：改造前 8 个调用点统一写
 * `behavior={Platform.OS === "ios" ? "padding" : undefined}`，而 RN 的实现按
 * `behavior` 走 `switch`，`undefined` 落到 default 分支 —— 直接渲染一个普通
 * `<View>`。也就是说那 8 处在 Android 上**完全没有参与避让**。
 *
 * 也不能靠 `android:windowSoftInputMode` 兜底。应用是强制 edge-to-edge 的
 * （窗口带 `EDGE_TO_EDGE_ENFORCED`，targetSdk 36），系统不再为输入法压缩窗口，
 * 只把 IME inset 报给应用，而没有任何代码消费它。API 35 模拟器实测：键盘弹起时
 * decor 仍是 `[0,0][1080,2400]`（窗口一像素没变），聊天 composer 的输入框停在
 * y 1975–2080，键盘顶边在 y 1517 —— 输入框整个在键盘下面。
 *
 * 所以 Android 走 `react-native-keyboard-controller` 的实现：它按 IME inset 用
 * reanimated 在 UI 线程上做动画，键盘弹起过程中就跟着走，而不是等 RN 的
 * `keyboardDidShow`（安卓没有 willShow）落地后跳一下。该库本来就是本包依赖，
 * `<KeyboardProvider>` 也已经包住根布局（`app/_layout.tsx`），评论 composer 一直
 * 靠同一个库的 `KeyboardStickyView` 抬升 —— 这里不引入新的原生依赖。
 *
 * iOS 分支渲染 RN 自己的组件、`behavior` 取 `"padding"`，与改造前逐字一致。
 *
 * `behavior` 由本组件决定、不对外暴露：8 个调用点在 iOS 上取的都是 `"padding"`，
 * 而 Android 侧 `padding` 与 `height` 的差别只影响容器自身是否收缩（这里的调用点
 * 外层都是 `flex-1` 的滚动容器或居中块，padding 不需要额外收缩就能把内容顶上去）。
 * 保留一个用不到的开关只会让下一个调用点重新踩一遍平台分歧。
 */
import { cssInterop } from "nativewind";
import { KeyboardAvoidingView as RNKeyboardAvoidingView, Platform } from "react-native";
import type { KeyboardAvoidingViewProps as RNKeyboardAvoidingViewProps } from "react-native";
import { KeyboardAvoidingView as KCKeyboardAvoidingView } from "react-native-keyboard-controller";

/**
 * NativeWind 只为自己认识的组件把 `className` 映射成 `style`；keyboard-controller
 * 的容器是第三方组件，不注册就会把这些调用点上的布局类（`flex-1`、`bg-background`）
 * 在 Android 上静默丢掉 —— 而 iOS 分支渲染的是 RN 自己的组件，NativeWind 本来就认。
 */
cssInterop(KCKeyboardAvoidingView, { className: "style" });

/**
 * `behavior` 与 `contentContainerStyle` 一并从对外契约里去掉：前者由本组件决定，
 * 后者只对 `behavior="position"` 有意义（而 position 不在本组件支持的取值里）。
 * 保留它们会让两个分支的 props 联合类型不兼容（RN 允许 `position`，keyboard-controller
 * 的那一支不允许），也会让下一个调用点重新引入平台分歧。
 */
export type KeyboardAvoidingViewProps = Omit<
  RNKeyboardAvoidingViewProps,
  "behavior" | "contentContainerStyle"
>;

export function KeyboardAvoidingView(props: KeyboardAvoidingViewProps) {
  return Platform.OS === "ios" ? (
    <RNKeyboardAvoidingView behavior="padding" {...props} />
  ) : (
    <KCKeyboardAvoidingView behavior="padding" {...props} />
  );
}
