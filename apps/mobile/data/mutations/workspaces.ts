/**
 * Workspace mutations — only what the mobile settings screen writes.
 *
 * `PATCH /api/workspaces/{id}` sits in the owner|admin group in
 * server/cmd/server/router.go, and the screen gates its inputs on the same
 * rule, so a plain member never reaches the 403.
 *
 * The returned Workspace replaces the row in the workspace list cache: that
 * cache is the settings screen's own source of truth (`workspaceListOptions`),
 * so without the patch the form would keep rendering the values it just saved.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Workspace } from "@multica/core/types";
import { api, type UpdateWorkspaceRequest } from "@/data/api";
import { issueKeys } from "@/data/queries/issue-keys";
import { workspaceListOptions } from "@/data/queries/workspaces";

export function useUpdateWorkspace() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateWorkspaceRequest }) =>
      api.updateWorkspace(id, body),
    onSuccess: (workspace, { body }) => {
      qc.setQueryData<Workspace[]>(
        workspaceListOptions().queryKey,
        (old) => old?.map((ws) => (ws.id === workspace.id ? workspace : ws)),
      );
      // Issue identifiers are computed from the prefix at READ time, so every
      // cached issue is stale the moment it changes. Callers only send
      // `issue_prefix` when it actually changed, which is what keeps this from
      // firing on an ordinary name edit — same contract as web's
      // `performPrefixSave` (workspace-tab.tsx).
      if (body.issue_prefix !== undefined) {
        qc.invalidateQueries({ queryKey: issueKeys.all(workspace.id) });
      }
    },
  });
}
