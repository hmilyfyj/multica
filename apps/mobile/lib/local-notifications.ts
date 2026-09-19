/**
 * Android local notifications — platform plan "A" (FEATURE-562).
 *
 * The app's realtime layer (not `packages/core/realtime/use-realtime-sync.ts`,
 * which the web/desktop clients use) turns an `inbox:new` WS frame into a
 * system banner through this module. The payload mirrors the shared one
 * (`packages/core/platform/system-notification.ts`) so both clients notify
 * about the same facts.
 *
 * Boundaries — read before changing this file:
 *
 *   - **Local only.** The banner is produced by the app process itself from an
 *     already-open WebSocket. There is no push channel, so nothing arrives once
 *     Android kills or reclaims the process: if the user swipes the app away,
 *     runs the device low on memory, or leaves it backgrounded long enough for
 *     the OS to reap it, new inbox items simply go unnoticed until the app is
 *     opened again. That is the accepted limit of plan A, not a defect. It is
 *     also why OEM background policies matter on top of it — HyperOS/MIUI
 *     freeze cached apps, which ends the socket even though the user never
 *     swiped anything away.
 *   - **Not the same thing as lock-screen push.** Delivering to a dead process
 *     needs FCM (device token registration, a backend sender, per-device
 *     fan-out) — evaluated and deliberately out of scope. Adding it later means
 *     a backend change; nothing here fakes it.
 *   - **Android only.** iOS keeps its existing behaviour: `use-inbox-realtime`
 *     does not call this module there, so no banner is posted and no permission
 *     prompt is raised.
 *
 * A banner can also fail to appear with nothing wrong in this file: the OS
 * permission may be missing, the app may be switched off in the system's own
 * notification settings (HyperOS reports that as `denied` too — see
 * `NotificationPermissionsModule.kt`), or our channel may have been turned off
 * in the channel list. All three are invisible to the user, so the last attempt
 * and the channel state are recorded here and surfaced in the settings screen —
 * that is the only way a user on a real device can tell "the phone blocked it"
 * from "nothing was sent".
 *
 * This module must not import `react-native`: the mobile Vitest lane is Node
 * only and cannot load RN native modules (see `apps/mobile/vitest.config.ts`),
 * and the payload helpers below are the part that must stay covered by unit
 * tests. Platform decisions belong at the RN-side call sites.
 */
import * as Notifications from "expo-notifications";
import type { InboxItem } from "@multica/core/types";
import { getInboxDisplayTitle } from "@/lib/inbox-display";

/**
 * Android 8+ drops any notification that does not name an existing channel, so
 * one is created at bootstrap (`ensureInboxNotificationChannel`). A single
 * channel covers every inbox item: the server-side groups that the settings
 * screen exposes (comments, mentions, agent activity, …) are a *preference*
 * axis that decides whether an item reaches the inbox at all, not a per-banner
 * presentation axis, and web/desktop likewise raise one banner style for all of
 * them. Importance HIGH is what makes Android show the heads-up banner instead
 * of a silent tray entry.
 */
export const INBOX_NOTIFICATION_CHANNEL_ID = "inbox";

/**
 * Everything the banner and its tap need. Mirrors the shared
 * `SystemNotificationPayload` (see the module doc) minus `issueKey`: the shared
 * payload derives `issueKey = issue_id ?? id` because its consumer only needs
 * one selector, while the phone must know which of the two it is routing to, so
 * the two ids are carried explicitly rather than conflated.
 */
export interface InboxNotificationPayload {
  /**
   * Source workspace slug. The WS connection is scoped to the workspace the
   * user is in, so this is that workspace; empty means "unknown", and the tap is
   * then a no-op instead of routing into the wrong workspace.
   */
  slug: string;
  /** Inbox row id — marks the row read on tap, and doubles as the notification identifier. */
  itemId: string;
  /** Issue the item is attached to, or null for standalone items (e.g. quota notices). */
  issueId: string | null;
  title: string;
  body: string;
}

