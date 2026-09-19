# FEATURE-552 Android 构建、签名与分发链路

## Goal

把 `apps/mobile` 的 Android 产物做到「非开发人员也能装上」：一套落在仓库之外的自用签名密钥、
由 config plugin 注入的 release 签名配置、`assembleRelease` / `bundleRelease` 一条命令产出
按变体命名的 APK / AAB，以及一份逐条可执行的 `docs/android-distribution.md`。

不涉及业务代码、`android/` 生成物的手工修改、Google Play 上架。

## Requirements

1. **签名**
   - 生成并管理 Android release keystore：密钥与口令落在**仓库之外**（默认 `~/.multica-android/`），
     文档写清位置与口令获取方式；`MULTICA_ANDROID_KEYSTORE_PROPERTIES` 可指向团队已有密钥。
   - 签名配置经 config plugin（`plugins/with-android-release-signing.js`）在 prebuild 时注入
     `android/app/build.gradle`，不手工改生成物；无密钥时不破坏 debug 构建。
2. **构建产物**
   - `assembleRelease` → 可安装 APK；`bundleRelease` → AAB。
   - 三种 `APP_ENV`（dev / staging / production）各自的产物命名与包名规则写进文档。
3. **版本管理**：`versionCode` 递增策略及其与 `version` 的关系写进文档。
4. **分发与文档**
   - 新增 `apps/mobile/docs/android-distribution.md`：从零一条命令构建、产物位置、安装方法、常见签名报错。
   - README 补「装到安卓手机」一节，对齐现有 iOS 章节的写法与详细程度。
5. **可选（只评估）**：EAS Build / CI 自动构建接入评估，文档里给结论与成本。

## Boundary

- 不改 `scripts/android-run.sh`、`scripts/ios-run.sh` 及其测试的既有行为。
- 不改 `android/` 生成物（Git 忽略目录）；不改 `packages/*`、后端、web/desktop。
- 不在模拟器/真机上安装验证（验收纪律：Release 的实际安装与登录由 FEATURE-551 统一验证）。

## Verified Facts（本轮核实）

- 上游 prebuild 模板里 `buildTypes.release` 用的是 `signingConfig signingConfigs.debug`
  （实测 `apps/mobile/android/app/build.gradle`），即默认 release 也是 debug 签名。
- `expo config --type public --json` 输出干净 JSON，含 `android.package` / `version` / `android.versionCode`，
  三种 APP_ENV 下包名分别为 `com.ehaier.zgq.shop.mall.dev` / `.staging` / `com.ehaier.zgq.shop.mall`。
- 仓库是 GitHub **public** 仓库 → GitHub Actions 标准 runner 免费（官方计费文档）。
- EAS Free 档 15 次 Android 构建/月、低优先级队列；Starter $19/月含 $45 build credit，Android medium worker $1/次。

## Acceptance Criteria

- [ ] 按文档从干净 checkout 能产出可安装的 Release APK，且 APK 由自用 release 密钥签名（`apksigner verify` 证据）
- [ ] 文档里的命令逐条可执行，无失效命令
- [ ] 签名材料未入库（`git check-ignore -v` 验证）
- [ ] 三种 APP_ENV 的包名互不冲突，可同机共存（`expo config` 断言）
- [ ] `bash apps/mobile/scripts/android-run.test.sh`、`android-keystore.test.sh`、`android-release.test.sh` 均通过
- [ ] `bundleRelease` 产出 AAB
