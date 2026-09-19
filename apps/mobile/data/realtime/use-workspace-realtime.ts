/**
 * Workspace identity + membership realtime — listing-level, mounted for the
 * whole workspace session (`RealtimeSubscriptions` in
 * `app/(app)/[workspace]/_layout.tsx`).
 *
 * Closes the workspace / member half of the web-parity gap: web answers both
 * families in `packages/core/realtime/use-realtime-sync.ts` (refreshMap
 * `workspace` / `member` prefixes plus the member:added / member:removed
 * specific handlers) and mobile answered neither.
 *
 *   workspace:updated → invalidate the account-level workspace list. The
 *                       payload carries the full Workspace, but the list is
 *                       tiny and admin-rare: a refetch is the whole answer.
 *                       Update never rewrites the slug
 *                       (`pkg/db/generated/workspace.sql.go` updateWorkspace),
 *                       so the active route stays valid — only the displayed
 *                       name/description/avatar repaint.
 *   workspace:deleted → the same list. When the deleted workspace is the
 *                       active one, refreshing this key is what lets
 *                       `[workspace]/_layout` see that the slug no longer
 *                       matches a membership and redirect to
 *                       /select-workspace — no navigation code lives here.
 *   member:added      → who can be assigned or mentioned changed, so the
 *                       member list the pickers and `useActorName` read is
 *                       stale. Web additionally refreshes the workspace list
 *                       when the added member is the signed-in user; the
 *                       server publishes member:added before
 *                       invitation:accepted (`invitation.go`), so that is also
 *                       how a workspace joined elsewhere appears in mobile's
 *                       switcher.
 *   member:updated    → rebuild the member list.
 *   member:removed    → same list; when the removed user is the signed-in
 *                       user, the workspace list is what makes the layout
 *                       above drop this session.
 *
 * Everything here is invalidate-only. Both payloads are full records, but the
 * caches they feed are admin-churn picker data with no patch path on mobile;
 * the patch-over-invalidate rule in apps/mobile/AGENTS.md targets the
 * high-traffic lists (issues, chat, inbox), not this.
 *
 * Reconnect: both keys, because membership changes slept through while
 * disconnected would otherwise stay invisible (the layout's redirect depends
 * on the workspace list being current).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/data/auth-store";
import { memberListOptions } from "@/data/queries/members";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";

export function useWorkspaceRealtime() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useWSSubscriptions(
    (ws, wsId) => {
      const membersKey = memberListOptions(wsId).queryKey;
      const workspacesKey = workspaceListOptions().queryKey;

      const invalidateMembers = () =>
        qc.invalidateQueries({ queryKey: membersKey });
      const invalidateWorkspaces = () =>
        qc.invalidateQueries({ queryKey: workspacesKey });

      return [
        ws.on("workspace:updated", invalidateWorkspaces),
        ws.on("workspace:deleted", invalidateWorkspaces),

        ws.on("member:added", (payload) => {
          invalidateMembers();
          if (payload.member.user_id === userId) invalidateWorkspaces();
        }),
        ws.on("member:updated", invalidateMembers),
        ws.on("member:removed", (payload) => {
          invalidateMembers();
          if (payload.user_id === userId) invalidateWorkspaces();
        }),

        ws.onReconnect(() => {
          invalidateMembers();
          invalidateWorkspaces();
        }),
      ];
    },
    [qc, userId],
  );
}
