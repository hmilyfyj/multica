/**
 * Autopilot mutations. The read-only view (FEATURE-567) offers exactly one
 * write: a manual "run now".
 *
 * Not optimistic, and it cannot be: whether the run is admitted is the
 * server's call — it answers 200 even for a blocked run and reports the
 * outcome on the run's own `status` / `reason_code` (MUL-4525) — so the caller
 * reports the returned run instead of a patched cache. There is nothing
 * sensible to patch anyway: the run row, the list row's `last_run_at` /
 * `last_run_status`, and the history all come from the server's dispatch
 * ledger.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/data/api";
import { autopilotKeys } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";

export function useTriggerAutopilot(autopilotId: string) {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: () => api.triggerAutopilot(autopilotId),
    // One manual run changes all three views: the list row's derived last-run
    // columns, the detail payload, and the run history. They all hang off the
    // `["autopilots", wsId]` prefix, so a single invalidation covers them —
    // including this autopilot's own runs, whose key the mutation does not
    // need to know. Settle, not success: a blocked run is a 200 that still
    // deserves a refresh, and a 429 must leave a consistent screen behind.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: autopilotKeys.all(wsId) });
    },
  });
}
