import { describe, expect, it, vi } from "vitest";

import {
  dashboardAgentRunTimeOptions,
  dashboardFailuresByAgentOptions,
  dashboardFailuresDailyOptions,
  dashboardKeys,
  dashboardRunTimeDailyOptions,
  dashboardUsageByAgentOptions,
  dashboardUsageDailyOptions,
} from "./usage";

vi.mock("@/data/api", () => ({ api: {} }));

// Each series paired with the key factory that owns it. An invalidation or a
// manual `setQueryData` written against the factory's key only reaches the
// screen if the options agree with it, so this pairing is the contract worth
// asserting — a mismatched key silently degrades to "nothing refreshes".
const SERIES = [
  { options: dashboardUsageDailyOptions, key: dashboardKeys.usageDaily },
  { options: dashboardUsageByAgentOptions, key: dashboardKeys.usageByAgent },
  { options: dashboardAgentRunTimeOptions, key: dashboardKeys.agentRunTime },
  { options: dashboardRunTimeDailyOptions, key: dashboardKeys.runTimeDaily },
  { options: dashboardFailuresDailyOptions, key: dashboardKeys.failuresDaily },
  { options: dashboardFailuresByAgentOptions, key: dashboardKeys.failuresByAgent },
] as const;

describe("dashboardKeys", () => {
  it("nests every series under one workspace prefix so a workspace switch cannot reuse another workspace's rollups", () => {
    const prefix = dashboardKeys.all("ws-1");
    const key = dashboardKeys.usageDaily("ws-1", 30, "Asia/Shanghai");

    expect(key.slice(0, prefix.length)).toEqual([...prefix]);
    expect(key).not.toEqual(dashboardKeys.usageDaily("ws-2", 30, "Asia/Shanghai"));
    expect(key).not.toEqual(dashboardKeys.usageDaily(null, 30, "Asia/Shanghai"));
  });

  it("separates the series from the window and the timezone the server buckets by", () => {
    const key = dashboardKeys.usageDaily("ws-1", 30, "Asia/Shanghai");

    // A different series must not read another series' cached rows.
    expect(key).not.toEqual(dashboardKeys.runTimeDaily("ws-1", 30, "Asia/Shanghai"));
    // A different window is a different rollup, not a client-side slice.
    expect(key).not.toEqual(dashboardKeys.usageDaily("ws-1", 7, "Asia/Shanghai"));
    // Day buckets are sliced in the viewer's calendar, so a timezone change
    // needs its own cache entry rather than re-rendering stale buckets.
    expect(key).not.toEqual(dashboardKeys.usageDaily("ws-1", 30, "UTC"));
    expect(key).not.toEqual(dashboardKeys.usageDaily("ws-1", 30, null));
  });
});

describe("dashboard query options", () => {
  it("keys every series exactly as its key factory does", () => {
    for (const { options, key } of SERIES) {
      expect(options("ws-1", 30, "UTC", true).queryKey).toEqual([
        ...key("ws-1", 30, "UTC"),
      ]);
      expect(options("ws-1", 7, null, true).queryKey).toEqual([
        ...key("ws-1", 7, null),
      ]);
    }
  });

  it("stays disabled without a workspace or outside the tab that owns the series", () => {
    for (const { options } of SERIES) {
      expect(options(null, 30, "UTC", true).enabled).toBe(false);
      expect(options("ws-1", 30, "UTC", false).enabled).toBe(false);
      expect(options("ws-1", 30, "UTC", true).enabled).toBe(true);
    }
  });
});
