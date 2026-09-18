# Multica Mobile (iOS & Android)

Expo + React Native iOS / Android client for Multica. Independent from web/desktop — shares types and pure utilities from `@multica/core/`. See [`AGENTS.md`](./AGENTS.md) for mobile architecture and development rules; `package.json` records the current dependency versions.

## Just want to use it on your phone? (no development)

Multica isn't on the App Store yet — until that changes, anyone who wants it on their iPhone builds from source. One command:

```bash
pnpm ios:mobile:device:prod:release
```

This connects to the same backend as `multica.ai`, so your existing account just works.

**Prerequisites**: Mac with Xcode, a free Apple ID added under Xcode → Settings → Accounts, iPhone connected via USB with [Developer Mode enabled](https://docs.expo.dev/guides/ios-developer-mode/). Walk through Expo's [Set up your environment](https://docs.expo.dev/get-started/set-up-your-environment/) (pick **Development build → iOS Device**) if any of that is missing.

Xcode signs the build with the "Personal Team" your Apple ID automatically owns — created silently the first time you signed into Xcode, no setup needed. The first build downloads CocoaPods + compiles React Native from source — expect 10–20 minutes. Subsequent builds reuse Xcode's cache.

**If Xcode rejects signing with "No matching provisioning profiles found"** — rare, happens if someone has claimed the default bundle id `ai.multica.mobile` on Apple's developer portal. Pick any reverse-domain you own and re-run:

```bash
export EXPO_BUNDLE_IDENTIFIER_PROD=com.yourname.multica
pnpm ios:mobile:device:prod:release
```

**If your Apple ID belongs to more than one Apple Developer team** — a personal team plus an employer's, say — the build signs with the first identity it finds, which may not be the team you meant, and it keeps reusing that choice on every later build. Pin the right one (find the id in the Apple Developer Portal under Membership):

```bash
export EXPO_APPLE_TEAM_ID=ABCDE12345
pnpm ios:mobile:device:prod:release
```

**7-day signing limit**: a free Apple ID signs builds for 7 days. After that, plug back into the Mac and re-run the command to re-sign. An Apple Developer Program account ($99/yr) extends this to 1 year.

Everything below is for app developers — you can ignore the rest if you only wanted a personal install.

## Scripts

| Command | What it does | Backend |
|---|---|---|
| `pnpm dev:mobile` | Metro only (reuse existing install) | local (`.env.development.local`) |
| `pnpm dev:mobile:staging` | Metro only (reuse existing install) | staging (`.env.staging`) |
| `pnpm dev:mobile:prod` | Metro only (reuse existing install) | production (`.env.production`) |
| `pnpm ios:mobile` | Full rebuild + install on **iOS Simulator**, Debug | local |
| `pnpm ios:mobile:staging` | Full rebuild + install on **iOS Simulator**, Debug | staging |
| `pnpm ios:mobile:prod` | Full rebuild + install on **iOS Simulator**, Debug | production |
| `pnpm ios:mobile:device` | Full rebuild + install on **USB iPhone**, Debug | local |
| `pnpm ios:mobile:device:staging` | Full rebuild + install on **USB iPhone**, Debug | staging |
| `pnpm ios:mobile:device:staging:release` | Full rebuild + install on **USB iPhone**, Release (standalone) | staging |
| `pnpm ios:mobile:device:prod` | Full rebuild + install on **USB iPhone**, Debug | production |
| `pnpm ios:mobile:device:prod:release` | Full rebuild + install on **USB iPhone**, Release (standalone) | production |

`dev:*` runs Metro only — assumes the matching variant is already installed. `ios:mobile*` does a full native rebuild + install.

Bundle id and display name switch on `APP_ENV` (see `app.config.ts`), so Dev / Staging / Production variants can coexist on the same device or simulator.

## First-time setup

`.env.staging` is committed (public staging URL). `.env.development.local` is gitignored — copy the template once:

```bash
cp apps/mobile/.env.example apps/mobile/.env.development.local
# then edit EXPO_PUBLIC_API_URL inside it to your Mac's LAN IP, e.g. http://192.168.1.42:8080
```

If your Apple ID isn't on the Multica Apple Developer team yet, also uncomment and set `EXPO_BUNDLE_IDENTIFIER_DEV` to a reverse-domain you own (e.g. `com.yourname.multica.dev`). This **only** overrides the dev variant — staging / production bundle ids are intentionally not overridable so variants can coexist.

If your Apple ID belongs to more than one Apple Developer team, also set `EXPO_APPLE_TEAM_ID` to the team that should sign your builds. Unlike the bundle id overrides it applies to every variant, and it is re-applied on each run — so it also fixes a checkout that has already latched onto the wrong team.

## Build it onto your iPhone

Two paths, depending on what you want to do:

### Day-to-day development (Mac in front of you)

```bash
pnpm ios:mobile:device:staging
```

Produces a **Debug build** with `expo-dev-launcher` embedded. Every launch the app probes Metro on your Mac and pulls fresh JS — perfect for hot-reload, painful when the Mac is asleep or you're on a different WiFi.

### Standalone / "just use it" (walk away from the Mac)

```bash
pnpm ios:mobile:device:staging:release
```

Produces a **Release build**. No `expo-dev-launcher`, no Metro probe, no "Downloading…" screen. Splash → app, exactly like an App Store install. Trade-off: every JS change requires re-running this command.

Both paths share the same prerequisites: Mac with Xcode, free Apple ID added under Xcode → Settings → Accounts, iPhone connected via USB with Developer Mode enabled. Follow Expo's [Set up your environment](https://docs.expo.dev/get-started/set-up-your-environment/) — pick **Development build → iOS Device** — if any of that is missing.

First build of either variant downloads CocoaPods + compiles React Native from source — expect 10-20 minutes. Subsequent builds reuse Xcode's DerivedData cache.

## Try it in the iOS Simulator (no iPhone needed)

```bash
pnpm ios:mobile:staging
```

Boots the simulator, builds, installs the dev-client. Faster to iterate than a device build because no signing / provisioning step. Same `dev:mobile:staging` Metro flow afterward.

## 7-day signing limit (device only)

A free Apple ID signs builds for **7 days only**, Debug and Release both. After that the app refuses to launch on the iPhone. Plug back into the Mac and re-run the corresponding `ios:mobile:device*` script to re-sign. Simulator builds are unaffected. The only workaround for the device limit is an Apple Developer Program account ($99/yr), which extends to 1 year.

## Android

Android 与 iOS 共用同一套 `APP_ENV` 变体，但包名不同：Android 是品牌包名 `com.ehaier.zgq.shop.mall[.dev/.staging]`、应用名「海尔商城」（Staging / Dev 变体各带后缀），iOS 仍是 `ai.multica.mobile[.dev/.staging]`（均见 `app.config.ts`），
脚本族与 `ios:*` 一一对应，底层是 `expo run:android`。端到端实测记录（含 20 张截图）见 [`docs/android-probe.md`](./docs/android-probe.md)。

### 首次构建前置

| 项 | 要求 | 为什么 |
|---|---|---|
| JDK | **21**，并设 `JAVA_HOME` 指向它 | 本机默认的 JDK 25 会让 Gradle 直接失败（`JvmVendorSpec … IBM_SEMERU`）；同一份 wrapper 在 JDK 21 下正常。**`java_home -v 21` 在只注册了 25 的机器上会静默返回 25**，包装脚本发现版本不是 21 时会提示 |
| Android SDK | 显式设 `ANDROID_HOME`（macOS 常见路径 `~/Library/Android/sdk`） | Gradle 不会自行探测 SDK，未设时报 `SDK location not found` |
| SDK 组件 | 无需手动安装 | 首次构建由 Gradle 自动补 `platforms/android-36`、`build-tools 36.0.0`、`NDK 27.1` |
| 设备 | 模拟器（AVD）或 USB 真机，至少有一个 | `run:android` 需要一个安装目标；列表里未启动的 AVD 会被自动启动 |

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"   # 或用 brew 装 openjdk@21 后指向该路径
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

首次构建（含上述组件下载）约 **7–8 分钟**，日志会长时间停在下载步骤，属正常，不是卡死。

### 原生 ABI 收敛（Debug）

prebuild 模板给 `reactNativeArchitectures` 列了四套 ABI（`armeabi-v7a,arm64-v8a,x86,x86_64`），
但一次安装只会用到目标设备实际运行的那一套。`scripts/android-run.sh` 因此在 **Debug** 构建里收敛到
已连接设备的 `ro.product.cpu.abi`（多个设备取并集；没有已连接设备时按宿主架构映射
`arm64→arm64-v8a`、`x86_64→x86_64`），写进 prebuild 刚生成的 `android/gradle.properties`
（改的是本次运行重新生成的构建产物，不是源码）。不用 `ORG_GRADLE_PROJECT_reactNativeArchitectures`：
`run:android` 会给 Gradle 传一套自己的环境变量，实测该前缀到不了 Gradle。

arm64-v8a 模拟器上实测：debug APK **245MB → 87MB**，`adb install -r` **38.7s → 2.9s**，
`react-native-worklets` + `react-native-reanimated` 的冷编译 **187s → 79s**。

- 关闭收敛：`MULTICA_ANDROID_ABIS=all pnpm android:mobile:device:staging`
- 指定集合：`MULTICA_ANDROID_ABIS=arm64-v8a,armeabi-v7a pnpm android:mobile:device`
- Release 构建（`--variant release`，用于分发）不收敛，仍是四套 ABI。

### 常用命令

| 命令 | 做什么 | 后端 |
|---|---|---|
| `pnpm android:mobile` | 完整重建 + 安装到默认设备（首个可用设备／模拟器），Debug | local |
| `pnpm android:mobile:staging` | 同上，Debug | staging |
| `pnpm android:mobile:prod` | 同上，Debug | production |
| `pnpm android:mobile:device` | 完整重建 + 安装到**选择的设备**，Debug | local |
| `pnpm android:mobile:device:staging` | 同上，Debug | staging |
| `pnpm android:mobile:device:staging:release` | 同上，Release（内嵌 JS，不连 Metro） | staging |
| `pnpm android:mobile:device:prod` | 同上，Debug | production |
| `pnpm android:mobile:device:prod:release` | 同上，Release（内嵌 JS，不连 Metro） | production |

后端切换规则与 iOS 相同：改 `.env.*` 里的 `EXPO_PUBLIC_API_URL`，Debug 构建重启 Metro 即可，
Release 构建要把命令重跑一遍（值在构建时写进内嵌 bundle）。

### 与 iOS 的差异

- 不需要 Xcode／Apple ID／描述文件，也没有 7 天重签限制：`expo prebuild` 生成的 `android/app/build.gradle` 里 debug 与 release 都用工程自带的 debug keystore 签名，可直接装到设备；只有上架 Play 才需要换成自己的上传密钥。
- `--device` 语义不同：iOS 上是「USB 真机 vs 默认模拟器」；Android 上是「从设备列表里挑一个」，
  列表里也包含尚未启动的 AVD，选中会自动启动。不带 `--device` 时直接用第一个可用设备，不提示。
- 构建类型开关名不同：iOS 是 `--configuration Release`，Android 是 `--variant release`。
- `dev:mobile` / `dev:mobile:staging` / `dev:mobile:prod` 三个 Metro 脚本两平台通用，没有也不需要 Android 专属版本。
- `android/` 与 `ios/` 一样是 `expo prebuild` 生成物且已被 gitignore，不要手改；配置一律写进 `app.config.ts`。
- 两个平台都经 `scripts/{ios,android}-run.sh` 包装：先 prebuild 再 run。`expo run:*` 在原生目录已存在时会跳过
  prebuild，config plugin 的改动就不会生效，包装脚本负责补上这一步。

### 常见报错

| 报错 | 原因与处理 |
|---|---|
| `Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field 'JvmVendorSpec IBM_SEMERU'` | 用到了 JDK 25；切到 JDK 21 并设 `JAVA_HOME` |
| `BUG! exception in phase 'semantic analysis' … Unsupported class file major version 69` | 同上，JDK 版本过高 |
| `SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable …` | 未设 `ANDROID_HOME` |
| 首次构建长时间停在下载／`Downloading …` | Gradle 在补 SDK 组件，等待即可 |
| prebuild 报 `Cannot automatically write to dynamic config at: app.config.ts` | 动态配置里缺 `android` 段必填字段（如 `android.package`）；本仓库已补齐 |
| 原生编译阶段 `configureCMakeDebug[…]` 报 `A restricted method in java.lang.System has been called` | `JAVA_HOME` 实际指向 JDK 25（只注册了 25 的机器上 `java_home -v 21` 会返回 25）；指向 `/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` 再跑 |

## Pointing at a different backend

Edit `EXPO_PUBLIC_API_URL` in `.env.staging`, `.env.production`, or `.env.development.local` (whichever variant you're running). Then:

- For an installed **Debug build**: restart Metro (`pnpm dev:mobile:staging`) so the next JS bundle picks up the new value.
- For an installed **Release build**: re-run the `ios:mobile:device:staging:release` command — the value is baked into the embedded bundle at build time.

For local backend testing, use your Mac's LAN IP (`ipconfig getifaddr en0`), not `localhost`.
