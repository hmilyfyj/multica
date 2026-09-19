import { describe, expect, it } from "vitest";
import type {
  AutopilotQuotaUsage,
  WorkspaceSubscriptionEntitlements,
} from "@multica/core/types";

import {
  formatBillingDate,
  formatIssueLimit,
  planLabel,
  resolveAutopilotUsage,
  seatCapacityNotice,
  subscriptionNotices,
  subscriptionStatusLabel,
} from "./billing-display";

const entitlements = (
  over: Partial<WorkspaceSubscriptionEntitlements> = {},
): WorkspaceSubscriptionEntitlements => ({
  workspaceId: "ws-1",
  plan: "pro",
  status: "active",
  seats: 5,
  limits: {
    issueCount: { mode: "limited", limit: 1_000 },
    autopilotRuns: { mode: "limited", limit: 100 },
  },
  currentPeriodEnd: null,
  snapshotExpiresAt: null,
  version: 1,
  ...over,
});

const quotaUsage = (
  over: Partial<AutopilotQuotaUsage> = {},
): AutopilotQuotaUsage => ({
  action: "enforce",
  used: 10,
  reserved: 2,
  total: 12,
  limit: 100,
  reached: false,
  period_start: "2026-09-01T00:00:00Z",
  period_end: "2026-10-01T00:00:00Z",
  reset_at: "2026-10-01T00:00:00Z",
  blocked_counts: null,
  ...over,
});

describe("resolveAutopilotUsage", () => {
  it("reports an unlimited plan as unlimited even before usage loads", () => {
    const view = resolveAutopilotUsage(
      entitlements({
        limits: {
          issueCount: { mode: "unlimited", limit: null },
          autopilotRuns: { mode: "unlimited", limit: null },
        },
      }),
      undefined,
      { failed: false },
    );

    expect(view).toEqual({ kind: "unlimited" });
  });

  it("reads a complete snapshot as metered, counting reserved runs in the bar", () => {
    const view = resolveAutopilotUsage(entitlements(), quotaUsage(), {
      failed: false,
    });

    expect(view).toEqual({
      kind: "metered",
      used: 10,
      reserved: 2,
      total: 12,
      limit: 100,
      progress: 12,
      reached: false,
      resetAt: "2026-10-01T00:00:00Z",
    });
  });

  it("clamps progress and treats a zero limit as a full bar", () => {
    const over = resolveAutopilotUsage(
      entitlements(),
      quotaUsage({ total: 500 }),
      { failed: false },
    );
    const zeroLimit = resolveAutopilotUsage(
      entitlements(),
      quotaUsage({ limit: 0, total: 0 }),
      { failed: false },
    );

    expect(over.kind === "metered" && over.progress).toBe(100);
    expect(zeroLimit.kind === "metered" && zeroLimit.progress).toBe(100);
  });

  it("falls back to unavailable rather than inventing a number", () => {
    // A failed request.
    expect(resolveAutopilotUsage(entitlements(), quotaUsage(), { failed: true }))
      .toEqual({ kind: "unavailable" });
    // No snapshot yet.
    expect(resolveAutopilotUsage(entitlements(), undefined, { failed: false }))
      .toEqual({ kind: "unavailable" });
    // Metering turned off server-side: the numbers would be stale.
    expect(
      resolveAutopilotUsage(entitlements(), quotaUsage({ action: "off" }), {
        failed: false,
      }),
    ).toEqual({ kind: "unavailable" });
    // A single missing field is enough — a null limit rendered as 0 reads as
    // "quota exhausted" to anyone looking at the bar.
    expect(
      resolveAutopilotUsage(entitlements(), quotaUsage({ limit: null }), {
        failed: false,
      }),
    ).toEqual({ kind: "unavailable" });
    expect(
      resolveAutopilotUsage(entitlements(), quotaUsage({ reset_at: null }), {
        failed: false,
      }),
    ).toEqual({ kind: "unavailable" });
    expect(
      resolveAutopilotUsage(entitlements(), quotaUsage({ used: -1 }), {
        failed: false,
      }),
    ).toEqual({ kind: "unavailable" });
  });
});

