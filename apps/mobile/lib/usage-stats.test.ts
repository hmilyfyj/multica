import { describe, expect, it } from "vitest";
import type {
  DashboardAgentRunTime,
  DashboardFailureByAgent,
  DashboardFailureDaily,
  DashboardRunTimeDaily,
  DashboardUsageByAgent,
  DashboardUsageDaily,
} from "@multica/core/types";

import { FAILURE_CLASS_LABEL } from "./failure-class";
import {
  addDaysIso,
  agentFailureRows,
  dailyRunSeries,
  dailyRunTimeSeries,
  dailyTokenSeries,
  failureClassRows,
  failureTotals,
  formatCompactNumber,
  formatDateLabel,
  formatDuration,
  formatRate,
  hasRateSample,
  MIN_RATE_SAMPLE,
  runTimeByAgent,
  runTimeTotals,
  todayIso,
  UNKNOWN_AGENT_ID,
  usageByAgent,
  usageTotals,
  windowCutoffIso,
  withinWindow,
} from "./usage-stats";

const usageRow = (over: Partial<DashboardUsageDaily>): DashboardUsageDaily => ({
  date: "2026-09-01",
  provider: "anthropic",
  model: "claude",
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  task_count: 0,
  ...over,
});

const usageByAgentRow = (
  over: Partial<DashboardUsageByAgent>,
): DashboardUsageByAgent => ({
  agent_id: "agent-1",
  provider: "anthropic",
  model: "claude",
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  task_count: 0,
  ...over,
});

const runTimeDailyRow = (
  over: Partial<DashboardRunTimeDaily>,
): DashboardRunTimeDaily => ({
  date: "2026-09-01",
  total_seconds: 0,
  task_count: 0,
  failed_count: 0,
  cancelled_count: 0,
  ...over,
});

const agentRunTimeRow = (
  over: Partial<DashboardAgentRunTime>,
): DashboardAgentRunTime => ({
  agent_id: "agent-1",
  total_seconds: 0,
  task_count: 0,
  failed_count: 0,
  cancelled_count: 0,
  ...over,
});

const failureDailyRow = (
  over: Partial<DashboardFailureDaily>,
): DashboardFailureDaily => ({
  date: "2026-09-01",
  failure_reason: "",
  task_count: 0,
  ...over,
});

const failureByAgentRow = (
  over: Partial<DashboardFailureByAgent>,
): DashboardFailureByAgent => ({
  agent_id: "agent-1",
  failure_reason: "",
  task_count: 0,
  ...over,
});

