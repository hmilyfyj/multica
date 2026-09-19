/**
 * Handling a tap on an inbox banner (Android, FEATURE-562 plan "A").
 *
 * Kept out of `lib/local-notifications.ts` on purpose: this half needs the
 * router and the API client, neither of which the Node Vitest lane can load, so
 * the payload/route decisions it consumes stay in that tested module.
 *
 * Register via `subscribeToInboxNotificationResponses` from the app bootstrap,
 * on Android only.
 */
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { api } from "@/data/api";
import {
  getInboxNotificationTarget,
  readInboxNotificationPayload,
  type InboxNotificationPayload,
} from "@/lib/local-notifications";

/**
 * A tap can be delivered twice for one notification: the launching tap is
 * buffered natively while JS boots (that is what `getLastNotificationResponse`
 * exposes) and may *also* reach the live listener once it attaches. The row id
 * identifies the notification, so remembering the last one handled makes the
 * second delivery a no-op without suppressing a genuinely new banner later.
 */
let lastHandledItemId: string | null = null;

function handleResponse(response: Notifications.NotificationResponse | null) {
  if (!response) return;
  const payload = readInboxNotificationPayload(
    response.notification.request.content.data,
  );
  if (!payload || payload.itemId === lastHandledItemId) return;
  lastHandledItemId = payload.itemId;
  void openInboxNotification(payload);
}

/**
 * Open what the banner was about: mark the row read (the same thing a tap on
 * the row itself does — its optimistic half lives in `useMarkInboxRead`, which
 * is unavailable outside React, and the server's `inbox:read` event refreshes
 * the list), then route to the issue or the inbox sheet.
 *
 * The mark-read call is best-effort: navigation is what the user asked for by
 * tapping, so a failed write is logged and the trip still happens.
 */
export async function openInboxNotification(
  payload: InboxNotificationPayload,
): Promise<void> {
  // Same rule as web/desktop: a payload whose workspace could not be resolved
  // has no safe destination, so it is ignored rather than routed somewhere else.
  if (!payload.slug) return;
  try {
    await api.markInboxRead(payload.itemId);
  } catch (err) {
    console.warn("[notifications] failed to mark inbox item read", err);
  }
  const target = getInboxNotificationTarget(payload, String(Date.now()));
  if (target) router.push(target);
}

/**
 * Start listening for taps, including the one that launched the app, and return
 * the unsubscribe function. Android only — see the module doc.
 */
export function subscribeToInboxNotificationResponses(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    handleResponse,
  );
  // The tap that started a cold app was delivered before this listener existed,
  // so it has to be pulled instead of awaited.
  void Notifications.getLastNotificationResponseAsync().then(handleResponse);
  return () => subscription.remove();
}
