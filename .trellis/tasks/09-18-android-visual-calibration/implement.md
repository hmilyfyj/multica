# FEATURE-549 实施记录

## 变更清单

### 1. 新增 `apps/mobile/components/ui/nav-icon.tsx`

SF Symbol（iOS）与 Ionicons（Android）的唯一封装点。iOS 分支保持改动前的
`expo-image source="sf:..."` 写法逐字不变；Android 分支渲染 Ionicons。

### 2. `apps/mobile/app/(app)/[workspace]/(tabs)/_layout.tsx`

- 移除 `import { Image } from "expo-image"`（改后无引用）。
- 新增 `import { NavIcon } from "@/components/ui/nav-icon"`。
- 4 个 `tabBarIcon`（inbox / my-issues / chat / more）从 `<Image source="sf:...">` 换成 `<NavIcon>`。
- 布局、tint、badge、`listeners` 一律未动。

### 3. `apps/mobile/components/nav/more-tab-dropdown.tsx`

- 移除 `import { Image as ExpoImage } from "expo-image"`。
- 新增 `import { NavIcon, type IoniconName } from "@/components/ui/nav-icon"`。
- `NavItem` 的 `icon: string` 拆成 `sf` / `ion` 两个字段（SF 与 Ionicons 命名无对应关系）。
- `NAV_ITEMS` 三条改成 `{ label, sf, ion, path }`。
- 3 个 NAV_ITEMS 图标 + 2 处 `chevron.right` 换成 `<NavIcon>`。
- `TAB_BAR_HEIGHT = 49` **未改**：`@react-navigation/bottom-tabs@7.16.1` 的
  `getTabBarHeight` 返回 `TABBAR_HEIGHT_UIKIT (49) + inset`，两端同值，锚点定位本来就是对的。

### 4. `apps/mobile/app/(app)/[workspace]/switch-workspace.tsx`

- 移除 `expo-image` 的 `ExpoImage` 引用，新增 `NavIcon`。
- 当前工作区的 `sf:checkmark` 换成 `<NavIcon sf="checkmark" ion="checkmark" size={16}>`。

### 5. `apps/mobile/app.config.ts`

`plugins` 里新增 `expo-splash-screen` 配置（图像 / imageWidth / 背景色），并写明
「浅深同底」的理由。`android.adaptiveIcon` 保持 FEATURE-543 的交付不变。

### 6. `apps/mobile/package.json` + `pnpm-lock.yaml`

新增 `expo-splash-screen@~55.0.25`（`expo install` 给出的 SDK 55 对应版本；
`expo install` 自身因 pnpm 版本检查失败，改用 `corepack pnpm --filter @multica/mobile add` 加同一版本）。

## 验证计划

| 项 | 手段 | 证据位置 |
|---|---|---|
| 类型 / lint / 全量检查 | `rtk err -- corepack pnpm check`（收尾一次跑完） | 交付评论 |
| tab bar 与各处图标 | 模拟器浅色 + 深色截图 | `.trellis/tasks/09-18-android-visual-calibration/research/screens-after/` |
| 启动屏 + 桌面图标 | 冷启动帧 + launcher 截图；prebuild 生成资源逐条核对 | 同上 + 交付评论 |
| `SplashScreenManager` CNFE 消失 | 冷启动 logcat grep（改动前 / 改动后对照） | 交付评论 |
| 深浅色系统栏 | 两套主题下状态栏 / 手势条截图 | screens-after |
| iOS 不受影响 | 结构性论证（改动全部在 `Platform.OS === "ios"` 之外的分支） | 交付评论（本机无 iOS runtime） |

## 实施顺序

1. prebuild（含新插件）→ 核对生成资源（styles/colors/MainActivity）。**已完成**
2. Gradle `installDebug` → 冷启动 logcat 核对 CNFE 是否消失。
3. 浅色 + 深色两套页面截图，与 `screens-baseline/` 逐页对照。
4. `pnpm check`。
5. 结论回写 spec，归档并交付。