describe("formatIssueLimit", () => {
  it("prints usage against the cap when the snapshot agrees with the plan", () => {
    expect(
      formatIssueLimit({ mode: "limited", limit: 1_000 }, { used: 250, limit: 1_000 }),
    ).toBe("250 / 1,000");
  });

  it("drops the usage when the snapshot's cap disagrees with the entitlement", () => {
    // Otherwise the row would pair this plan's cap with a figure measured
    // against a cap the workspace is no longer on.
    expect(
      formatIssueLimit({ mode: "limited", limit: 1_000 }, { used: 250, limit: 500 }),
    ).toBe("1,000");
    expect(formatIssueLimit({ mode: "limited", limit: 1_000 }, null)).toBe("1,000");
    expect(formatIssueLimit({ mode: "limited", limit: 1_000 }, undefined)).toBe(
      "1,000",
    );
  });

  it("prints unlimited plans without a number", () => {
    expect(formatIssueLimit({ mode: "unlimited", limit: null }, null)).toBe(
      "Unlimited",
    );
  });
});

describe("planLabel / subscriptionStatusLabel", () => {
  it("names the plans it knows and refuses to guess at the rest", () => {
    expect(planLabel("free")).toBe("Free");
    expect(planLabel("pro")).toBe("Pro");
    // A plan added server-side must read as unknown rather than as Free: a
    // paying workspace shown as Free is a worse lie than an honest gap.
    expect(planLabel("enterprise_2027")).toBe("Unknown plan");
  });

  it("names every Stripe status cloud can send, with an unknown fallback", () => {
    expect(subscriptionStatusLabel("active")).toBe("Active");
    expect(subscriptionStatusLabel("past_due")).toBe("Past due");
    expect(subscriptionStatusLabel("incomplete_expired")).toBe("Setup expired");
    expect(subscriptionStatusLabel("something_new")).toBe("Unknown status");
  });
});

describe("formatBillingDate", () => {
  it("renders a date for the current year and refuses garbage", () => {
    expect(formatBillingDate("2026-07-15T12:00:00Z")).toContain("2026");
    expect(formatBillingDate(null)).toBeNull();
    expect(formatBillingDate("")).toBeNull();
    expect(formatBillingDate("not-a-date")).toBeNull();
  });
});

describe("subscriptionNotices", () => {
  it("announces an ending subscription first, with the date when the server sent one", () => {
    const notices = subscriptionNotices({
      status: "active",
      cancelAtPeriodEnd: true,
      periodEndLabel: "Oct 1, 2026",
      graceUntilLabel: null,
    });

    expect(notices).toEqual([
      {
        key: "canceling",
        tone: "info",
        title: "Subscription ending",
        description: "Access ends on Oct 1, 2026.",
      },
    ]);
  });

  it("quotes the grace date on a past-due subscription", () => {
    const notices = subscriptionNotices({
      status: "past_due",
      cancelAtPeriodEnd: false,
      periodEndLabel: null,
      graceUntilLabel: "Sep 30, 2026",
    });

    expect(notices).toEqual([
      {
        key: "status:past_due",
        tone: "danger",
        title: "Payment failed",
        description: "Access continues until Sep 30, 2026.",
      },
    ]);
  });

  it("stays silent for a healthy subscription and for a status it does not know", () => {
    expect(
      subscriptionNotices({
        status: "active",
        cancelAtPeriodEnd: false,
        periodEndLabel: "Oct 1, 2026",
        graceUntilLabel: null,
      }),
    ).toEqual([]);
    // An unknown status must not invent a notice — the status row itself still
    // shows the raw value.
    expect(
      subscriptionNotices({
        status: "paused_pending_review",
        cancelAtPeriodEnd: false,
        periodEndLabel: null,
        graceUntilLabel: null,
      }),
    ).toEqual([]);
  });
});

describe("seatCapacityNotice", () => {
  it("warns when members outnumber purchased seats", () => {
    expect(
      seatCapacityNotice({
        overcommitted: true,
        humanMembers: 1_250,
        purchased: 1_200,
      }),
    ).toEqual({
      key: "seats:overcommitted",
      tone: "danger",
      title: "Members exceed purchased seats",
      description: "This workspace has 1,250 members but only 1,200 purchased seats.",
    });
  });

  it("says nothing while the purchased capacity covers the members", () => {
    expect(
      seatCapacityNotice({
        overcommitted: false,
        humanMembers: 3,
        purchased: 5,
      }),
    ).toBeNull();
  });
});
