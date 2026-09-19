/**
 * Cross-platform navigation glyph.
 *
 * iOS renders the SF Symbol named `sf` through expo-image's `sf:` source
 * scheme. Android has no SF Symbols, and expo-image passes the source
 * straight to Glide, which rejects it —
 *
 *   java.lang.IllegalArgumentException: Expected URL scheme 'http' or
 *   'https' but was 'sf'
 *     at okhttp3.HttpUrl$Builder.parse$okhttp(HttpUrl.kt:1254)
 *
 * — and draws nothing at all (verified on the emulator, 2026-09-18). Every
 * `sf:` source used to be a blank box on Android, including all four bottom
 * tab icons. The Android branch therefore draws Ionicons, the icon set the
 * rest of the app already uses on both platforms (`components/ui/icon-button.tsx`,
 * `search-field.tsx`, the More list rows, …), so the nav chrome matches the
 * screen chrome.
 *
 * Per `.trellis/spec/mobile/frontend/android-platform.md` ("平台差异原则"),
 * the whole difference lives here — the iOS path is byte-for-byte the old
 * `expo-image` call and no call site writes its own `Platform.OS` check.
 *
 * `sf`/`ion` are both required rather than derived from one name: SF Symbols
 * and Ionicons have no common naming scheme, and the SF `.fill` variant that
 * marks a selected tab has no Ionicons counterpart with the same spelling
 * (`tray.fill` → `file-tray`, not `file-tray.fill`).
 */
import { Ionicons } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";
import { Platform } from "react-native";

export type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export interface NavIconProps {
  /** SF Symbol name for iOS, un-prefixed (e.g. `"tray.fill"`). */
  sf: string;
  /** Ionicons name for Android, same meaning as `sf`. */
  ion: IoniconName;
  color: string;
  size: number;
}

export function NavIcon({ sf, ion, color, size }: NavIconProps) {
  if (Platform.OS === "ios") {
    return (
      <ExpoImage
        source={`sf:${sf}`}
        tintColor={color}
        style={{ width: size, height: size }}
      />
    );
  }

  return <Ionicons name={ion} size={size} color={color} />;
}
