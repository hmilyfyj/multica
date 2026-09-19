/**
 * Billing — read-only subscription view for the current workspace.
 *
 * Mirrors the read half of web's settings → Billing tab
 * (`packages/views/settings/components/billing-tab.tsx`): current plan, seat
 * usage, entitlement quotas, and a way through to the billing portal. Nothing
 * here writes: no checkout, no seat purchase, no plan change.
 *
 * Deliberate adaptations:
 *   - The billing-portal row opens the web billing page in the system browser
 *     instead of POSTing `/api/cloud-subscriptions/portal-sessions` for a
 *     single-use Stripe URL. Creating that session is a write, and the web page
 *     it opens applies its own permission gating, so this stays honest for
 *     members who cannot act on billing.
 *   - The feature flag gates every request. With `billing_workspace_subscriptions`
 *     off, no subscription call is made at all — the screen explains why instead
 *     of showing zeroes.
 */
import { useCallback } from "react";
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG } from "@multica/core/feature-flags";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Text } from "@/components/ui/text";
import {
  appConfigOptions,
  autopilotQuotaUsageOptions,
  issueLimitUsageOptions,
  workspaceSubscriptionKeys,
  workspaceSubscriptionSummaryOptions,
} from "@/data/queries/billing";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  formatBillingDate,
  formatIssueLimit,
  planLabel,
  resolveAutopilotUsage,
  seatCapacityNotice,
  subscriptionNotices,
  subscriptionStatusLabel,
  type BillingNotice,
} from "@/lib/billing-display";
import { cn } from "@/lib/utils";