describe("window helpers", () => {
  it("formats today in the viewer's calendar and falls back to UTC on a bad timezone", () => {
    const utcToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    expect(todayIso("UTC")).toBe(utcToday);
    expect(todayIso("UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A stored preference reaches us unvalidated; Intl throws on a string it
    // does not recognise, and a dashboard header is not worth taking the
    // screen down for.
    expect(todayIso("Not/AZone")).toBe(utcToday);
  });

  it("shifts calendar days across month and year boundaries", () => {
    expect(addDaysIso("2026-09-01", -1)).toBe("2026-08-31");
    expect(addDaysIso("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2026-09-19", 0)).toBe("2026-09-19");
  });

  it("starts a 1-day window at today and an N-day window N-1 days back", () => {
    const today = todayIso("UTC");

    expect(windowCutoffIso(1, "UTC")).toBe(today);
    expect(windowCutoffIso(7, "UTC")).toBe(addDaysIso(today, -6));
    expect(windowCutoffIso(30, "UTC")).toBe(addDaysIso(today, -29));
  });

  it("trims the server's N+1 headroom without dropping the window's first day", () => {
    const rows = [
      { date: "2026-09-18" },
      { date: "2026-09-19" },
      { date: "2026-09-20" },
    ];

    expect(withinWindow(rows, "2026-09-19").map((r) => r.date)).toEqual([
      "2026-09-19",
      "2026-09-20",
    ]);
  });

  it("labels a bucket the way the chart axis reads it", () => {
    expect(formatDateLabel("2026-09-19")).toBe("9/19");
    expect(formatDateLabel("2026-01-05")).toBe("1/5");
  });
});

describe("daily series", () => {
  it("sums every token segment per day and orders the axis oldest first", () => {
    const series = dailyTokenSeries([
      usageRow({
        date: "2026-09-02",
        input_tokens: 10,
        output_tokens: 1,
        cache_read_tokens: 100,
        cache_write_tokens: 1000,
      }),
      usageRow({ date: "2026-09-01", input_tokens: 5, output_tokens: 5 }),
      // A second model on the same day must add into the same bucket.
      usageRow({ date: "2026-09-01", model: "gpt", input_tokens: 1_000 }),
    ]);

    expect(series).toEqual([
      { date: "2026-09-01", value: 1_010 },
      { date: "2026-09-02", value: 1_111 },
    ]);
  });

  it("reads run time and run counts from the run-time rollup", () => {
    const rows = [
      runTimeDailyRow({ date: "2026-09-02", total_seconds: 30, task_count: 2 }),
      runTimeDailyRow({ date: "2026-09-01", total_seconds: 90, task_count: 3 }),
    ];

    expect(dailyRunTimeSeries(rows)).toEqual([
      { date: "2026-09-01", value: 90 },
      { date: "2026-09-02", value: 30 },
    ]);
    expect(dailyRunSeries(rows)).toEqual([
      { date: "2026-09-01", value: 3 },
      { date: "2026-09-02", value: 2 },
    ]);
  });
});

describe("usageTotals", () => {
  it("splits the token segments and keeps task_count a volume figure", () => {
    const totals = usageTotals([
      usageRow({ input_tokens: 10, output_tokens: 2, task_count: 1 }),
      usageRow({
        model: "gpt",
        cache_read_tokens: 3,
        cache_write_tokens: 4,
        task_count: 1,
      }),
    ]);

    expect(totals).toEqual({
      input: 10,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      tokens: 19,
      runs: 2,
    });
  });

  it("is all zeroes for an empty window", () => {
    expect(usageTotals([]).tokens).toBe(0);
    expect(usageTotals([]).runs).toBe(0);
  });
});

describe("runTimeTotals", () => {
  it("sums seconds and terminal outcomes across agents", () => {
    const totals = runTimeTotals([
      agentRunTimeRow({
        total_seconds: 120,
        task_count: 4,
        failed_count: 1,
        cancelled_count: 2,
      }),
      agentRunTimeRow({
        agent_id: "agent-2",
        total_seconds: 60,
        task_count: 2,
        failed_count: 2,
      }),
    ]);

    expect(totals).toEqual({
      seconds: 180,
      runs: 6,
      failed: 3,
      cancelled: 2,
    });
  });
});

describe("usageByAgent", () => {
  it("folds a heavy spender's models into one row and ranks by tokens", () => {
    const rows = usageByAgent(
      [
        usageByAgentRow({ agent_id: "agent-1", input_tokens: 10 }),
        usageByAgentRow({ agent_id: "agent-1", model: "gpt", output_tokens: 5 }),
        usageByAgentRow({ agent_id: "agent-2", cache_read_tokens: 100 }),
      ],
      new Set(["agent-1", "agent-2"]),
    );

    expect(rows).toEqual([
      { agentId: "agent-2", tokens: 100, runs: 0 },
      { agentId: "agent-1", tokens: 15, runs: 0 },
    ]);
  });

  it("folds agents the viewer cannot name instead of dropping their spend", () => {
    const rows = usageByAgent(
      [
        usageByAgentRow({ agent_id: "deleted-1", input_tokens: 30 }),
        usageByAgentRow({ agent_id: "deleted-2", input_tokens: 20 }),
        usageByAgentRow({ agent_id: "agent-1", input_tokens: 10 }),
      ],
      new Set(["agent-1"]),
    );

    expect(rows).toEqual([
      { agentId: UNKNOWN_AGENT_ID, tokens: 50, runs: 0 },
      { agentId: "agent-1", tokens: 10, runs: 0 },
    ]);
    // The ranking has to keep reconciling with the token KPI above it.
    expect(rows.reduce((sum, r) => sum + r.tokens, 0)).toBe(60);
  });

  it("skips folding while the agent list is still loading", () => {
    const rows = usageByAgent(
      [
        usageByAgentRow({ agent_id: "deleted-1", input_tokens: 30 }),
        usageByAgentRow({ agent_id: "agent-1", input_tokens: 10 }),
      ],
      null,
    );

    expect(rows.map((r) => r.agentId)).toEqual(["deleted-1", "agent-1"]);
  });
});

describe("runTimeByAgent", () => {
  it("ranks agents by metered seconds and folds the ones it cannot name", () => {
    const rows = runTimeByAgent(
      [
        agentRunTimeRow({
          agent_id: "agent-1",
          total_seconds: 90,
          task_count: 3,
          failed_count: 1,
        }),
        agentRunTimeRow({
          agent_id: "agent-2",
          total_seconds: 200,
          task_count: 4,
        }),
        agentRunTimeRow({ agent_id: "gone-1", total_seconds: 10, task_count: 1 }),
      ],
      new Set(["agent-1", "agent-2"]),
    );

    expect(rows).toEqual([
      { agentId: "agent-2", seconds: 200, runs: 4, failed: 0 },
      { agentId: "agent-1", seconds: 90, runs: 3, failed: 1 },
      { agentId: UNKNOWN_AGENT_ID, seconds: 10, runs: 1, failed: 0 },
    ]);
  });
});

describe("failureTotals", () => {
  it("counts the succeeded bucket in the denominator only", () => {
    const totals = failureTotals([
      failureDailyRow({ failure_reason: "", task_count: 90 }),
      failureDailyRow({ failure_reason: "timeout", task_count: 10 }),
    ]);

    expect(totals).toEqual({ failed: 10, total: 100, rate: 0.1 });
  });

  it("reports no rate for a window with no terminal runs", () => {
    expect(failureTotals([])).toEqual({ failed: 0, total: 0, rate: 0 });
  });
});

describe("failureClassRows", () => {
  it("herds reasons into their classes, heaviest first, and never counts the succeeded bucket", () => {
    const rows = failureClassRows([
      failureDailyRow({ failure_reason: "", task_count: 500 }),
      failureDailyRow({ failure_reason: "agent_error.agent_timeout", task_count: 4 }),
      failureDailyRow({ failure_reason: "agent_error.provider_network", task_count: 7 }),
      failureDailyRow({ failure_reason: "a_reason_from_the_future", task_count: 1 }),
    ]);

    expect(rows).toEqual([
      { failureClass: "provider", count: 7 },
      { failureClass: "timeout", count: 4 },
      { failureClass: "other", count: 1 },
    ]);
    expect(rows.every((r) => FAILURE_CLASS_LABEL[r.failureClass])).toBe(true);
  });

  it("keeps the canonical class order when counts tie", () => {
    const rows = failureClassRows([
      failureDailyRow({ failure_reason: "manual", task_count: 2 }),
      failureDailyRow({ failure_reason: "runtime_offline", task_count: 2 }),
      failureDailyRow({ failure_reason: "timeout", task_count: 2 }),
    ]);

    // FAILURE_CLASSES order is auth, rate_limit, timeout, provider, runtime,
    // agent, other — so a three-way tie reads timeout / runtime / other.
    expect(rows.map((r) => r.failureClass)).toEqual([
      "timeout",
      "runtime",
      "other",
    ]);
  });

  it("drops classes with no failures so the list stays proportional", () => {
    const rows = failureClassRows([
      failureDailyRow({
        failure_reason: "agent_error.missing_config",
        task_count: 1,
      }),
    ]);

    expect(rows).toEqual([{ failureClass: "auth", count: 1 }]);
  });
});

describe("agentFailureRows", () => {
  it("ranks agents by failed runs and carries each one's rate", () => {
    const rows = agentFailureRows(
      [
        failureByAgentRow({ agent_id: "agent-1", failure_reason: "", task_count: 8 }),
        failureByAgentRow({ agent_id: "agent-1", failure_reason: "timeout", task_count: 2 }),
        failureByAgentRow({ agent_id: "agent-2", failure_reason: "timeout", task_count: 5 }),
        failureByAgentRow({ agent_id: "agent-2", failure_reason: "", task_count: 5 }),
      ],
      new Set(["agent-1", "agent-2"]),
    );

    expect(rows).toEqual([
      { agentId: "agent-2", failed: 5, runs: 10, rate: 0.5 },
      { agentId: "agent-1", failed: 2, runs: 10, rate: 0.2 },
    ]);
  });

  it("drops agents that never failed and folds the ones it cannot name", () => {
    const rows = agentFailureRows(
      [
        failureByAgentRow({ agent_id: "agent-1", failure_reason: "", task_count: 40 }),
        failureByAgentRow({ agent_id: "gone-1", failure_reason: "timeout", task_count: 3 }),
        failureByAgentRow({ agent_id: "gone-2", failure_reason: "timeout", task_count: 4 }),
      ],
      new Set(["agent-1"]),
    );

    expect(rows).toEqual([
      { agentId: UNKNOWN_AGENT_ID, failed: 7, runs: 7, rate: 1 },
    ]);
  });

  it("marks a rate as meaningless below the sample floor", () => {
    expect(hasRateSample({ runs: MIN_RATE_SAMPLE - 1 })).toBe(false);
    expect(hasRateSample({ runs: MIN_RATE_SAMPLE })).toBe(true);
  });
});

describe("formatting", () => {
  it("compacts large counts and refuses to render a non-finite one", () => {
    expect(formatCompactNumber(0)).toBe("0");
    expect(formatCompactNumber(999)).toBe("999");
    expect(formatCompactNumber(1_000)).toBe("1K");
    expect(formatCompactNumber(1_500)).toBe("1.5K");
    expect(formatCompactNumber(1_234_567)).toBe("1.2M");
    expect(formatCompactNumber(Number.NaN)).toBe("—");
  });

  it("keeps a decimal on sub-10% rates and dashes a window with no runs", () => {
    expect(formatRate(0, 0)).toBe("—");
    expect(formatRate(0, 5)).toBe("0%");
    expect(formatRate(1, 1000)).toBe("0.1%");
    expect(formatRate(1, 100)).toBe("1.0%");
    expect(formatRate(1, 8)).toBe("13%");
    expect(formatRate(1, 5)).toBe("20%");
  });

  it("renders a duration in at most two segments", () => {
    expect(formatDuration(0)).toBe("<1m");
    expect(formatDuration(0.5)).toBe("<1m");
    expect(formatDuration(-5)).toBe("<1m");
    expect(formatDuration(Number.NaN)).toBe("<1m");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3_600)).toBe("1h");
    expect(formatDuration(4_980)).toBe("1h 23m");
    expect(formatDuration(2 * 86_400 + 5 * 3_600)).toBe("2d 5h");
    expect(formatDuration(2 * 86_400)).toBe("2d");
  });
});
