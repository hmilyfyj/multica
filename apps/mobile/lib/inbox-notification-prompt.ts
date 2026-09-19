/**
 * One-time notification opt-in, on the first inbox visit (FEATURE-562).
 *
 * The settings screen owns the explicit switch, but a permission nobody is told
 * about is a permission nobody grants: the first shipped build could only ever
 * bump the OS permission from 设置 → 通知, and a device that never went there
 * silently drops every banner. This is the second entry point the issue allows
 * (登录后首次进入收件箱), placed at the moment the user is looking at the thing
 * notifications are about.
 *
 * It asks **at most once per install** and only while the OS has not granted
 * it, so a declined app is never asked again — the settings row stays the place
 * to re-enable it, and the OS would refuse a second dialog anyway.
 *
 * RN-side module on purpose: `expo-secure-store` and `Platform` cannot load in
 * the mobile Vitest lane, and none of the payload logic lives here.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  getLocalNotificationPermission,
  requestLocalNotificationPermission,
} from "@/lib/local-notifications";

const ASKED_KEY = "multica_notification_prompt_asked";

/** Ask once, on Android, unless notifications are already allowed. */
export async function maybePromptForNotificationPermission(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    if (await SecureStore.getItemAsync(ASKED_KEY)) return;
    // Recorded before asking: a decline, a dismissed dialog or a crash must not
    // turn the next inbox visit into a second prompt.
    await SecureStore.setItemAsync(ASKED_KEY, "1");
    const current = await getLocalNotificationPermission();
    // Note the Android asymmetry: a never-asked runtime permission already
    // reports `denied`, and so does an app switched off in the system's own
    // notification settings, so "not granted" — not `undetermined` — is the
    // condition to ask under. When Android has nothing left to ask it shows no
    // dialog and this returns the same state, which the settings row explains.
    if (current.status === "granted") return;
    await requestLocalNotificationPermission();
  } catch (err) {
    console.warn("[notifications] permission prompt failed", err);
  }
}
