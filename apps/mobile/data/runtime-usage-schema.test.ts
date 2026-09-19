import { describe, expect, it } from "vitest";

import { runtimeUsageTotals } from "@/lib/runtime-display";
import { RuntimeUsageSchema, RuntimeUsageListSchema } from "./schemas";

// Wire shape from server/internal/handler/runtime.go:87-106. The provider's own
// charge rides in `cost_usd_ticks` (1e-10 USD) and the `uncosted_*` counts are
// the tokens it did not price.
const row = {
  runtime_id: "rt-1",
  date: "2026-09-18",
  provider: "claude",
  model: "claude-sonnet-4-5",
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_tokens: 50,
  cache_write_tokens: 10,
  cost_usd_ticks: 4_500_000_000,
};

describe("RuntimeUsageSchema", () => {
  it("keeps the provider-reported cost and the token counts", () => {
    const parsed = RuntimeUsageSchema.parse(row);
    expect(parsed.cost_usd_ticks).toBe(4_500_000_000);
    expect(parsed.input_tokens).toBe(1000);
    expect(parsed.model).toBe("claude-sonnet-4-5");
  });

  it("leaves the optional unpriced-token counts undefined on an older backend", () => {
    // Undefined must stay distinguishable from a real 0: the summary renders an
    // "unpriced tokens" row only when something was actually left unpriced.
    expect(RuntimeUsageSchema.parse(row).uncosted_input_tokens).toBeUndefined();
  });

  it("keeps the unpriced-token counts a newer backend sends", () => {
    const parsed = RuntimeUsageSchema.parse({
      ...row,
      uncosted_input_tokens: 25,
      uncosted_output_tokens: 5,
    });
    expect(parsed.uncosted_input_tokens).toBe(25);
    expect(parsed.uncosted_output_tokens).toBe(5);
  });

  it("defaults a list response that drifts to empty instead of throwing", () => {
    expect(RuntimeUsageListSchema.parse(undefined)).toEqual([]);
  });

  it("feeds the summary a cost and an unpriced count the screen can show", () => {
    // End-to-end: parse, then total. Either half alone can pass while the
    // usage summary still reads $0.00 on a runtime that spent money.
    const rows = RuntimeUsageListSchema.parse([
      row,
      { ...row, uncosted_input_tokens: 300 },
    ]);
    const totals = runtimeUsageTotals(rows);
    expect(totals.costUsd).toBe(0.9);
    expect(totals.unpricedTokens).toBe(300);
    expect(totals.totalTokens).toBe(2 * (1000 + 200 + 50 + 10));
    expect(totals.activeDays).toBe(1);
  });
});
