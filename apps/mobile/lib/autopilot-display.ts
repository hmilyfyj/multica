/**
 * Pure display transforms for the Autopilots read-only view (FEATURE-567).
 *
 * Mobile owns its copy (no i18n infrastructure yet — see lib/time-ago.ts), so
 * every label here is the English string from
 * `packages/views/locales/en/autopilots.json`, mirrored rather than imported
 * (apps/mobile/CLAUDE.md: mobile cannot import `packages/views`).
 *
 * Every mapping keyed on a server-driven enum falls back to the RAW server
 * value instead of a blank cell: `status`, `trigger kind`, `execution_mode`,
 * run `status` / `source` and `reason_code` are all open vocabularies the
 * server may extend past this build (root CLAUDE.md "API Response
 * Compatibility"). Two exceptions are deliberate and noted inline —
 * `runNowOutcome` (a whitelist, see below) and `autopilotStatusLabel`, whose
 * closed three-value lifecycle the server itself enumerates as a Postgres
 * CHECK constraint.
 */

// --- Lifecycle / configuration labels ---

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

/** Postgres CHECK-constrained on the server (`active|paused|archived`), so an
 *  unknown value cannot occur through the API — the raw fallback is belt and
 *  braces rather than a real path. */
export function autopilotStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

const TRIGGER_KIND_LABEL: Record<string, string> = {
  schedule: "Schedule",
  webhook: "Webhook",
  api: "API",
};

export function triggerKindLabel(kind: string): string {
  return TRIGGER_KIND_LABEL[kind] ?? kind;
}

const EXECUTION_MODE_LABEL: Record<string, string> = {
  create_issue: "Create Issue",
  run_only: "Run Only",
};

export function executionModeLabel(mode: string): string {
  return EXECUTION_MODE_LABEL[mode] ?? mode;
}

/** "Schedule · Webhook · API" for the enabled trigger kinds a list row carries,
 *  or "" when the autopilot has no enabled trigger (the row renders its own
 *  empty placeholder). Deduped and ordered by first appearance so a server that
 *  repeats a kind does not render it twice. */
export function triggerKindsSummary(kinds: string[] | undefined): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const kind of kinds ?? []) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    labels.push(triggerKindLabel(kind));
  }
  return labels.join(" · ");
}

// --- Run labels ---

const RUN_STATUS_LABEL: Record<string, string> = {
  issue_created: "Issue Created",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABEL[status] ?? status;
}

/** Rendering tone for a run status. Mirrors web's `RUN_VISUAL`
 *  (packages/views/autopilots/components/autopilot-detail-page.tsx:80): a
 *  created issue and a live run are both "info", `skipped` is deliberately
 *  muted rather than red — the admission check skipping a run is not a failure
 *  ratio inflator. */
export type RunStatusTone = "info" | "running" | "success" | "failure" | "muted";

export function runStatusTone(status: string): RunStatusTone {
  switch (status) {
    case "issue_created":
      return "info";
    case "running":
      return "running";
    case "completed":
      return "success";
    case "failed":
      return "failure";
    case "skipped":
      return "muted";
    default:
      return "muted";
  }
}

const RUN_SOURCE_LABEL: Record<string, string> = {
  schedule: "Schedule",
  manual: "Manual",
  webhook: "Webhook",
  api: "API",
};

export function runSourceLabel(source: string): string {
  return RUN_SOURCE_LABEL[source] ?? source;
}

// --- "Run now" outcome ---

/**
 * Classifies a manual "run now" result. Mirrors
 * `packages/views/autopilots/components/run-now-toast.ts:runNowToastKind`:
 * success is a WHITELIST, never "anything that isn't skipped/failed".
 *
 * The run response schema accepts any status string for forward compatibility
 * (see AutopilotRunSchema), so a future or anomalous-but-parseable status
 * (e.g. "blocked", "deferred") must degrade to an error rather than claim a run
 * that was never admitted.
 */
export type RunNowOutcome = "success" | "warning" | "error";

export function runNowOutcome(status: string | undefined): RunNowOutcome {
  switch (status) {
    case "issue_created":
    case "running":
      return "success";
    case "skipped":
      // Admission blocked it — recoverable and informational, not a failure.
      return "warning";
    case "failed":
      return "error";
    default:
      return "error";
  }
}