/**
 * Build the banner contents for one inbox item.
 *
 * The title is `getInboxDisplayTitle`, not the raw `item.title` the shared
 * handler sends: on mobile that helper IS the inbox copy (it is what the row
 * the user taps renders, and what the `inbox/[id]` sheet renders), and it
 * deliberately replaces backend fallback copy that can carry raw counts.
 * Reusing it keeps the banner and the row it points at saying the same thing.
 */
export function buildInboxNotificationPayload(
  item: InboxItem,
  slug: string,
): InboxNotificationPayload {
  return {
    slug,
    itemId: item.id,
    issueId: item.issue_id ?? null,
    title: getInboxDisplayTitle(item),
    body: item.body ?? "",
  };
}

/**
 * Serialise the payload for `content.data`.
 *
 * A null `issueId` is omitted rather than stored as null: the data travels
 * through an Android `Bundle`, which does not round-trip null values, so an
 * absent key is the one encoding both platforms agree on.
 */
export function toNotificationData(
  payload: InboxNotificationPayload,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    slug: payload.slug,
    itemId: payload.itemId,
    title: payload.title,
    body: payload.body,
  };
  if (payload.issueId) data.issueId = payload.issueId;
  return data;
}

/**
 * Read a payload back off a notification's `data` (a tap delivers untrusted,
 * loosely-typed values), or null when it is not one of ours. Unknown payloads
 * are ignored rather than guessed at.
 */
export function readInboxNotificationPayload(
  data: unknown,
): InboxNotificationPayload | null {
  if (typeof data !== "object" || data === null) return null;
  const { slug, itemId, issueId, title, body } = data as Record<string, unknown>;
  if (
    typeof slug !== "string" ||
    typeof itemId !== "string" ||
    typeof title !== "string" ||
    typeof body !== "string"
  ) {
    return null;
  }
  if (typeof issueId !== "string" && issueId != null) return null;
  return { slug, itemId, title, body, issueId: issueId ?? null };
}

/**
 * Where a tapped banner should land: the issue it is about, or — for items
 * with no issue attached — the inbox sheet that holds the item's own details.
 * A payload without a slug has no route (see `InboxNotificationPayload.slug`).
 *
 * `historyToken` matches what the inbox row passes when it navigates
 * (`getInboxNavigationTarget`), so the issue page treats both entry points the
 * same. Unlike the row, a banner carries no `comment_id`, so the destination
 * opens without a specific comment highlight.
 */
export function getInboxNotificationTarget(
  payload: InboxNotificationPayload,
  historyToken: string,
) {
  if (!payload.slug) return null;
  if (payload.issueId) {
    return {
      pathname: "/[workspace]/issue/[id]" as const,
      params: {
        workspace: payload.slug,
        id: payload.issueId,
        h: historyToken,
      },
    };
  }
  return {
    pathname: "/[workspace]/inbox/[id]" as const,
    params: { workspace: payload.slug, id: payload.itemId },
  };
}

/**
 * How the banner behaves while the app is in the foreground. Called once at
 * bootstrap (Android only).
 *
 * Foreground banners are ON, for the same reason the issue asked for them: the
 * banner is the whole feature, and a user testing on a device has the app open.
 * Note the Android-specific `shouldPlaySound: true` — with it false,
 * expo-notifications suppresses the drop-down alert entirely regardless of the
 * channel's importance (`NotificationBehavior.shouldPlaySound` in the library's
 * docs), which would leave foreground deliveries invisible.
 */
export function configureLocalNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Create the Android channel. Safe to call repeatedly: the platform treats a
 * re-created channel as an update, so a later change to the settings below
 * (importance included — Android lets the app raise its own channel's
 * importance) applies on the next launch. When this never runs, the notification
 * still posts through the library's fallback channel rather than being dropped.
 */
export async function ensureInboxNotificationChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(
    INBOX_NOTIFICATION_CHANNEL_ID,
    {
      name: "Inbox",
      description:
        "New inbox items — mentions, assignments, comments and agent activity.",
      importance: Notifications.AndroidImportance.HIGH,
    },
  );
}

export interface LocalNotificationPermission {
  status: "granted" | "denied" | "undetermined";
  /** False once Android has decided: the OS dialog will not appear again. */
  canAskAgain: boolean;
}