export default function BillingPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const queryClient = useQueryClient();

  const configQuery = useQuery(appConfigOptions());
  const billingEnabled =
    configQuery.data?.feature_flags?.[
      BILLING_WORKSPACE_SUBSCRIPTIONS_FLAG
    ] === true;

  const summaryQuery = useQuery(
    workspaceSubscriptionSummaryOptions(wsId, billingEnabled),
  );
  const issueLimitQuery = useQuery(issueLimitUsageOptions(wsId, billingEnabled));
  const quotaQuery = useQuery(autopilotQuotaUsageOptions(wsId, billingEnabled));

  const isRefreshing =
    configQuery.isRefetching ||
    summaryQuery.isRefetching ||
    issueLimitQuery.isRefetching ||
    quotaQuery.isRefetching;

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: workspaceSubscriptionKeys.all(wsId),
    });
    void queryClient.invalidateQueries({ queryKey: appConfigOptions().queryKey });
  }, [queryClient, wsId]);

  const retry = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: workspaceSubscriptionKeys.all(wsId),
    });
  }, [queryClient, wsId]);

  if (configQuery.isLoading || (billingEnabled && summaryQuery.isLoading)) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (!billingEnabled) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <CenteredState
          title="Billing isn't enabled here"
          description="This workspace has no subscription surface yet. If you expected one, ask a workspace owner to check the plan."
        />
      </SafeAreaView>
    );
  }

  if (summaryQuery.error) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <CenteredState
          title="Couldn't load billing"
          description="The subscription summary didn't come back. Try again in a moment."
          onRetry={retry}
        />
      </SafeAreaView>
    );
  }

  const summary = summaryQuery.data;

  if (!summary) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <CenteredState
          title="No subscription information"
          description="This workspace has no subscription record yet."
          onRetry={retry}
        />
      </SafeAreaView>
    );
  }

  const entitlements = summary.entitlement;
  const periodEnd = formatBillingDate(entitlements.currentPeriodEnd);
  const notices = subscriptionNotices({
    status: entitlements.status,
    cancelAtPeriodEnd: summary.cancelAtPeriodEnd,
    periodEndLabel: periodEnd,
    graceUntilLabel: formatBillingDate(summary.graceUntil),
  });

  const seatCapacity = summary.seatCapacity;
  const seatNotice = seatCapacity
    ? seatCapacityNotice({
        overcommitted: seatCapacity.overcommitted,
        humanMembers: summary.humanMembers,
        purchased: seatCapacity.purchased,
      })
    : null;

  const quota = resolveAutopilotUsage(entitlements, quotaQuery.data, {
    failed: quotaQuery.isError,
  });
  const quotaReset =
    quota.kind === "metered" ? formatBillingDate(quota.resetAt) : null;
  const autopilotLimit = entitlements.limits.autopilotRuns;

  const webUrl = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/+$/, "");
  const billingUrl =
    webUrl && wsSlug ? `${webUrl}/${wsSlug}/settings?tab=billing` : null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScrollView
        contentContainerClassName="gap-4 p-4"
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        {notices.map((notice) => (
          <NoticeCard key={notice.key} notice={notice} />
        ))}

        <Section
          title="Current plan"
          rows={[
            { label: "Workspace plan", value: planLabel(entitlements.plan) },
            {
              label: "Status",
              value: subscriptionStatusLabel(entitlements.status),
            },
            {
              label: "Human members",
              description:
                "Agents and pending invitations are not counted as seats.",
              value: formatCount(summary.humanMembers),
            },
            ...(summary.billingInterval
              ? [
                  {
                    label: "Billing interval",
                    value:
                      summary.billingInterval === "month"
                        ? "Monthly"
                        : "Yearly",
                  },
                ]
              : []),
            ...(periodEnd
              ? [{ label: "Current period ends", value: periodEnd }]
              : []),
          ]}
        />

        {seatCapacity ? (
          <Section
            title="Seats"
            description="Purchased seats cover current human members and pending invitations. Agents never use a seat."
            rows={[
              { label: "Used seats", value: formatCount(seatCapacity.used) },
              {
                label: "Purchased seats",
                value: formatCount(seatCapacity.purchased),
              },
              {
                label: "Pending invitations",
                description:
                  "Live invitations reserve purchased seats until accepted or expired.",
                value: formatCount(seatCapacity.reserved),
              },
              {
                label: "Available seats",
                value: formatCount(seatCapacity.available),
              },
              ...(seatCapacity.pendingQuantity !== null
                ? [
                    {
                      label: "Scheduled change",
                      description: "Takes effect next billing period.",
                      value: formatCount(seatCapacity.pendingQuantity),
                    },
                  ]
                : []),
            ]}
            footer={
              seatNotice ? <NoticeCard notice={seatNotice} /> : undefined
            }
          />
        ) : null}

        <Section
          title="Usage and limits"
          rows={[
            {
              label: "Issues",
              value: formatIssueLimit(
                entitlements.limits.issueCount,
                issueLimitQuery.data,
              ),
            },
            ...(quota.kind === "unlimited"
              ? [{ label: "Automation runs", value: "Unlimited" }]
              : quota.kind === "metered"
                ? [
                    {
                      label: "Automation runs",
                      value: `${formatCount(quota.total)} / ${formatCount(quota.limit)}`,
                      description: quotaReset
                        ? `Resets ${quotaReset}`
                        : undefined,
                      hint: `${formatCount(quota.used)} completed · ${formatCount(quota.reserved)} in progress`,
                      progress: quota.progress,
                    },
                  ]
                : [
                    {
                      label: "Automation runs",
                      value:
                        autopilotLimit.mode === "limited" &&
                        autopilotLimit.limit !== null
                          ? `${formatCount(autopilotLimit.limit)} / month`
                          : "Unavailable",
                      hint: "Usage unavailable",
                    },
                  ]),
          ]}
          footer={
            quota.kind === "unavailable" ? (
              <Button variant="outline" size="sm" onPress={retry}>
                <Text>Retry usage</Text>
              </Button>
            ) : undefined
          }
        />

        <Section
          title="Subscription management"
          description="Payment methods, invoices, and cancellation live in the web app."
          rows={[]}
          footer={
            billingUrl ? (
              <Button
                variant="outline"
                size="sm"
                onPress={() => void Linking.openURL(billingUrl)}
                accessibilityLabel="Open billing on the web"
              >
                <Text>Manage billing on web</Text>
              </Button>
            ) : (
              <Text className="text-xs text-muted-foreground">
                No web URL is configured in this build, so the billing portal
                cannot be opened from here.
              </Text>
            )
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

interface FactRowSpec {
  label: string;
  /** Secondary line under the label — what the value means, or when it resets. */
  description?: string;
  value: string;
  /** Secondary line under the value — the breakdown behind it. */
  hint?: string;
  /** 0–100; draws a quota bar under the row. */
  progress?: number;
}

/**
 * Titled card of read-only rows. Same shape as the settings screen's sections
 * (`more/settings.tsx`), so the two screens in the More menu look alike.
 *
 * `footer` holds whatever a row cannot express — a notice or an action — and
 * takes the card alone when there are no rows at all.
 */
function Section({
  title,
  description,
  rows,
  footer,
}: {
  title: string;
  description?: string;
  rows: FactRowSpec[];
  footer?: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <View className="gap-1 px-1">
        <Text className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </Text>
        {description ? (
          <Text className="text-xs text-muted-foreground">{description}</Text>
        ) : null}
      </View>
      <Card className="gap-0 px-4 py-0">
        {rows.map((row, index) => (
          <View key={row.label}>
            {index > 0 ? <Separator /> : null}
            <FactRow row={row} />
          </View>
        ))}
        {footer ? (
          <View
            className={cn(
              "gap-2 pb-3",
              rows.length > 0 && "border-t border-border pt-3",
            )}
          >
            {footer}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function FactRow({ row }: { row: FactRowSpec }) {
  return (
    <View className="gap-1.5 py-3">
      <View className="flex-row items-start justify-between gap-4">
        <View className="flex-1 gap-0.5">
          <Text className="text-sm text-foreground">{row.label}</Text>
          {row.description ? (
            <Text className="text-xs text-muted-foreground">
              {row.description}
            </Text>
          ) : null}
        </View>
        <View className="items-end gap-0.5">
          <Text className="text-sm tabular-nums text-foreground">
            {row.value}
          </Text>
          {row.hint ? (
            <Text className="text-xs text-muted-foreground">{row.hint}</Text>
          ) : null}
        </View>
      </View>
      {row.progress !== undefined ? (
        <View className="h-1.5 overflow-hidden rounded-full bg-muted">
          <View
            className="h-1.5 rounded-full bg-primary"
            style={{ width: `${clampPercent(row.progress)}%` }}
          />
        </View>
      ) : null}
    </View>
  );
}

function NoticeCard({ notice }: { notice: BillingNotice }) {
  return (
    <Card
      className={cn(
        "gap-0.5",
        notice.tone === "danger"
          ? "border-destructive/40 bg-destructive/10"
          : "bg-muted",
      )}
    >
      <Text className="text-sm font-medium text-foreground">{notice.title}</Text>
      {notice.description ? (
        <Text className="text-xs text-muted-foreground">
          {notice.description}
        </Text>
      ) : null}
    </Card>
  );
}

function CenteredState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <Text className="text-center text-base font-medium text-foreground">
        {title}
      </Text>
      <Text className="text-center text-sm text-muted-foreground">
        {description}
      </Text>
      {onRetry ? (
        <Button variant="outline" size="sm" onPress={onRetry}>
          <Text>Try again</Text>
        </Button>
      ) : null}
    </View>
  );
}

const COUNT_FORMAT = new Intl.NumberFormat("en");

function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
