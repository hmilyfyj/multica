/**
 * Inbox realtime — Layer 3 of the realtime stack.
 *
 * Three subscription groups:
 *
 * 1. `inbox:*` events → invalidate the inbox list AND the cross-workspace
 *    unread summary that backs the tab badge (the summary lives under its
 *    own account-level key, so the list invalidation does not reach it).
 *    inbox payloads are small and (apart from inbox:new) rare, so refetching
 *    is cheaper than maintaining per-event patchers. Multi-device parity:
 *    subscribing to inbox:read / inbox:archived means a read/archive on web
 *    reaches mobile within the next WS frame (web's use-realtime-sync
 *    deliberately DOESN'T subscribe to those, but mobile's stricter freshness
 *    wins for multi-device users).
 *
 * 2. `issue:*` events → patch the inbox cache directly via the dedicated
 *    updaters (inbox-ws-updaters.ts). Required because:
 *      - `issue:updated` with a new status must flip the inbox row's
 *        StatusIcon inline — otherwise the row keeps showing stale status.
 *      - `issue:deleted` must strip every inbox item pointing at that
 *        issue, otherwise tapping the orphan row 404s on issue/[id].
 *    Web does the same in `packages/core/inbox/ws-updaters.ts`.
 *
 * 3. `task:*` lifecycle events → invalidate the workspace agent-task
 *    snapshot behind the row's "working" badge. The handler block below
 *    carries the reasoning (which event is load-bearing, and why this file
 *    subscribes rather than relying on presence realtime).
 *
 * Reconnect: invalidate the list and the snapshot (we may have missed events
 * while down; no replay buffer in v1).
 *
 * `inbox:new` additionally raises an **Android** system banner (plan "A",
 * FEATURE-562; see inbox-notification.ts for the mute/permission gates and
 * for why a killed app stops notifying). iOS is untouched — the branch
 * below never runs there.
 */
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  dropInboxItemsByIssue,
  patchInboxIssueStatus,
  refreshInboxList,
  refreshInboxUnreadSummary,
} from "./inbox-ws-updaters";
import { notifyNewInboxItem } from "./inbox-notification";

export function useInboxRealtime() {
  const qc = useQueryClient();
  const slug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  useWSSubscriptions(
    (ws, wsId) => {
      const invalidate = () => {
        // Shared entry points: each cancels an in-flight request before
        // invalidating, which a plain invalidate cannot do on a first load.
        // Both caches, because the badge is rendered over the list it counts.
        void refreshInboxList(qc, wsId);
        void refreshInboxUnreadSummary(qc);
      };

      // Key comes from the query factory, so this file cannot drift from the
      // query it refreshes (lib/inbox-activity.ts derives the row badge off
      // that snapshot).
      const invalidateSnapshot = () =>
        void qc.invalidateQueries({
          queryKey: agentTaskSnapshotOptions(wsId).queryKey,
        });

      return [
        // Inbox-domain events: refetch the inbox list and the badge count.
        // A new item also raises an Android system banner — the phone's
        // counterpart of the desktop client's Electron `new Notification` and
        // of `showWebNotification` in the shared handler. Both run: the banner
        // must not depend on, or delay, the cache refresh beside it.
        ws.on("inbox:new", (payload) => {
          invalidate();
          if (Platform.OS === "android") {
            void notifyNewInboxItem(qc, payload.item, wsId, slug ?? "");
          }
        }),
        ws.on("inbox:read", invalidate),
        // Mobile has no mark-unread affordance yet (web/desktop right-click
        // only), but a mark-unread there must un-read the row here too —
        // otherwise the phone keeps showing it read and the unread dots
        // disagree across clients.
        ws.on("inbox:unread", invalidate),
        ws.on("inbox:archived", invalidate),
        // Mobile has no archived view yet (web/desktop only, MUL-3736), but an
        // unarchive there restores the item to THIS list — without refetching,
        // mobile keeps showing the pre-restore list.
        ws.on("inbox:unarchived", invalidate),
        ws.on("inbox:batch-read", invalidate),
        ws.on("inbox:batch-archived", invalidate),

        // Agent task lifecycle — the inbox row's "working" badge reads the
        // workspace agent-task snapshot, so every transition that moves an
        // issue between working / queued / nothing has to reach it. web
        // refreshes that same snapshot on each `task:` event
        // (packages/core/realtime/use-realtime-sync.ts:909); task:progress and
        // task:message stay unsubscribed for the cellular-data reason
        // documented in use-presence-realtime.ts.
        //
        // task:running is the one this file cannot go without. The backend
        // broadcasts it precisely for the dispatched → running flip that a
        // queued-vs-working UI waits on (server/internal/service/task.go:4152),
        // and presence realtime does not subscribe to it — without this the
        // badge would sit on "Queued" for the whole run and only clear when
        // something else happened to refetch. Presence invalidates the same
        // key for the other transitions; invalidation is idempotent and the
        // two subscriptions collapse into one refetch.
        ws.on("task:queued", invalidateSnapshot),
        ws.on("task:dispatch", invalidateSnapshot),
        ws.on("task:running", invalidateSnapshot),
        ws.on("task:waiting_local_directory", invalidateSnapshot),
        ws.on("task:completed", invalidateSnapshot),
        ws.on("task:failed", invalidateSnapshot),
        ws.on("task:cancelled", invalidateSnapshot),

        // Cross-cutting: issue events that need to patch inbox state.
        ws.on("issue:updated", (payload) => {
          patchInboxIssueStatus(
            qc,
            wsId,
            payload.issue.id,
            payload.issue.status,
          );
        }),
        ws.on("issue:deleted", (payload) => {
          void dropInboxItemsByIssue(qc, wsId, payload.issue_id);
        }),

        // After a reconnect we don't know what we missed during the
        // downtime — refresh from server.
        ws.onReconnect(() => {
          invalidate();
          invalidateSnapshot();
        }),
      ];
    },
    [qc, slug],
  );
}
