# FEATURE-543 补齐 app.config.ts 的 android 配置与图标资源

## Goal

让 `apps/mobile` 具备可 prebuild 的 Android 平台配置：`app.config.ts` 补 `android` 段，
`expo-build-properties` 补 `android` 段，并补 adaptive icon 资源，使 `expo prebuild -p android`
不再因缺少 `android.package` 退出码 1，且三个 APP_ENV 下的包名互不相同。

`ios` 段行为零改动（含 `bundleIdentifier` 三段式与 expo-image-picker 的 iOS 权限文案）。

## Requirements

- `android.package` 按 APP_ENV 分三段式，与 `bundleIdentifier` 一致；生产包名待定，留可覆盖环境变量
  （`EXPO_ANDROID_PACKAGE_PROD`，命名照 `EXPO_BUNDLE_IDENTIFIER_*` 的 per-variant 习惯）。
- `android.versionCode` 显式声明。
- `android.adaptiveIcon`：前景图 + 背景色；资源缺失时补 `assets/`。
- `edgeToEdgeEnabled`：与 Android 15 的强制行为对齐（SDK 55 已移除该键，需按实际行为实现并说明）。
- 权限：相册读取可用；camera / microphone 维持关闭，与 iOS 的 photo-library-only 策略一致。
- `expo-build-properties` 补 `android` 段（编译目标按需要；Kotlin 版本按需要）。
- `userInterfaceStyle` 在 Android 侧深浅色行为对齐。
- `.env.example` 补新增 Android 变量的说明。

## Verified Facts（本轮核实，非推测）

- `expo-image-picker` 的 `cameraPermission: false` / `microphonePermission: false` 不只是 iOS 开关：
  插件会写入 `android.blockedPermissions`，把 `CAMERA` / `RECORD_AUDIO` 从合并后的 manifest 中移除。
- 相册读取在 Android 13+ 走系统 photo picker（`getMediaLibraryPermissions` 返回空数组，无需权限）；
  Android ≤12 走 `READ_EXTERNAL_STORAGE`，模板 manifest 已带 `maxSdkVersion="32"` 声明。
  因此 `android.permissions` 不需要新增 `READ_MEDIA_IMAGES`。
- SDK 55 的 `@expo/prebuild-config` 在检测到 `android.edgeToEdgeEnabled` 时会告警并要求移除；
  模板 `gradle.properties` 默认 `edgeToEdgeEnabled=true`，故不写该键即为对齐 Android 15/16 行为。
- `userInterfaceStyle: "automatic"` 在 Android 生效依赖已装的 `expo-system-ui`：prebuild 写入
  `strings.xml` 的 `expo_system_ui_user_interface_style`，原生侧据此设置 `MODE_NIGHT_FOLLOW_SYSTEM`；
  应用内主题切换经 NativeWind → RN `Appearance.setColorScheme` → `AppCompatDelegate.setDefaultNightMode`。
- `expo-modules-core` 的 `compileSdkVersion` / `targetSdkVersion` 默认值均为 36。

## Boundary

- 不改 `ios` 段；不改 `android/` 生成物；不动 `packages/*`。
- 不新增 Android 构建脚本（`android` / `android:staging` / `android:prod` 由 FEATURE-544 负责）。
- 本轮不跑 `run:android`，不做真机验收。

## Acceptance Criteria

- [ ] `npx expo prebuild -p android --clean` 成功，`android/app/build.gradle` 里 `applicationId` /
      `versionCode` 与配置一致
- [ ] `npx expo config --type public` 输出包含完整 `android` 段
- [ ] 三个 APP_ENV 下 `android.package` 互不相同
- [ ] `git diff` 中 `ios:` 段无变化
- [ ] 生成的 manifest 中无 `CAMERA` / `RECORD_AUDIO`，`adaptive icon` 资源到位
