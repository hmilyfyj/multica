/**
 * Display derivations for the read-only Billing screen.
 *
 * Mirrors the pure helpers and label maps web keeps beside its billing tab
 * (`packages/views/settings/components/billing-state.ts`, `billing-tab.tsx`, and
 * `packages/views/locales/en/billing.json`). Mobile cannot import those — they
 * live under `packages/views` — so only the copy is mobile-owned; the decision
 * logic is the same.
 */
import type {
  AutopilotQuotaUsage,
  IssueLimitUsage,
  WorkspaceEntitlementLimit,
  WorkspaceSubscriptionEntitlements,
} from "@multica/core/types";

export type AutopilotUsageView =
  | { kind: "unlimited" }
  | { kind: "unavailable" }
  | {
      kind: "metered";
      used: number;
      reserved: number;
      total: number;
      limit: number;
      /** 0–100, clamped; `limit: 0` reads as a full bar. */
      progress: number;
      reached: boolean;
      resetAt: string;
    };

/**
 * Quota admission counts completed AND reserved runs, so the reserved number
 * stays visible: it is part of what the server counts when deciding whether the
 * next run is blocked. Limit mode and `reached` are server facts; this only
 * prepares presentation values.
 *
 * `unavailable` is the honest outcome for a snapshot the server could not
 * compute — every one of the seven fields has to be present, because a missing
 * `limit` rendered as 0 would read as "your quota is used up".
 */
export function resolveAutopilotUsage(
  entitlements: WorkspaceSubscriptionEntitlements,
  usage: AutopilotQuotaUsage | undefined,
  options: { failed: boolean },
): AutopilotUsageView {
  if (entitlements.limits.autopilotRuns.mode === "unlimited") {
    return { kind: "unlimited" };
  }

  if (!options.failed && usage !== undefined && usage.action !== "off") {
    const { used, reserved, total, limit, reached, reset_at: resetAt } = usage;
    if (
      used !== null &&
      reserved !== null &&
      total !== null &&
      limit !== null &&
      reached !== null &&
      resetAt !== null &&
      used >= 0 &&
      reserved >= 0 &&
      limit >= 0 &&
      Number.isFinite(used) &&
      Number.isFinite(reserved) &&
      Number.isFinite(total) &&
      Number.isFinite(limit)
    ) {
      const progress =
        limit === 0 ? 100 : Math.min(100, Math.max(0, (total / limit) * 100));

      return {
        kind: "metered",
        used,
        reserved,
        total,
        limit,
        progress,
        reached,
        resetAt,
      };
    }
  }

  return { kind: "unavailable" };
}

const NUMBER_FORMAT = new Intl.NumberFormat("en");

/**
 * Issue-count quota cell: `used / limit`, or just the cap when the usage
 * snapshot is missing or disagrees with the entitlement.
 *
 * The agreement check matters: an older snapshot carries a different cap, and
 * printing its `used` next to the entitlement's `limit` would invent a usage
 * figure for a plan the workspace is no longer on. When they disagree the
 * entitlement wins and the usage is dropped.
 */
export function formatIssueLimit(
  limit: WorkspaceEntitlementLimit,
  usage: IssueLimitUsage | null | undefined,
): string {
  if (limit.mode === "unlimited") return "Unlimited";
  if (usage && usage.limit === limit.limit) {
    return `${NUMBER_FORMAT.format(usage.used)} / ${NUMBER_FORMAT.format(usage.limit)}`;
  }
  return NUMBER_FORMAT.format(limit.limit);
}

/**
 * A server date rendered for a phone row. Returns null for a missing or
 * unparseable value so the row drops instead of printing "Invalid Date".
 */
export function formatBillingDate(
  iso: string | null | undefined,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

// Plan ids and subscription statuses are open strings on the wire: cloud adds
// them without a client release, and an unrecognised value has to read as
// unknown rather than being folded into the nearest known plan (a paying
// workspace shown as "Free" is worse than one shown as "Unknown plan").
const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
};

const STATUS_LABELS: Record<string, string> = {
  inactive: "Inactive",
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
  incomplete_expired: "Setup expired",
  paused: "Paused",
  unpaid: "Unpaid",
};

export function planLabel(plan: string): string {
  return PLAN_LABELS[plan] ?? "Unknown plan";
}

export function subscriptionStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? "Unknown status";
}

export interface BillingNotice {
  key: string;
  tone: "info" | "danger";
  title: string;
  description: string | null;
}

// Statuses whose fix is "pay attention now" rather than "for your information".
const DANGER_STATUSES: Record<string, true> = {
  past_due: true,
  incomplete: true,
  incomplete_expired: true,
  unpaid: true,
};

const STATUS_NOTICES: Record<string, { title: string; description: string }> = {
  past_due: {
    title: "Payment failed",
    description: "Update the payment method to keep this workspace active.",
  },
  incomplete: {
    title: "Subscription incomplete",
    description: "The first payment has not completed yet.",
  },
  incomplete_expired: {
    title: "Subscription expired",
    description:
      "The initial payment never completed, so this subscription can no longer be activated.",
  },
  paused: {
    title: "Subscription paused",
    description: "Billing is paused for this workspace.",
  },
  unpaid: {
    title: "Subscription unpaid",
    description: "The latest invoice is unpaid.",
  },
  canceled: {
    title: "Subscription canceled",
    description: "This workspace has no active subscription.",
  },
};

/**
 * Read-only banners for the Billing screen, most urgent first: a subscription
 * that is ending at period end, then whatever the current status demands.
 *
 * A past-due notice quotes the grace date when the server sent one, because
 * that is the date the workspace actually stops working. An unrecognised status
 * produces no notice at all — the status row above still shows the raw value.
 */
export function subscriptionNotices(input: {
  status: string;
  cancelAtPeriodEnd: boolean;
  periodEndLabel: string | null;
  graceUntilLabel: string | null;
}): BillingNotice[] {
  const notices: BillingNotice[] = [];

  if (input.cancelAtPeriodEnd) {
    notices.push({
      key: "canceling",
      tone: "info",
      title: "Subscription ending",
      description: input.periodEndLabel
        ? `Access ends on ${input.periodEndLabel}.`
        : "Access ends at the end of the current period.",
    });
  }

  const status = STATUS_NOTICES[input.status];
  if (status) {
    notices.push({
      key: `status:${input.status}`,
      tone: DANGER_STATUSES[input.status] ? "danger" : "info",
      title: status.title,
      description:
        input.status === "past_due" && input.graceUntilLabel
          ? `Access continues until ${input.graceUntilLabel}.`
          : status.description,
    });
  }

  return notices;
}

/**
 * Overcommit banner for the seats card. Purchased capacity below the human
 * member count is a real billing problem, not a display quirk: those members
 * occupy seats the workspace has not paid for.
 */
export function seatCapacityNotice(input: {
  overcommitted: boolean;
  humanMembers: number;
  purchased: number;
}): BillingNotice | null {
  if (!input.overcommitted) return null;
  return {
    key: "seats:overcommitted",
    tone: "danger",
    title: "Members exceed purchased seats",
    description: `This workspace has ${NUMBER_FORMAT.format(input.humanMembers)} members but only ${NUMBER_FORMAT.format(input.purchased)} purchased seats.`,
  };
}
