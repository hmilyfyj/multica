/**
 * Aggregations and formatting for the Usage (Analytics) screen — the mobile
 * subset of `packages/views/dashboard/utils.ts`.
 *
 * Read-only rollups: six `GET /api/dashboard/*` series, each either date-bucketed
 * or per-agent. Everything here is pure so it can be unit-tested without a
 * renderer (apps/mobile/vitest.config.ts only collects `lib/**` and `data/**`).
 *
 * Two conventions come straight from the server contract and the web page:
 *
 * 1. The date-bucketed series ship N+1 calendar days of headroom
 *    (`sinceFromDays` in server/internal/handler/runtime.go), so a page must
 *    trim them back to exactly `days` with {@link withinWindow}. The per-agent
 *    rollups are already closed at exactly `days` server-side and must NOT be
 *    trimmed — trimming them would silently widen the KPI beside the chart
 *    (see the MUL-5551 note in packages/views/dashboard/components/dashboard-page.tsx).
 * 2. In the failure rollups `failure_reason === ""` is the SUCCEEDED bucket.
 *    It moves the denominator only. Keeping successes in the same payload is
 *    what lets the error rate use one filter for numerator and denominator.
 */
import type {
  DashboardAgentRunTime,
  DashboardFailureByAgent,
  DashboardRunTimeDaily,
  DashboardUsageByAgent,
  DashboardUsageDaily,
} from "@multica/core/types";
import {
  FAILURE_CLASSES,
  failureClassOf,
  type FailureClass,
} from "@/lib/failure-class";

/** Minimum terminal runs before a failure rate is worth reading (web parity). */
export const MIN_RATE_SAMPLE = 10;

/**
 * Bucket id for agents a viewer cannot resolve to a name (hard-deleted, or the
 * server's anonymized restricted bucket). Web splits those two populations; the
 * mobile label is neutral, which is honest for both.
 */
export const UNKNOWN_AGENT_ID = "__unknown_agents__";