/** Copy for a blocked / failed manual run, keyed on the stable server
 *  `reason_code` (MUL-4525). Mirrors the locale's `detail.run_blocked_*`
 *  sentences verbatim; an unknown or absent code — including the request-level
 *  failures that never produce a run at all — degrades to the generic
 *  sentence. */
const RUN_BLOCKED_MESSAGE: Record<string, string> = {
  invocation_not_allowed:
    "Not triggered — you don't have permission to use this autopilot's agent",
  runtime_offline: "Not triggered — the agent's runtime is offline",
  agent_runtime_required:
    "Not triggered — the agent has no runtime; bind one to run it",
  target_unavailable: "Not triggered — the agent is unavailable",
  attribution_blocked:
    "Not triggered — the run couldn't be attributed to a responsible member",
  already_active: "Not triggered — a recent run already covers this",
  quota_exceeded:
    "Not triggered — the run limit for this period has been reached",
  issue_limit_reached:
    "Not triggered — the workspace has reached its issue limit",
};

const RUN_BLOCKED_FALLBACK = "Not triggered — the run was blocked";

export function runNowBlockedMessage(reasonCode: string | undefined): string {
  if (!reasonCode) return RUN_BLOCKED_FALLBACK;
  return RUN_BLOCKED_MESSAGE[reasonCode] ?? RUN_BLOCKED_FALLBACK;
}

/** Success copy for a manual run (`detail.toast_triggered`). */
export const RUN_NOW_SUCCESS_MESSAGE = "Autopilot triggered";

/** Fallback for a dispatch failure the server did not classify with a
 *  `reason_code` (`detail.toast_trigger_failed`). */
export const RUN_NOW_FAILED_MESSAGE = "Failed to trigger autopilot";

// --- Time + trigger config ---

/** Placeholder for an absent timestamp. Web renders "--" in its list; the
 *  budget sheets and detail rows on mobile already use an em dash. */
export const TIME_PLACEHOLDER = "—";

/**
 * Absolute local date + time, e.g. "Sep 22, 2026, 9:00 AM".
 *
 * Divergence from web, deliberate: web formats a trigger's `next_run_at` in
 * the TRIGGER's timezone (`formatInTimeZone(next, trigger.timezone)`). Mobile
 * only has the device-local `Intl.DateTimeFormat` (the same call
 * `lib/inbox-display.ts` uses — Hermes' `timeZone` option is not reliable), so
 * the rendered instant is the viewer's local time and the trigger's configured
 * zone is shown as its own fact instead of being silently applied or ignored.
 */
export function formatAbsoluteTime(
  value: string | null | undefined,
): string {
  if (!value) return TIME_PLACEHOLDER;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return TIME_PLACEHOLDER;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** The cron line for a schedule trigger: the raw expression with its zone in
 *  parentheses, or null when the trigger carries no expression.
 *
 *  Divergence from web, deliberate: web leads with a plain-language sentence
 *  (`describeSchedule`) and falls back to the raw cron plus zone only when the
 *  expression is beyond its structured model. That describer is the schedule
 *  EDITOR's model (packages/views/autopilots/components/schedule-editor —
 *  ~650 lines of cron grammar), and the read-only view cannot import it. This
 *  is web's own fallback rendering, applied uniformly, instead of a second
 *  cron describer that could disagree with the editor. */
export function triggerScheduleLine(trigger: {
  cron_expression: string | null;
  timezone: string | null;
}): string | null {
  if (!trigger.cron_expression) return null;
  return trigger.timezone
    ? `${trigger.cron_expression} (${trigger.timezone})`
    : trigger.cron_expression;
}

/**
 * List order: most recently run first, never-run rows last (they sort as
 * oldest), ties by title — the same comparator as web's default `lastRun`
 * descending sort (packages/views/autopilots/components/autopilots-page.tsx:722).
 * Mobile v1 has no sort control, so it always uses this direction.
 */
export function sortAutopilotsByRecentRun<
  T extends { title: string; last_run_at: string | null },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const av = a.last_run_at ? Date.parse(a.last_run_at) : 0;
    const bv = b.last_run_at ? Date.parse(b.last_run_at) : 0;
    return bv - av || a.title.localeCompare(b.title);
  });
}
