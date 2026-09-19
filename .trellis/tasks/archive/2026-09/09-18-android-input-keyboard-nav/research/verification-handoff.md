# FEATURE-548 → FEATURE-551 待设备验证清单

本任务（548）按用户要求「一次改完、一次验收」**不在本任务里起模拟器**；下面的点是
静态检查无法判定、必须在设备上过一遍的。设备侧证据统一由 FEATURE-551 的那一次会话产出。

- 基线：`main` @ 合并本任务后
- 设备：模拟器 `Medium_Phone_API_35`（Android 15，1080×2400 @420dpi），Debug 构建（与 FEATURE-547/549/550 同一台）
- 取证脚本：同目录 `lib.sh`（观测原语）+ `drive-input.sh`（6 个输入场景驱动）；本目录 `screens/` 是**改动前**的基线截图与 `state.log`
- 判据沿用 `lib.sh` 里 `probe` 的口径：焦点输入框整块在键盘顶边之上算 visible

## A. 键盘避让（6 个场景，改动前基线只测了其中 2 个）

| # | 场景 | 预期 | 一键复现 |
|---|---|---|---|
| A1 | 聊天 composer | 键盘弹起时输入框与发送键整体上移、贴在键盘上沿，不被遮挡 | `bash drive-input.sh <out> <ws>` 的第 3 步（tap Chat → tap composer） |
| A2 | 评论 composer | 与改动前一致（它本来就走 `KeyboardStickyView`） | 第 4 步（深链 `issue/<id>` → tap composer） |
| A3 | 新建 issue（标题 + 描述） | 键盘弹起时表单整体上移；焦点字段可见 | 第 5 步（深链 `new-issue`） |
| A4 | 编辑 issue（标题 + 描述） | 同上 | 第 6 步（深链 `issue/<id>/edit`） |
| A5 | 登录（邮箱） | 键盘弹起时输入框与 Send code 按钮都在键盘上方 | 第 1 步 |
| A6 | 验证码（OTP） | 6 格 OTP 与 Verify 按钮都在键盘上方 | 第 2 步 |

**改动前基线（`screens/state.log`）**：A1 失败 —— `base-01-chat-ime` 里输入框整块在键盘下方；
A2 通过（评论 composer 走 `KeyboardStickyView`）。

**要特别看的两个点**（静态代码推不出来，只能实测）：

1. **是否少垫或多垫一条导航条**：Android 的键盘高度由 `react-native-keyboard-controller`
   从 `InsetsSource type=ime` 减去导航条得到（`KeyboardAnimationCallback.kt` 的
   `getCurrentKeyboardHeight`），避让距离再与 `useWindowDimensions().height` 相减。
   edge-to-edge 下这两者是否同一基准，只能实测：量「键盘顶边 y」与「焦点输入框底边 y」，
   两者相差应在 0～8px 之间。
2. **键盘动画过程中是否跟手**：`padding` 行为按 IME inset 在 UI 线程插值，弹起过程中输入框
   应随键盘一起上移，而不是键盘停稳后跳一下。

## B. 返回键三类路径

| # | 场景 | 预期 | 一键复现 |
|---|---|---|---|
| B1 | sheet 叠 sheet | 每次 BACK 只关最上面一层：issue 详情 → 属性 picker → BACK 关 picker；再 BACK 回详情 | 深链 `issue/<id>` → tap 状态 chip → `press_back` |
| B2 | modal 套 modal | 页面 → ⋯ 菜单（JS 动作面板）→ BACK 只关面板，页面不弹栈 | issue 详情 → tap ⋯ → `press_back` |
| B3 | picker → `router.back()` | 选中一项后 picker 关闭并回到来源页，没有残留空壳 | 任一 picker 选一项 |
| B4 | **More 菜单 + BACK**（本任务新修） | 菜单开着时 BACK 只关菜单；应用不退出、不切 tab | tap More → `press_back`；预期停在原 tab |
| B5 | 图片查看器 | 全屏图片上 BACK 关闭查看器 | 长按/点开任意图片附件 |

B4 是改动前必然失败的一条：`@rn-primitives` 的菜单不进导航栈也不注册 BACK。

## C. edge-to-edge 系统栏

| # | 场景 | 预期 | 复现 |
|---|---|---|---|
| C1 | 底部 tab bar（手势导航） | 4 个 tab 图标与标签不被手势条压住 | 任意 tab 根截图 |
| C2 | 底部 tab bar（三键导航） | 同上，且 tab bar 整体高度随 inset 变高 | `adb shell cmd overlay enable com.android.internal.systemui.navbar.threebutton` 后重截 |
| C3 | 聊天输入框 | 与 tab bar 之间无重叠（chat 在 tab 内，输入框底边 = tab bar 顶边） | A1 截图（键盘收起态） |
| C4 | 状态栏前景色 | 浅色下深色图标、深色下浅色图标，图标与背景对比正常，标题不被状态栏压住 | 切「设置 → 外观」两套主题各截一张 |
| C5 | sheet 底部 | picker 列表最后一行不被手势条遮挡 | 深链任一 picker，滚到底 |
| C6 | 设置页列表末尾 | 最后一行能在 tab bar 上方完整滚出 | 设置页滚到底 |

C1/C2/C3/C6 的机制依据：底部 tab bar 由 react-navigation 按 `insets.bottom` 抬高
（`BottomTabBar` 的 `paddingBottom` + `getTabBarHeight`），tab 内页面因此天然在导航条之上；
但 inset 在 gesture / three-button 两种模式下是否都非零，只有设备能答。

## D. iOS 不受影响

本机无 simulator runtime，无法截图。结构性论证：8 个调用点在 iOS 上的渲染路径仍是
RN 的 `KeyboardAvoidingView` + `behavior="padding"`（与改造前逐字一致），
Android 分支才换库；`components/ui/keyboard-avoiding-view.tsx` 的两分支按 `Platform.OS` 静态择一。
如需在 iOS 上复核，只需跑 A1/A3/A5 三条。
