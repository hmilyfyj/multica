/**
 * The `inbox:new` → system banner path for Android (FEATURE-562, plan "A").
 *
 * Split out of `use-inbox-realtime` so it can be unit tested: this module
 * imports no `react-native` (the mobile Vitest lane is Node only), and the
 * Android gate lives at the hook, which passes the current workspace in.
 *
 * Two gates decide whether a banner is raised, and both are needed:
 *
 *   1. the workspace's `system_notifications` preference — the same setting the
 *      settings screen writes and web/desktop honour, so muting silences every
 *      client rather than just the loud ones;
 *   2. the OS notification permission, checked inside `showInboxNotification`.
 *
 * Whichever gate declines, the attempt is recorded (`recordInboxNotificationAttempt`)
 * so the settings screen can tell the user which one — on a phone with no
 * logcat, "nothing happened" is otherwise indistinguishable from a bug.
 *
 * Unlike web, the item's own `workspace_id` is not used to find the mute
 * setting: mobile holds one WebSocket per active workspace (the upgrade URL
 * carries `workspace_slug`), so the only workspace this connection can report
 * about is the one passed in here. That removes the wrong-workspace read web had
 * to fix in #3766 instead of re-solving it.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { InboxItem } from "@multica/core/types";
import { notificationPreferenceOptions } from "@/data/queries/notification-preferences";
import {
  buildInboxNotificationPayload,
  recordInboxNotificationAttempt,
  showInboxNotification,
} from "@/lib/local-notifications";

/**
 * Raise a banner for one newly-arrived inbox item.
 *
 * Never throws: it is called fire-and-forget from a WS event handler, and a
 * failed banner must not disturb the cache refresh that runs beside it. Callers
 * on platforms without local notifications simply do not call it.
 */
export async function notifyNewInboxItem(
  qc: QueryClient,
  item: InboxItem,
  wsId: string | null,
  slug: string,
): Promise<void> {
  const payload = buildInboxNotificationPayload(item, slug);
  try {
    if (!(await systemNotificationsEnabled(qc, wsId))) {
      recordInboxNotificationAttempt({
        outcome: "skipped-muted",
        itemId: payload.itemId,
        title: payload.title,
        at: Date.now(),
      });
      return;
    }
    await showInboxNotification(payload);
  } catch (err) {
    console.warn("[notifications] failed to show inbox banner", err);
    recordInboxNotificationAttempt({
      outcome: "failed",
      itemId: payload.itemId,
      title: payload.title,
      at: Date.now(),
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Read the workspace's `system_notifications` preference.
 *
 * `ensureQueryData` returns the cached value and only hits the network when
 * there is nothing cached (TanStack v5 does not revalidate stale data unless
 * asked), so a warm cache — which is the normal case, since the settings screen
 * and every earlier event filled it — costs no request per inbox item.
 *
 * A failed read falls through as "not muted": an unreachable preference
 * endpoint must not silently swallow notifications the user never turned off.
 */
async function systemNotificationsEnabled(
  qc: QueryClient,
  wsId: string | null,
): Promise<boolean> {
  if (!wsId) return true;
  try {
    const data = await qc.ensureQueryData(notificationPreferenceOptions(wsId));
    return data?.preferences?.system_notifications !== "muted";
  } catch {
    return true;
  }
}