function toPermission(
  settings: Notifications.NotificationPermissionsStatus,
): LocalNotificationPermission {
  return { status: settings.status, canAskAgain: settings.canAskAgain };
}

/** Current OS permission. Android < 13 has no runtime permission, and reports `granted`. */
export async function getLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  return toPermission(await Notifications.getPermissionsAsync());
}

/**
 * Ask the OS (Android 13+ shows the `POST_NOTIFICATIONS` dialog). Used by the
 * settings row and by the one-time prompt on the first inbox visit
 * (`lib/inbox-notification-prompt.ts`); it is never called on a timer or on
 * every launch, so a declined app is not asked again.
 *
 * A `denied` result does not always mean the user tapped "Don't allow": when
 * the app itself is switched off in the system notification settings, Android
 * has nothing left to ask and returns `denied` without showing anything.
 */
export async function requestLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  return toPermission(await Notifications.requestPermissionsAsync());
}

export interface InboxNotificationChannelState {
  exists: boolean;
  /** False when the user switched this channel off in the system's channel list. */
  enabled: boolean;
}

/**
 * Whether our channel exists and is still switched on. Android lets the user
 * disable one channel without touching the app-level switch, and a disabled
 * channel silently swallows every banner posted to it — the second most common
 * "notifications don't work" state after a missing permission, and invisible
 * from inside the app unless it is asked for.
 */
export async function getInboxNotificationChannelState(): Promise<InboxNotificationChannelState> {
  const channel = await Notifications.getNotificationChannelAsync(
    INBOX_NOTIFICATION_CHANNEL_ID,
  );
  if (!channel) return { exists: false, enabled: false };
  return {
    exists: true,
    enabled: channel.importance !== Notifications.AndroidImportance.NONE,
  };
}

export type InboxNotificationOutcome =
  | "shown"
  | "skipped-permission"
  | "skipped-muted"
  | "failed";

export interface InboxNotificationAttempt {
  outcome: InboxNotificationOutcome;
  /** The inbox row the attempt was for; a settings-screen test uses "test". */
  itemId: string;
  title: string;
  at: number;
  /** Failure message, or the permission status that blocked the banner. */
  detail?: string;
}

// Diagnostics only: the newest attempt, in memory, so the settings screen can
// answer "why didn't it show?" on a device where nobody can read logcat. Not a
// queue and not persisted — it describes this process's last event, which is
// exactly the question being asked.
let lastAttempt: InboxNotificationAttempt | null = null;

export function recordInboxNotificationAttempt(
  attempt: InboxNotificationAttempt,
): void {
  lastAttempt = attempt;
}

export function getLastInboxNotificationAttempt(): InboxNotificationAttempt | null {
  return lastAttempt;
}

/**
 * Post the banner for one inbox item. A no-op without permission, mirroring
 * `showWebNotification` on web: the in-app inbox and its badge already reflect
 * the item, so a missing grant degrades instead of erroring. The skip is
 * recorded so the settings screen can say so.
 *
 * `identifier` is the inbox row id, which becomes the Android notification tag —
 * a repeat for the same item replaces the previous banner instead of stacking,
 * the same dedupe web gets from its `tag`.
 */
export async function showInboxNotification(
  payload: InboxNotificationPayload,
): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    recordInboxNotificationAttempt({
      outcome: "skipped-permission",
      itemId: payload.itemId,
      title: payload.title,
      at: Date.now(),
      detail: status,
    });
    return;
  }
  await Notifications.scheduleNotificationAsync({
    identifier: payload.itemId,
    content: {
      title: payload.title,
      body: payload.body,
      data: toNotificationData(payload),
    },
    // `{ channelId }` is the immediate trigger on Android (`ExpoSchedulingDelegate`
    // presents a channel-aware trigger right away); other platforms resolve it to
    // a plain immediate delivery.
    trigger: { channelId: INBOX_NOTIFICATION_CHANNEL_ID },
  });
  recordInboxNotificationAttempt({
    outcome: "shown",
    itemId: payload.itemId,
    title: payload.title,
    at: Date.now(),
  });
}
