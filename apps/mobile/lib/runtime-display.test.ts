import { describe, expect, it } from "vitest";
import type { RuntimeUsage } from "@multica/core/types";
import {
  COST_USD_TICKS_PER_USD,
  formatLastSeen,
  formatTokens,
  formatUsd,
  runtimeDaemonCliVersion,
  runtimeHealthLabel,
  runtimeKindLabel,
  runtimeModeLabel,
  runtimeUsageTotals,
  runtimeUsageWindow,
  runtimeVersion,
  runtimeVisibilityLabel,
  splitDeviceInfo,
} from "@/lib/runtime-display";

function usage(over: Partial<RuntimeUsage> = {}): RuntimeUsage {
  return {
    runtime_id: "rt-1",
    date: "2026-09-01",
    provider: "claude",
    model: "claude-sonnet-4-5",
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    ...over,
  };
}

describe("labels", () => {
  it("names all four derived health states", () => {
    expect(runtimeHealthLabel("online")).toBe("Online");
    expect(runtimeHealthLabel("recently_lost")).toBe("Recently lost");
    expect(runtimeHealthLabel("offline")).toBe("Offline");
    expect(runtimeHealthLabel("long_offline")).toBe("Long offline");
  });

  it("passes an unknown health state through instead of blanking the row", () => {
    expect(runtimeHealthLabel("hibernating")).toBe("hibernating");
  });

  it("names both runtime modes", () => {
    expect(runtimeModeLabel("local")).toBe("Local");
    expect(runtimeModeLabel("cloud")).toBe("Cloud");
    expect(runtimeModeLabel("hybrid")).toBe("hybrid");
  });

  it("separates a custom-profile runtime from a built-in one", () => {
    expect(runtimeKindLabel("profile-1")).toBe("Custom");
    expect(runtimeKindLabel(null)).toBe("Built-in");
    expect(runtimeKindLabel(undefined)).toBe("Built-in");
  });
});

describe("runtimeVisibilityLabel", () => {
  it("names the runtime's own private/public axis", () => {
    // Not the agent axis: an agent is Personal/Workspace, a runtime is
    // Private/Public. The two are not interchangeable.
    expect(runtimeVisibilityLabel("private")).toBe("Private");
    expect(runtimeVisibilityLabel("public")).toBe("Public");
  });

  it("passes an unknown value through", () => {
    expect(runtimeVisibilityLabel("shared")).toBe("shared");
  });
});

describe("runtimeVersion", () => {
  it("reads the runtime's own CLI version off metadata", () => {
    expect(
      runtimeVersion({
        runtime_mode: "local",
        metadata: { version: "2.1.121 (Claude Code)" },
      }),
    ).toBe("2.1.121 (Claude Code)");
  });

  it("reports no version for a cloud runtime, which has no daemon CLI", () => {
    expect(
      runtimeVersion({
        runtime_mode: "cloud",
        metadata: { version: "2.1.121 (Claude Code)" },
      }),
    ).toBeNull();
  });

  it("treats a missing or empty version as unknown", () => {
    expect(runtimeVersion({ runtime_mode: "local", metadata: {} })).toBeNull();
    expect(
      runtimeVersion({ runtime_mode: "local", metadata: { version: "" } }),
    ).toBeNull();
    expect(
      runtimeVersion({ runtime_mode: "local", metadata: { version: 7 } }),
    ).toBeNull();
  });
});

describe("runtimeDaemonCliVersion", () => {
  it("reads the shared daemon CLI version", () => {
    expect(runtimeDaemonCliVersion({ cli_version: "0.4.10" })).toBe("0.4.10");
  });

  it("collapses the empty string core returns to null", () => {
    expect(runtimeDaemonCliVersion({})).toBeNull();
    expect(runtimeDaemonCliVersion(undefined)).toBeNull();
    expect(runtimeDaemonCliVersion({ cli_version: "" })).toBeNull();
  });
});

describe("splitDeviceInfo", () => {
  it("splits the daemon-composed string at the first separator", () => {
    expect(splitDeviceInfo("host.local · 2.1.121 (Claude Code)")).toEqual({
      hostname: "host.local",
      runtime: "2.1.121 (Claude Code)",
    });
  });

  it("handles a hostname-only device string", () => {
    expect(splitDeviceInfo("host.local")).toEqual({ hostname: "host.local" });
  });

  it("keeps a later separator inside the runtime half", () => {
    expect(splitDeviceInfo("host.local · codex · 0.118.0")).toEqual({
      hostname: "host.local",
      runtime: "codex · 0.118.0",
    });
  });
});

