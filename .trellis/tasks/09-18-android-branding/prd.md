# FEATURE-557 品牌化：应用名「海尔商城」与包名 com.ehaier.zgq.shop.mall

## Goal

把 `apps/mobile` 的品牌标识改成用户 2026-09-18 指定的值：

- 应用名（Android 应用列表名 / iOS 显示名）→ **海尔商城**
- Android 包名 → **`com.ehaier.zgq.shop.mall`**

上一轮（FEATURE-543）把 `android.package` 建成了 `ai.multica.mobile[.dev/.staging]`，生产值当时刻意留作占位；
本轮把三档换成用户给定的反向域名，并同步所有仍然有效的文档/模板引用。

## Requirements

1. `apps/mobile/app.config.ts`
   - `name` 三段式照旧：prod `海尔商城` / staging `海尔商城 (Staging)` / dev `海尔商城 (Dev)`。
   - `android.package`：prod `com.ehaier.zgq.shop.mall`（保留 `EXPO_ANDROID_PACKAGE_PROD` 覆盖口）/
     staging `com.ehaier.zgq.shop.mall.staging` / dev `com.ehaier.zgq.shop.mall.dev`。
   - `expo-image-picker` 插件里用户可见文案 `Allow Multica to access your photos…` 的品牌词改为 `海尔商城`。
   - **不动** `slug`（`multica-mobile`）与 `scheme`（`multica`）：改 scheme 会打断既有深链。
   - **不动** `ios.bundleIdentifier`：iOS 包名前缀必须由该 Apple ID 拥有，留给后续单独决定；
     但 `name` 两端共享，iOS 显示名会一并变成「海尔商城」——这是本任务的预期结果。
2. live 文档与模板：更新仍然有效的旧包名引用（`.trellis/spec/mobile/frontend/android-platform.md`、
   `apps/mobile/README.md`、`apps/mobile/.env.example`）。
3. 历史产物保持原样：`.trellis/tasks/**`（含仍在 tasks/ 下的历史任务目录）与 `apps/mobile/docs/android-probe.md`
   是当时的实测记录，只加「包名已于 FEATURE-554 变更」之类的提示句，不改写原本的观测值。
4. 测试与脚本：核对 `scripts/android-run.test.sh` 等是否有旧包名断言；有则同步。

## Verified Facts（2026-09-18 本 worktree 核对，非推测）

- `rg -n "ai\.multica\.mobile"` 在仓库（排除 `node_modules`）命中 13 处：`app.config.ts` 6 处、
  `README.md` 2 处、`.env.example` 2 处、`docs/android-probe.md` 3 处；再叠加 `.trellis/spec/.../android-platform.md:80`。
- `scripts/android-run.sh` 只在注释里提 `android.package`（说明包名由 `app.config.ts` 驱动），
  `scripts/android-run.test.sh` 只使用 `multica-android-run.XXXXXX` 临时目录名，**两处都不含包名断言**。
- 仓库内没有 `eas.json`，没有其它以旧包名为键的配置。
- `apps/mobile/AGENTS.md` 只提 `@multica/mobile` 包名（pnpm workspace 名），与 Android applicationId 无关，不动。
- 应用显示名（`app_name`）由 `config.name` 派生，prebuild 写进 `android/app/src/main/res/values/strings.xml`；
  中文字符串在 strings.xml 里是合法 UTF-8，无需额外转义。

## Boundary

- 不改任何 JS/TS 业务代码、不改 iOS 原生配置、不改原生生成物（`android/` 是 prebuild 产物）。
- 不改 `slug` / `scheme` / `ios.bundleIdentifier` / `EXPO_BUNDLE_IDENTIFIER_*`。
- 不改 `.trellis/tasks/**` 与 `apps/mobile/docs/android-probe.md` 里的历史观测值。
- 不启动模拟器、不 `adb install`、不截图；设备侧验收统一放在 FEATURE-551 的一次会话。

## Acceptance Criteria

- [ ] `APP_ENV={dev 未设,staging,production}` 三档下 `npx expo config --type public --json` 输出
      `name` = 海尔商城 / 海尔商城 (Staging) / 海尔商城，`android.package` = 三个新包名且互不相同
- [ ] `npx expo prebuild -p android --clean` 成功；`android/app/build.gradle` 的 `applicationId` 为新包名，
      `android/app/src/main/res/values/strings.xml` 的 `app_name` 为 `海尔商城`
- [ ] `pnpm -C apps/mobile typecheck` / `lint` / `test` 通过
- [ ] 仓库内仍有效的 `ai.multica.mobile` 引用已清零（历史产物按 Boundary 保留）
