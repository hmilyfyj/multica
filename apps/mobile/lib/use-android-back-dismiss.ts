/**
 * Android 物理/手势返回键：让 JS 画的浮层先一步吃掉 BACK。
 *
 * 三类浮层里有两类不用管 —— 原生 `Modal`（`components/ui/action-sheet.tsx`、
 * `components/chat/agent-picker-sheet.tsx`、图片查看器）由 RN 自己把 BACK 接到
 * `onRequestClose`；formSheet / modal 路由（picker、due-date、new-issue）是
 * react-native-screens 的栈成员，BACK 由 RNS 弹栈（见 FEATURE-547 实测）。
 *
 * 漏的是第三类：`@rn-primitives` 的 DropdownMenu 画在 `PortalHost` 里，是一张普通
 * 视图，既不注册 BACK、也不进导航栈。于是菜单开着按 BACK，事件直接落到导航器上
 * —— 在 tab 根节点就是「连带把应用退到后台」，而菜单还留在屏幕上。iOS 没有返回键，
 * 这条差异只在 Android 存在。
 *
 * 用法：只在浮层**打开时**注册（`active`），处理完返回 true 表示事件已被消费，
 * 导航器不再弹栈。
 */
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";

export function useAndroidBackDismiss(active: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!active || Platform.OS !== "android") return;

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        onDismiss();
        return true;
      },
    );

    return () => subscription.remove();
  }, [active, onDismiss]);
}