/** Any rollup row carrying a terminal-task count. */
export interface TaskCountRow {
  failure_reason: string;
  task_count: number;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

/**
 * Today's calendar date in `tz`, as the "YYYY-MM-DD" the rollups bucket on.
 * An unusable timezone falls back to UTC rather than throwing — the dashboard
 * should not go down over a bad preference string.
 */
export function todayIso(tz: string): string {
  try {
    return formatIsoDate(tz);
  } catch {
    return formatIsoDate("UTC");
  }
}

function formatIsoDate(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Shift a "YYYY-MM-DD" by whole days, without touching local-time parsing. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Oldest `date` a `days`-long window includes, anchored on the viewer's
 * calendar — so "7 days" means today plus the previous six, even at midnight.
 */
export function windowCutoffIso(days: number, tz: string): string {
  return addDaysIso(todayIso(tz), -(days - 1));
}

/** Trim a date-bucketed series to the window. Safe on "YYYY-MM-DD" strings. */
export function withinWindow<T extends { date: string }>(
  rows: T[],
  cutoffIso: string,
): T[] {
  return rows.filter((row) => row.date >= cutoffIso);
}

/** "2026-09-19" → "9/19", the axis/row label the dashboards use. */
export function formatDateLabel(dateIso: string): string {
  const [, m, d] = dateIso.split("-").map(Number);
  return `${m ?? 0}/${d ?? 0}`;
}

// ---------------------------------------------------------------------------
// Usage aggregations
// ---------------------------------------------------------------------------

export interface DailySeriesPoint {
  date: string;
  value: number;
}

function sumByDate<T extends { date: string }>(
  rows: T[],
  value: (row: T) => number,
): DailySeriesPoint[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.date, (map.get(row.date) ?? 0) + value(row));
  }
  return Array.from(map.entries())
    .map(([date, total]) => ({ date, value: total }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Tokens per day across all four segments. Independent of pricing, so unmapped
 * models still contribute (web `aggregateDailyTokens`).
 */
export function dailyTokenSeries(
  rows: DashboardUsageDaily[],
): DailySeriesPoint[] {
  return sumByDate(
    rows,
    (r) =>
      r.input_tokens +
      r.output_tokens +
      r.cache_read_tokens +
      r.cache_write_tokens,
  );
}

/** Run time (seconds) per day — `completed_at` buckets, same axis as web. */
export function dailyRunTimeSeries(
  rows: DashboardRunTimeDaily[],
): DailySeriesPoint[] {
  return sumByDate(rows, (r) => r.total_seconds);
}

/** Terminal runs per day. */
export function dailyRunSeries(
  rows: DashboardRunTimeDaily[],
): DailySeriesPoint[] {
  return sumByDate(rows, (r) => r.task_count);
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** All four segments added up — the KPI number. */
  tokens: number;
  /**
   * Sum of the per-(date, model) `task_count`s. The same task with tokens on two
   * days is counted twice, so this is a volume figure, not a run count — the
   * run-time rollup gives the precise one (web `computeDailyTotals`).
   */
  runs: number;
}

export function usageTotals(rows: DashboardUsageDaily[]): UsageTotals {
  const totals: UsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    runs: 0,
  };
  for (const r of rows) {
    totals.input += r.input_tokens;
    totals.output += r.output_tokens;
    totals.cacheRead += r.cache_read_tokens;
    totals.cacheWrite += r.cache_write_tokens;
    totals.runs += r.task_count;
  }
  totals.tokens =
    totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
  return totals;
}

export interface RunTimeTotals {
  seconds: number;
  runs: number;
  failed: number;
  cancelled: number;
}

export function runTimeTotals(rows: DashboardAgentRunTime[]): RunTimeTotals {
  const totals: RunTimeTotals = {
    seconds: 0,
    runs: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const r of rows) {
    totals.seconds += r.total_seconds;
    totals.runs += r.task_count;
    totals.failed += r.failed_count;
    totals.cancelled += r.cancelled_count;
  }
  return totals;
}

export interface AgentUsageRow {
  agentId: string;
  tokens: number;
  runs: number;
}

/**
 * Fold per-(agent, model) rows into one row per agent, heaviest first.
 *
 * `knownIds` is the set of agent ids the viewer can name. Rows for agents
 * outside it collapse into {@link UNKNOWN_AGENT_ID} instead of being dropped, so
 * the ranking keeps reconciling with the token KPI above it. Pass `null` while
 * the agent list is still loading to skip folding entirely — folding early would
 * merge every row into the bucket and then split it apart again.
 */
export function usageByAgent(
  rows: DashboardUsageByAgent[],
  knownIds: Set<string> | null,
): AgentUsageRow[] {
  const map = new Map<string, AgentUsageRow>();
  for (const r of rows) {
    const agentId = resolveAgentId(r.agent_id, knownIds);
    const entry = map.get(agentId) ?? { agentId, tokens: 0, runs: 0 };
    entry.tokens +=
      r.input_tokens +
      r.output_tokens +
      r.cache_read_tokens +
      r.cache_write_tokens;
    entry.runs += r.task_count;
    map.set(agentId, entry);
  }
  return Array.from(map.values()).sort(
    (a, b) => b.tokens - a.tokens || a.agentId.localeCompare(b.agentId),
  );
}

export interface AgentRunTimeRow {
  agentId: string;
  seconds: number;
  runs: number;
  failed: number;
}

/**
 * One row per agent from the run-time rollup, longest-running first. Folding
 * of unresolvable agents matches {@link usageByAgent}.
 */
export function runTimeByAgent(
  rows: DashboardAgentRunTime[],
  knownIds: Set<string> | null,
): AgentRunTimeRow[] {
  const map = new Map<string, Omit<AgentRunTimeRow, "agentId">>();
  for (const r of rows) {
    const agentId = resolveAgentId(r.agent_id, knownIds);
    const entry = map.get(agentId) ?? { seconds: 0, runs: 0, failed: 0 };
    entry.seconds += r.total_seconds;
    entry.runs += r.task_count;
    entry.failed += r.failed_count;
    map.set(agentId, entry);
  }
  return Array.from(map.entries())
    .map(([agentId, totals]) => ({ agentId, ...totals }))
    .sort(
      (a, b) => b.seconds - a.seconds || a.agentId.localeCompare(b.agentId),
    );
}

function resolveAgentId(agentId: string, knownIds: Set<string> | null): string {
  if (knownIds === null) return agentId;
  return knownIds.has(agentId) ? agentId : UNKNOWN_AGENT_ID;
}

// ---------------------------------------------------------------------------
// Failure aggregations
// ---------------------------------------------------------------------------

export interface FailureTotals {
  failed: number;
  total: number;
  /** Fraction in [0, 1]; 0 when the window has no terminal runs at all. */
  rate: number;
}

export function failureTotals(rows: TaskCountRow[]): FailureTotals {
  let failed = 0;
  let total = 0;
  for (const r of rows) {
    total += r.task_count;
    if (r.failure_reason !== "") failed += r.task_count;
  }
  return { failed, total, rate: total > 0 ? failed / total : 0 };
}

export interface FailureClassRow {
  failureClass: FailureClass;
  count: number;
}

/**
 * Window totals per display class, heaviest first, zero-count classes dropped.
 * Ties keep `FAILURE_CLASSES` order so the list does not reshuffle between
 * renders.
 */
export function failureClassRows(rows: TaskCountRow[]): FailureClassRow[] {
  const counts = emptyFailureClassCounts();
  for (const r of rows) {
    if (r.failure_reason === "") continue;
    counts[failureClassOf(r.failure_reason)] += r.task_count;
  }
  return FAILURE_CLASSES.map((failureClass) => ({
    failureClass,
    count: counts[failureClass],
  }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

function emptyFailureClassCounts(): Record<FailureClass, number> {
  return Object.fromEntries(FAILURE_CLASSES.map((c) => [c, 0])) as Record<
    FailureClass,
    number
  >;
}

export interface AgentFailureRow {
  agentId: string;
  failed: number;
  runs: number;
  rate: number;
}

/**
 * Per-agent failure totals, worst first. Agents with no failures are dropped —
 * this list is a triage aid, not a census.
 *
 * Folding of unresolvable agents matches {@link usageByAgent}.
 */
export function agentFailureRows(
  rows: DashboardFailureByAgent[],
  knownIds: Set<string> | null,
): AgentFailureRow[] {
  const map = new Map<string, { failed: number; runs: number }>();
  for (const r of rows) {
    const agentId = resolveAgentId(r.agent_id, knownIds);
    const entry = map.get(agentId) ?? { failed: 0, runs: 0 };
    entry.runs += r.task_count;
    if (r.failure_reason !== "") entry.failed += r.task_count;
    map.set(agentId, entry);
  }
  return Array.from(map.entries())
    .filter(([, v]) => v.failed > 0)
    .map(([agentId, v]) => ({
      agentId,
      failed: v.failed,
      runs: v.runs,
      rate: v.runs > 0 ? v.failed / v.runs : 0,
    }))
    .sort((a, b) => b.failed - a.failed || a.agentId.localeCompare(b.agentId));
}

/** Whether a row has enough runs for its rate to mean anything. */
export function hasRateSample(row: { runs: number }): boolean {
  return row.runs >= MIN_RATE_SAMPLE;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "1.2K" / "3.4M" / "123" — for KPI tiles and chart captions. */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Failure rate as a percentage — "12.5%", "40%", "—".
 *
 * Sub-10% rates keep a decimal: that is the band where a regression shows up
 * first, and rounding 1.4% to 1% hides half the movement. A window with no
 * terminal runs has no rate to report, so it renders a dash rather than a 0%
 * that reads as "healthy" (web `formatRate`).
 */
export function formatRate(failed: number, total: number): string {
  if (total <= 0) return "—";
  const pct = (failed / total) * 100;
  return `${pct >= 10 || pct === 0 ? Math.round(pct) : pct.toFixed(1)}%`;
}

/**
 * Compact duration: "1h 23m" / "12m 30s" / "45s" / "<1m" / "2d 5h".
 *
 * Two segments at most — three adds noise without precision a phone row can
 * use. A non-finite or sub-second total reads as "<1m": it means "no metered
 * time", not a value worth 15 characters of axis label.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return "<1m";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) {
    const secs = Math.floor(seconds) % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const h = hours % 24;
    return h > 0 ? `${days}d ${h}h` : `${days}d`;
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
