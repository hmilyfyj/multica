/**
 * Per-issue agent activity for a row — the phone's counterpart of the slice
 * web's inbox row renders.
 *
 * Web keeps this in two places: the pure bucketing in
 * packages/views/issues/surface/activity.ts (`selectIssueTasks`), rendered by
 * IssueAgentActivityIndicator
 * (packages/views/issues/components/issue-agent-activity-indicator.tsx),
 * which the web inbox row mounts with `hoverCard={false}`. Mobile cannot
 * import `views/` (web/desktop runtime), so the derivation is mirrored here;
 * apps/mobile/AGENTS.md "Behavioral parity" makes the two agree a
 * requirement, so keep this in step when web changes. The rules:
 *
 *   - `running` is its own bucket.
 *   - `queued | dispatched | waiting_local_directory` share ONE "not working
 *     yet" bucket — waiting_local_directory is the daemon parked on a busy
 *     local_directory path, and it is the same user-facing state as queued.
 *   - Terminal statuses are DROPPED. The workspace snapshot also carries each
 *     agent's most recent completed/failed task
 *     (server/pkg/db/queries/agent.sql:2617, the "last activity" half), and
 *     those rows still carry an issue_id — without this filter a run that
 *     finished long ago would keep the badge lit.
 *   - Running wins over queued; nothing in either bucket renders nothing.
 */
import type { AgentTask } from "@multica/core/types";

export type AgentActivityKind = "running" | "queued";

export interface IssueAgentActivity {
  kind: AgentActivityKind;
  /** Distinct agent ids, first-seen order, capped at the stack's maximum. */
  agentIds: string[];
}

/**
 * Wording comes from web's catalog — `agent_activity.status_running` /
 * `status_queued` (packages/views/locales/<locale>/issues.json). Mobile is
 * English-only, so this is the English half of the same pair, matching what
 * the issue detail card already renders ("Working" in agent-activity-row.tsx).
 */
export const AGENT_ACTIVITY_LABEL: Record<AgentActivityKind, string> = {
  running: "Working",
  queued: "Queued",
};

/** Same cap as web's `<AgentAvatarStack max={3}>` inside this badge. */
const MAX_STACK_AVATARS = 3;

function isQueuedStatus(status: AgentTask["status"]): boolean {
  return (
    status === "queued" ||
    status === "dispatched" ||
    status === "waiting_local_directory"
  );
}

/**
 * `issueId` is the inbox item's issue: null for an item with no issue, and the
 * empty string on chat / autopilot tasks (the backend's "no issue" sentinel).
 * Both render no badge.
 */
export function deriveIssueAgentActivity(
  tasks: readonly AgentTask[],
  issueId: string | null | undefined,
): IssueAgentActivity | null {
  if (!issueId) return null;

  const running: string[] = [];
  const queued: string[] = [];

  for (const task of tasks) {
    if (task.issue_id !== issueId) continue;
    if (task.status === "running") running.push(task.agent_id);
    else if (isQueuedStatus(task.status)) queued.push(task.agent_id);
  }

  // Prefer whoever is actually working; fall back to the queue so a row shows
  // "Queued" the moment a run is enqueued.
  const primary = running.length > 0 ? running : queued;
  if (primary.length === 0) return null;

  return {
    kind: running.length > 0 ? "running" : "queued",
    agentIds: [...new Set(primary)].slice(0, MAX_STACK_AVATARS),
  };
}
