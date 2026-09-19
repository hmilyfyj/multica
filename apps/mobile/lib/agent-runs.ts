/**
 * Pure helpers for the Agents read-only views (list + detail).
 *
 * Everything here is mapping/derivation only — no React, no network. The
 * screens are assembly; the logic that can be wrong (task bucketing, run
 * durations, list ordering) lives here so the node-environment Vitest setup
 * (`apps/mobile/vitest.config.ts` collects `lib/**` and `data/**` only) can
 * cover it.
 *
 * Parity: bucketing mirrors the issue Runs sheet
 * (`app/(app)/[workspace]/issue/[id]/runs.tsx`) — one shared definition of
 * "active" keeps the two surfaces from disagreeing about the same task.
 * Duration formatting reuses `formatElapsedMs`, the web/mobile shared reader.
 */
import type { AgentTask } from "@multica/core/types";
import { formatElapsedMs } from "@/lib/format-elapsed";

// Non-terminal task states. `waiting_local_directory` is the daemon's
// parked-while-another-task-owns-the-path hold — active, not done, and the
// backend documents it as such (packages/core/types/agent.ts AgentTask.status).
const ACTIVE_TASK_STATUSES: readonly AgentTask["status"][] = [
  "queued",
  "dispatched",
  "waiting_local_directory",
  "running",
];

export function isActiveTask(task: AgentTask): boolean {
  return ACTIVE_TASK_STATUSES.includes(task.status);
}

// Past-section ordering: what needs attention first, then chronology. Same
// rank the issue Runs sheet uses (`issue/[id]/runs.tsx` PAST_STATUS_ORDER).
const PAST_STATUS_ORDER: Record<AgentTask["status"], number> = {
  failed: 0,
  cancelled: 1,
  completed: 2,
  queued: 99,
  dispatched: 99,
  waiting_local_directory: 99,
  running: 99,
};

function compareDesc(a: string | null | undefined, b: string | null | undefined) {
  // Missing timestamps sort last rather than crashing the comparator.
  return (b ?? "").localeCompare(a ?? "");
}

/**
 * Buckets a task list into the two sections both agent surfaces render.
 * Active: newest trigger first (created_at desc). Past: completed_at desc,
 * with the status rank as tiebreaker so a task that never got a
 * completed_at still lands somewhere stable.
 */
export function splitAgentTasks(tasks: readonly AgentTask[]): {
  active: AgentTask[];
  past: AgentTask[];
} {
  const active: AgentTask[] = [];
  const past: AgentTask[] = [];
  for (const task of tasks) {
    if (isActiveTask(task)) active.push(task);
    else past.push(task);
  }
  active.sort((a, b) => compareDesc(a.created_at, b.created_at));
  past.sort((a, b) => {
    const byTime = compareDesc(a.completed_at, b.completed_at);
    if (byTime !== 0) return byTime;
    return PAST_STATUS_ORDER[a.status] - PAST_STATUS_ORDER[b.status];
  });
  return { active, past };
}

/**
 * Most recent activity timestamp for a task list — the agent's "last active"
 * line. Reads `completed_at ?? created_at`, so a running task counts as
 * activity now and a finished one counts at its completion. Returns null when
 * the agent has no visible task history (rendered as "No activity").
 *
 * ISO-8601 UTC strings compare lexicographically, so max() is a string fold.
 */
export function latestActivityAt(
  tasks: readonly AgentTask[],
): string | null {
  let latest: string | null = null;
  for (const task of tasks) {
    const at = task.completed_at || task.created_at;
    if (!at) continue;
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

/**
 * Wall-clock duration of one task:
 *   terminal → completed_at - (started_at ?? created_at)
 *   active   → now - (started_at ?? created_at)
 *
 * `undefined` means "not knowable, don't show a number": no usable start
 * timestamp, unparseable timestamps, or a terminal task the daemon never
 * stamped with completed_at (fabricating `now` there would render a finished
 * run as still growing).
 */
export function runDurationMs(
  task: AgentTask,
  now: number,
): number | undefined {
  const start = task.started_at || task.created_at;
  if (!start) return undefined;
  const startMs = Date.parse(start);
  if (Number.isNaN(startMs)) return undefined;

  let endMs = now;
  if (!isActiveTask(task)) {
    if (!task.completed_at) return undefined;
    endMs = Date.parse(task.completed_at);
    if (Number.isNaN(endMs)) return undefined;
  }
  return Math.max(0, endMs - startMs);
}

/** Same as `runDurationMs`, rendered with the shared elapsed formatter. */
export function runDurationLabel(
  task: AgentTask,
  now: number,
): string | undefined {
  const ms = runDurationMs(task, now);
  return ms === undefined ? undefined : formatElapsedMs(ms);
}

interface AgentActivityRow {
  name: string;
  lastActivityAt: string | null;
}

/**
 * Agents-list ordering: most recent activity first, then agents that have
 * never run (no timestamp = oldest), name ascending inside each group.
 * Mirrors web's default "Recent activity" sort direction; the mobile list has
 * no sort control in v1, so this is the only order.
 */
export function sortByRecentActivity<T extends AgentActivityRow>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.lastActivityAt !== b.lastActivityAt) {
      if (a.lastActivityAt === null) return 1;
      if (b.lastActivityAt === null) return -1;
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    }
    return a.name.localeCompare(b.name);
  });
}
