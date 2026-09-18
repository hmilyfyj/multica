import type { ExpoConfig, ConfigContext } from "expo/config";

/**
 * Dynamic Expo config — replaces app.json so we can read APP_ENV at runtime
 * and switch bundleIdentifier / display name for dev / staging / production.
 *
 * APP_ENV is set by package.json scripts:
 *   - dev          → APP_ENV unset (treated as "development")
 *   - dev:staging  → APP_ENV=staging
 *   - dev:prod     → APP_ENV=production (rare; usually only for EAS build)
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const env = process.env.APP_ENV ?? "development";
  const isProd = env === "production";
  const isStaging = env === "staging";

  return {
    ...config,
    name: isProd
      ? "海尔商城"
      : isStaging
        ? "海尔商城 (Staging)"
        : "海尔商城 (Dev)",
    slug: "multica-mobile",
    version: "0.1.0",
    orientation: "portrait",
    // Applies to both platforms. On Android this only takes effect because
    // expo-system-ui is installed: prebuild writes the value into strings.xml
    // (`expo_system_ui_user_interface_style`), and the module calls
    // AppCompatDelegate.setDefaultNightMode(FOLLOW_SYSTEM) as the activity is
    // created — without it the key would be ignored and the native theme would
    // stay on the template default. The in-app theme switch
    // (lib/use-color-scheme.ts) layers on top: NativeWind's setColorScheme
    // calls React Native's Appearance.setColorScheme, which on Android calls
    // setDefaultNightMode again, so system dialogs, the keyboard and the window
    // background follow the user's choice rather than the OS setting.
    userInterfaceStyle: "automatic",
    scheme: "multica",
    // 1024x1024 source shared with the desktop client
    // (apps/desktop/build/icon.png). Expo prebuild generates every required
    // iOS icon size from this single PNG, and Android's pre-adaptive launcher
    // icon (API < 26) from the same file.
    icon: "./assets/icon.png",
    ios: {
      // Expo keeps the top-level portrait policy for iPhone while adding all
      // iPad orientations required for multitasking when tablet support is on.
      supportsTablet: true,
      // Pins DEVELOPMENT_TEAM on every prebuild. Leaving it unset is the normal
      // path — `expo run:ios` then resolves a signing identity from the Keychain
      // itself, which is right when the Apple ID owns exactly one team. With
      // several (a personal team plus an employer's) it takes the *first*
      // identity found whenever the terminal is non-interactive, writes that
      // choice into the generated ios/, and never clears it again: prebuild only
      // writes DEVELOPMENT_TEAM when a value is present, so a project pinned to
      // the wrong team stays wrong until ios/ is deleted. Setting this re-applies
      // the intended team on every `scripts/ios-run.sh` run, which also repairs
      // an already-mispinned checkout.
      appleTeamId: process.env.EXPO_APPLE_TEAM_ID,
      // Per-variant bundle id overrides exist for one reason: an Apple ID
      // can only sign bundle prefixes it owns, so contributors not on the
      // Multica Apple Developer team (and external users self-building a
      // personal copy against production) need to swap to a reverse-domain
      // they control. Each variant has its own `_<VARIANT>` suffix and is
      // only read inside that variant's branch — a generic
      // `EXPO_BUNDLE_IDENTIFIER` would leak across variants (Expo CLI
      // auto-loads `.env.<mode>.local` regardless of APP_ENV) and collapse
      // dev / staging / prod onto a single id.
      bundleIdentifier: isProd
        ? (process.env.EXPO_BUNDLE_IDENTIFIER_PROD ?? "ai.multica.mobile")
        : isStaging
          ? "ai.multica.mobile.staging"
          : (process.env.EXPO_BUNDLE_IDENTIFIER_DEV ?? "ai.multica.mobile.dev"),
    },
    // The Android ids are deliberately NOT the iOS bundle ids: iOS keeps the
    // `ai.multica.mobile` prefix its Apple team owns, while Android carries the
    // product brand, `com.ehaier.zgq.shop.mall` (FEATURE-557). `package` is
    // required and not
    // optional: app.config.ts is a dynamic config, so Expo cannot write the
    // missing applicationId back into it — `expo prebuild -p android` exits 1
    // until this is present. Each variant needs its own id so all three builds
    // can sit on one device, and Play freezes the id at first upload, so the
    // production value stays overridable through its own `_PROD` variable.
    // One variable per variant for the same reason as the iOS overrides: a
    // generic name would leak across variants.
    //
    // Permissions: none are declared here, deliberately. Reading the photo
    // library needs no Android permission from us — expo-image-picker hands
    // off to the system photo picker on Android 13+ (no permission at all),
    // and on older releases to READ_EXTERNAL_STORAGE, which the generated
    // manifest already declares with `maxSdkVersion="32"`. Adding
    // READ_MEDIA_IMAGES would ask Play for broad photo and video access the
    // app never requests at runtime. Camera and microphone stay off on both
    // platforms — see the expo-image-picker plugin below.
    //
    // `edgeToEdgeEnabled` is deliberately absent: Expo SDK 55 removed the key
    // because Android 16 makes edge-to-edge mandatory, and prebuild now warns
    // when it is present. The behaviour is still what this project targets —
    // the generated gradle.properties keeps the template's
    // `edgeToEdgeEnabled=true`, and the targetSdk pinned in the
    // expo-build-properties plugin below is past the API 35 enforcement
    // cut-off, so the app draws behind the system bars rather than being
    // letterboxed.
    android: {
      package: isProd
        ? (process.env.EXPO_ANDROID_PACKAGE_PROD ?? "com.ehaier.zgq.shop.mall")
        : isStaging
          ? "com.ehaier.zgq.shop.mall.staging"
          : "com.ehaier.zgq.shop.mall.dev",
      // Play rejects an upload that reuses a versionCode inside the same
      // package, so this counts store uploads and has to grow monotonically.
      // Left as a literal instead of being derived from `version` so a release
      // bump cannot silently move it.
      versionCode: 1,
      // The launcher composes the foreground over backgroundColor and then
      // masks the result, so the foreground is the white mark on transparency
      // rather than a flat icon: ./assets/adaptive-icon.png is recovered from
      // ./assets/icon.png (white over #111827), and compositing the two back
      // together reproduces that icon to within one 8-bit step. The mark spans
      // 28.4dp of the 108dp layer, inside the 33dp circle every launcher mask
      // keeps visible, so no mask can clip it.
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#111827",
      },
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "@react-native-community/datetimepicker",
      "react-native-enriched-markdown",
      // Android previously had no splash config at all, so prebuild wrote its
      // stock fallback: Expo's placeholder graphic on white, with an EMPTY
      // res/values-night — a dark-mode launch flashed a white screen. Naming
      // the mark and a background explicitly fixes that and makes Android 12+
      // (which has its own SplashScreen API and ignores the old
      // windowBackground drawable) agree with older releases; the plugin is
      // also what installs expo.modules.splashscreen, whose absence made
      // expo-dev-launcher log `ClassNotFoundException: SplashScreenManager`
      // on every debug start.
      //
      // Image is the same ./assets/adaptive-icon.png the adaptive icon uses —
      // the white mark on transparency, mark = 52.5% of the 1024px canvas — so
      // imageWidth 200 draws a ~105dp mark, inside the 192dp Android 12 keeps
      // visible. Background is the launcher icon's own #111827 for light AND
      // dark (`dark` deliberately omitted): the splash then matches the icon
      // the user just tapped, and a light background would render the white
      // mark invisible.
      [
        "expo-splash-screen",
        {
          image: "./assets/adaptive-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#111827",
        },
      ],
      [
        "expo-image-picker",
        {
          // iOS NSPhotoLibraryUsageDescription. Without this string in
          // Info.plist, calling launchImageLibraryAsync hard-crashes on
          // iOS 14+. Camera + microphone are disabled — we only ever read
          // from the existing photo library. On Android the two `false` values
          // are not iOS-only: the plugin turns them into blocked permissions,
          // so android.permission.CAMERA and RECORD_AUDIO are stripped from
          // the merged manifest and the photo-library-only policy holds on
          // both platforms.
          photosPermission:
            "Allow 海尔商城 to access your photos to attach images to issues and comments.",
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            buildReactNativeFromSource: true,
          },
          // Android's SDK levels are pinned instead of inherited from
          // expo-modules-core (which currently defaults to the same values):
          // the Android build is verified against API 36, and targetSdk is what
          // decides both the edge-to-edge enforcement and Play's upload
          // requirement, so an SDK upgrade must not move it without re-running
          // the emulator pass. minSdk stays on the Expo default — no dependency
          // here raises the floor — and Kotlin is left alone too: every native
          // module in this app reads kotlinVersion from the root project ext,
          // which Expo already pins in step with the Kotlin plugin and KSP it
          // ships.
          android: {
            compileSdkVersion: 36,
            targetSdkVersion: 36,
          },
        },
      ],
    ],
    extra: { APP_ENV: env },
  };
};