describe("formatLastSeen", () => {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("reports a runtime that never checked in", () => {
    expect(formatLastSeen(null)).toBe("Never");
  });

  it("collapses the last few seconds to Just now", () => {
    expect(formatLastSeen(ago(1_000))).toBe("Just now");
    expect(formatLastSeen(ago(4_000))).toBe("Just now");
  });

  it("gives seconds below a minute", () => {
    expect(formatLastSeen(ago(30_000))).toBe("30s ago");
  });

  it("keeps the second unit under an hour, so just-lost reads exactly", () => {
    // The point of this formatter: "2m 14s ago" beside "6d 19h ago" separates a
    // transient blip from an outage that needs attention.
    expect(formatLastSeen(ago(134_000))).toBe("2m 14s ago");
    expect(formatLastSeen(ago(120_000))).toBe("2m ago");
  });

  it("keeps the minute unit under a day", () => {
    expect(formatLastSeen(ago(4 * 3_600_000 + 5 * 60_000))).toBe("4h 5m ago");
    expect(formatLastSeen(ago(4 * 3_600_000))).toBe("4h ago");
  });

  it("keeps the hour unit past a day", () => {
    expect(formatLastSeen(ago(6 * 86_400_000 + 19 * 3_600_000))).toBe(
      "6d 19h ago",
    );
    expect(formatLastSeen(ago(6 * 86_400_000))).toBe("6d ago");
  });
});

describe("runtimeUsageWindow", () => {
  it("keeps the newest N calendar days when the server returns N+1", () => {
    const rows = [
      usage({ date: "2026-08-31" }),
      usage({ date: "2026-09-01" }),
      usage({ date: "2026-09-02" }),
    ];
    expect(runtimeUsageWindow(rows, 2).map((r) => r.date)).toEqual([
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("keeps every model row of a day it keeps", () => {
    const rows = [
      usage({ date: "2026-08-01", model: "a" }),
      usage({ date: "2026-09-02", model: "b" }),
      usage({ date: "2026-09-02", model: "c" }),
    ];
    expect(runtimeUsageWindow(rows, 1).map((r) => r.model)).toEqual(["b", "c"]);
  });

  it("returns the rows unchanged when the window covers them all", () => {
    expect(runtimeUsageWindow([usage({ date: "2026-09-02" })], 30)).toHaveLength(
      1,
    );
  });

  it("returns nothing for a non-positive window", () => {
    expect(runtimeUsageWindow([usage()], 0)).toEqual([]);
  });
});

describe("runtimeUsageTotals", () => {
  it("sums every token kind and derives the total from them", () => {
    const totals = runtimeUsageTotals([
      usage({
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 5,
        cache_write_tokens: 1,
      }),
      usage({ input_tokens: 50 }),
    ]);
    expect(totals.inputTokens).toBe(150);
    expect(totals.outputTokens).toBe(20);
    expect(totals.cacheReadTokens).toBe(5);
    expect(totals.cacheWriteTokens).toBe(1);
    expect(totals.totalTokens).toBe(176);
  });

  it("converts provider-reported cost from ticks, never estimating", () => {
    const totals = runtimeUsageTotals([
      usage({ cost_usd_ticks: 12 * COST_USD_TICKS_PER_USD }),
    ]);
    expect(totals.costUsd).toBe(12);
  });

  it("reports no cost when the provider priced nothing", () => {
    expect(runtimeUsageTotals([usage({ input_tokens: 900 })]).costUsd).toBe(0);
  });

  it("surfaces the tokens the provider did not price", () => {
    const totals = runtimeUsageTotals([
      usage({
        uncosted_input_tokens: 10,
        uncosted_output_tokens: 20,
        uncosted_cache_read_tokens: 30,
        uncosted_cache_write_tokens: 40,
      }),
      usage({ uncosted_input_tokens: 1 }),
    ]);
    expect(totals.unpricedTokens).toBe(101);
  });

  it("counts distinct active days, not rows", () => {
    const totals = runtimeUsageTotals([
      usage({ date: "2026-09-01" }),
      usage({ date: "2026-09-01", model: "other" }),
      usage({ date: "2026-09-02" }),
    ]);
    expect(totals.activeDays).toBe(2);
  });

  it("returns zeroed totals for an empty window", () => {
    expect(runtimeUsageTotals([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      unpricedTokens: 0,
      costUsd: 0,
      activeDays: 0,
    });
  });
});

describe("formatTokens", () => {
  it("leaves sub-thousand counts exact", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("compacts thousands and millions to one decimal", () => {
    expect(formatTokens(1_000)).toBe("1K");
    expect(formatTokens(1_234)).toBe("1.2K");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });

  it("promotes a value that rounds across a unit boundary", () => {
    expect(formatTokens(999_999)).toBe("1M");
  });
});

describe("formatUsd", () => {
  it("keeps cents below $100", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(12.345)).toBe("$12.35");
  });

  it("drops cents at $100 and above", () => {
    expect(formatUsd(100)).toBe("$100");
    expect(formatUsd(1234.56)).toBe("$1235");
  });
});
