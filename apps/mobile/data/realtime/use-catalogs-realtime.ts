/**
 * Workspace catalog realtime — the three workspace-scoped catalogs every
 * issue picker and chip reads: squads, labels and the issue status catalog.
 * Listing-level, mounted for the whole workspace session.
 *
 * Web answers all three through its `refreshMap` prefixes
 * (`packages/core/realtime/use-realtime-sync.ts`); mobile had no subscription
 * for any of them, so a squad rename/label recolor/status edit made on
 * web/desktop stayed invisible here until something else refetched.
 *
 *   squad:created / squad:updated → the assignee, mention and project-lead
 *                       pickers plus `useActorName` read
 *                       `["squads", wsId]`. Web also drags its issue caches
 *                       along on every squad event; mobile does not, because
 *                       no issue row stores a squad snapshot — the assignee
 *                       display name is resolved from this cache at render
 *                       time.
 *   squad:deleted     → the exception: deleting a squad transfers its issues
 *                       to another assignee server-side, so the issue caches
 *                       (list / my / detail) must refetch. Web invalidates
 *                       its issue tree for the same reason.
 *   label:created / label:updated / label:deleted → the label picker reads
 *                       `labelKeys.all(wsId)`, and the issue detail's label
 *                       chips render `issue.labels` inline (name + color), so
 *                       the issue caches go stale with the catalog. Agents and
 *                       skills are deliberately NOT refreshed — web invalidates
 *                       them for its agent/skill label pickers, mobile renders
 *                       no labels on those surfaces.
 *   issue_status:changed → refresh the status catalog only. Issue rows store
 *                       the status KEY and resolve name/color through
 *                       `useIssueStatuses` at render time, so the catalog
 *                       refetch is what repaints a rename — dragging every
 *                       issue list along would be the workspace-wide refetch
 *                       storm web explicitly avoids (MUL-6458).
 *
 * Reconnect: all three catalogs, since an edit made while the socket was down
 * has no other way to reach these caches.
 */
import { useQueryClient } from "@tanstack/react-query";
import { issueKeys } from "@/data/queries/issue-keys";
import { issueStatusKeys } from "@/data/queries/issue-statuses";
import { labelKeys } from "@/data/queries/labels";
import { squadListOptions } from "@/data/queries/squads";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";

export function useCatalogsRealtime() {
  const qc = useQueryClient();

  useWSSubscriptions(
    (ws, wsId) => {
      const squadsKey = squadListOptions(wsId).queryKey;
      const labelsKey = labelKeys.all(wsId);
      const statusesKey = issueStatusKeys.all(wsId);
      const issuesKey = issueKeys.all(wsId);

      const invalidateSquads = () =>
        qc.invalidateQueries({ queryKey: squadsKey });
      const invalidateLabels = () =>
        qc.invalidateQueries({ queryKey: labelsKey });
      const invalidateStatuses = () =>
        qc.invalidateQueries({ queryKey: statusesKey });
      const invalidateIssues = () =>
        qc.invalidateQueries({ queryKey: issuesKey });

      const invalidateLabelCascade = () => {
        invalidateLabels();
        invalidateIssues();
      };

      return [
        ws.on("squad:created", invalidateSquads),
        ws.on("squad:updated", invalidateSquads),
        ws.on("squad:deleted", () => {
          invalidateSquads();
          invalidateIssues();
        }),

        ws.on("label:created", invalidateLabelCascade),
        ws.on("label:updated", invalidateLabelCascade),
        ws.on("label:deleted", invalidateLabelCascade),

        ws.on("issue_status:changed", invalidateStatuses),

        ws.onReconnect(() => {
          invalidateSquads();
          invalidateLabels();
          invalidateStatuses();
        }),
      ];
    },
    [qc],
  );
}
