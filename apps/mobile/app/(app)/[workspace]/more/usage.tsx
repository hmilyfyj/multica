/**
 * Usage / Errors — read-only workspace analytics for a phone.
 *
 * Mirrors the two tabs of web's `/{slug}/usage` (`packages/views/dashboard`)
 * over six dashboard rollups:
 *
 *   Usage   tokens / run time / runs, by day and by agent
 *   Errors  failure rate, the seven failure classes, and the agents failing most
 *
 * Adaptation to mobile (deliberate, and the parity claim in the delivery note):
 *   - No **Cost** metric. Web computes it client-side from the runtimes pricing
 *     table plus a user-editable custom-pricing store; mobile ships neither, and
 *     a phone is the wrong place to start maintaining a second pricing table.
 *   - Range is 7 / 30 / 90 days (web also offers 1d and 180d) and the grain is
 *     always daily — a weekly bucket needs an axis a phone cannot label.
 *   - No project filter, no error-code drill-down, no CSV: all three need a
 *     second-level surface the phone does not have yet.
 *   - The six rollups are fetched per tab instead of all up front. Same keys and
 *     same semantics, but a phone should not pull three series the reader cannot
 *     see yet.
 *
 * Window handling is the subtle part and follows web exactly: the date-bucketed
 * series arrive with N+1 days of headroom and are trimmed client-side to `days`,
 * while the per-agent rollups are already closed at exactly `days` server-side
 * and must not be trimmed again (MUL-5551).
 */
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { DailyBarChart } from "@/components/usage/daily-bar-chart";
import { ShareRow } from "@/components/usage/share-row";
import { StatTile, StatTileRow } from "@/components/usage/stat-tile";
import { agentListOptions } from "@/data/queries/agents";
import {
  dashboardAgentRunTimeOptions,
  dashboardFailuresByAgentOptions,
  dashboardFailuresDailyOptions,
  dashboardKeys,
  dashboardRunTimeDailyOptions,
  dashboardUsageByAgentOptions,
  dashboardUsageDailyOptions,
} from "@/data/queries/usage";
import { useWorkspaceStore } from "@/data/workspace-store";
import { FAILURE_CLASS_LABEL } from "@/lib/failure-class";
import {
  agentFailureRows,
  dailyRunSeries,
  dailyRunTimeSeries,
  dailyTokenSeries,
  failureClassRows,
  failureTotals,
  formatCompactNumber,
  formatDuration,
  formatRate,
  hasRateSample,
  MIN_RATE_SAMPLE,
  runTimeByAgent,
  runTimeTotals,
  UNKNOWN_AGENT_ID,
  usageByAgent,
  usageTotals,
  windowCutoffIso,
  withinWindow,
} from "@/lib/usage-stats";
import { useViewingTimezone } from "@/lib/use-viewing-timezone";

const RANGES = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
] as const;
type Range = (typeof RANGES)[number]["value"];

const TABS = [
  { value: "usage", label: "Usage" },
  { value: "errors", label: "Errors" },
] as const;
type Tab = (typeof TABS)[number]["value"];

const METRICS = [
  { value: "tokens", label: "Tokens", title: "Daily tokens" },
  { value: "time", label: "Time", title: "Daily run time" },
  { value: "runs", label: "Runs", title: "Daily runs" },
] as const;
type Metric = (typeof METRICS)[number]["value"];

/** How many ranking rows fit before the card stops being a summary. Web shows
 *  ten with a "show all" expander; mobile just caps it. */
const RANKING_LIMIT = 10;

export default function UsagePage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const tz = useViewingTimezone();
  const queryClient = useQueryClient();

  const [days, setDays] = useState<Range>(30);
  const [tab, setTab] = useState<Tab>("usage");
  const [metric, setMetric] = useState<Metric>("tokens");
  const usageTab = tab === "usage";

  const usageDailyQuery = useQuery(
    dashboardUsageDailyOptions(wsId, days, tz, usageTab),
  );
  const byAgentQuery = useQuery(
    dashboardUsageByAgentOptions(wsId, days, tz, usageTab),
  );
  const agentRunTimeQuery = useQuery(
    dashboardAgentRunTimeOptions(wsId, days, tz, usageTab),
  );
  const runTimeDailyQuery = useQuery(
    dashboardRunTimeDailyOptions(wsId, days, tz, usageTab),
  );
  const failuresDailyQuery = useQuery(
    dashboardFailuresDailyOptions(wsId, days, tz, !usageTab),
  );
  const failuresByAgentQuery = useQuery(
    dashboardFailuresByAgentOptions(wsId, days, tz, !usageTab),
  );

  // Names for the two per-agent rankings. The list is already cached for the
  // agents screen, and it doubles as the "can this viewer name the agent"
  // membership test the aggregations fold unresolvable rows by.
  const agentsQuery = useQuery(agentListOptions(wsId));

  const isRefreshing = usageTab
    ? usageDailyQuery.isRefetching ||
      byAgentQuery.isRefetching ||
      agentRunTimeQuery.isRefetching ||
      runTimeDailyQuery.isRefetching
    : failuresDailyQuery.isRefetching || failuresByAgentQuery.isRefetching;

  const onRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all(wsId) });
  }, [queryClient, wsId]);

  // The server buckets days in the viewer's timezone; when the client has none
  // it sends no `tz` and the server falls back to the same chain ending at UTC,
  // which is what this cutoff has to match or the window would slice differently
  // from the buckets it trims.
  const cutoff = useMemo(() => windowCutoffIso(days, tz ?? "UTC"), [days, tz]);

  const usageDaily = usageDailyQuery.data;
  const runTimeDaily = runTimeDailyQuery.data;
  const failuresDaily = failuresDailyQuery.data;

  // Date-bucketed series: trim the server's N+1 headroom back to `days`.
  const usageInWindow = useMemo(
    () => withinWindow(usageDaily ?? [], cutoff),
    [usageDaily, cutoff],
  );
  const runTimeDailyInWindow = useMemo(
    () => withinWindow(runTimeDaily ?? [], cutoff),
    [runTimeDaily, cutoff],
  );
  const failuresInWindow = useMemo(
    () => withinWindow(failuresDaily ?? [], cutoff),
    [failuresDaily, cutoff],
  );

  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentsQuery.data ?? []) map.set(agent.id, agent.name);
    return map;
  }, [agentsQuery.data]);
  // `null` until the roster resolves, so rows are not folded into one bucket and
  // then split apart again a moment later.
  const knownAgentIds = useMemo(
    () => (agentsQuery.isSuccess ? new Set(agentNames.keys()) : null),
    [agentsQuery.isSuccess, agentNames],
  );
  const nameOf = useCallback(
    (agentId: string) =>
      agentId === UNKNOWN_AGENT_ID
        ? "Unknown agents"
        : (agentNames.get(agentId) ?? "Unknown agent"),
    [agentNames],
  );
  const openAgent = useCallback(
    (agentId: string) => {
      if (!wsSlug || agentId === UNKNOWN_AGENT_ID) return;
      router.push(`/${wsSlug}/more/agents/${agentId}`);
    },
    [wsSlug],
  );

  const tokenPoints = useMemo(
    () => dailyTokenSeries(usageInWindow),
    [usageInWindow],
  );
  const timePoints = useMemo(
    () => dailyRunTimeSeries(runTimeDailyInWindow),
    [runTimeDailyInWindow],
  );
  const runsPoints = useMemo(
    () => dailyRunSeries(runTimeDailyInWindow),
    [runTimeDailyInWindow],
  );

  const tokens = useMemo(() => usageTotals(usageInWindow), [usageInWindow]);
  const runTime = useMemo(
    () => runTimeTotals(agentRunTimeQuery.data ?? []),
    [agentRunTimeQuery.data],
  );

  const agentUsageRows = useMemo(
    () => usageByAgent(byAgentQuery.data ?? [], knownAgentIds),
    [byAgentQuery.data, knownAgentIds],
  );
  const agentRunRows = useMemo(
    () => runTimeByAgent(agentRunTimeQuery.data ?? [], knownAgentIds),
    [agentRunTimeQuery.data, knownAgentIds],
  );

  const failures = useMemo(
    () => failureTotals(failuresInWindow),
    [failuresInWindow],
  );
  const failureClasses = useMemo(
    () => failureClassRows(failuresInWindow),
    [failuresInWindow],
  );
  const offenders = useMemo(
    () => agentFailureRows(failuresByAgentQuery.data ?? [], knownAgentIds),
    [failuresByAgentQuery.data, knownAgentIds],
  );

  const isLoading = usageTab
    ? usageDailyQuery.isLoading ||
      byAgentQuery.isLoading ||
      agentRunTimeQuery.isLoading ||
      runTimeDailyQuery.isLoading
    : failuresDailyQuery.isLoading || failuresByAgentQuery.isLoading;

  const error = usageTab
    ? (usageDailyQuery.error ??
      byAgentQuery.error ??
      agentRunTimeQuery.error ??
      runTimeDailyQuery.error)
    : (failuresDailyQuery.error ?? failuresByAgentQuery.error);

  const retry = () => {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all(wsId) });
  };

  const hasNoUsage =
    usageInWindow.length === 0 && runTimeDailyInWindow.length === 0;

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <EmptyState
          title="Couldn't load usage"
          description="The workspace rollups didn't come back. Try again in a moment."
          onRetry={retry}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScrollView
        contentContainerClassName="gap-3 p-4"
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <PillGroup
          options={RANGES}
          value={days}
          onChange={setDays}
          accessibilityLabel="Time range"
        />
        <PillGroup
          options={TABS}
          value={tab}
          onChange={setTab}
          accessibilityLabel="Analytics view"
        />

        {usageTab ? (
          hasNoUsage ? (
            <Card>
              <Text className="text-sm text-muted-foreground">
                No usage in this window.
              </Text>
            </Card>
          ) : (
            <>
              <StatTileRow>
                <StatTile
                  label={`Tokens · ${days}D`}
                  value={formatCompactNumber(tokens.tokens)}
                  hint={`Input ${formatCompactNumber(tokens.input)} · Output ${formatCompactNumber(tokens.output)}`}
                />
                <StatTile
                  label={`Runs · ${days}D`}
                  value={formatCompactNumber(runTime.runs)}
                  hint={`${formatCompactNumber(runTime.failed)} failed`}
                />
                <StatTile
                  label={`Run time · ${days}D`}
                  value={formatDuration(runTime.seconds)}
                  hint={`Across ${formatCompactNumber(runTime.runs)} runs`}
                />
              </StatTileRow>

              <Card className="gap-3">
                <View className="gap-2">
                  <Text className="text-sm font-semibold text-foreground">
                    {metricTitle(metric)}
                  </Text>
                  <PillGroup
                    options={METRICS}
                    value={metric}
                    onChange={setMetric}
                    accessibilityLabel="Trend metric"
                  />
                </View>
                <DailyBarChart
                  points={
                    metric === "tokens"
                      ? tokenPoints
                      : metric === "time"
                        ? timePoints
                        : runsPoints
                  }
                  formatValue={metricFormat(metric)}
                  label={`${metricTitle(metric)}, ${days} days`}
                />
              </Card>

              <Card className="gap-1">
                <Text className="text-sm font-semibold text-foreground">
                  {`Top agents by ${metricNoun(metric)}`}
                </Text>
                {rankingRows(metric, agentUsageRows, agentRunRows).map((row) => (
                  <ShareRow
                    key={row.agentId}
                    label={nameOf(row.agentId)}
                    value={metricFormat(metric)(row.value)}
                    hint={row.hint}
                    share={shareOf(row.value, rankingRows(metric, agentUsageRows, agentRunRows))}
                    onPress={
                      row.agentId === UNKNOWN_AGENT_ID
                        ? undefined
                        : () => openAgent(row.agentId)
                    }
                  />
                ))}
              </Card>
            </>
          )
        ) : failures.total === 0 ? (
          <Card>
            <Text className="text-sm text-muted-foreground">
              No runs in this window.
            </Text>
          </Card>
        ) : (
          <>
            <StatTileRow>
              <StatTile
                label={`Failed runs · ${days}D`}
                value={formatCompactNumber(failures.failed)}
                hint={`Of ${formatCompactNumber(failures.total)} runs`}
              />
              <StatTile
                label={`Failure rate · ${days}D`}
                value={formatRate(failures.failed, failures.total)}
                hint="Share of runs"
              />
              <StatTile
                label={`Agents affected · ${days}D`}
                value={formatCompactNumber(offenders.length)}
                hint={
                  offenders[0]
                    ? `Worst ${nameOf(offenders[0].agentId)} · ${formatCompactNumber(offenders[0].failed)}`
                    : undefined
                }
              />
            </StatTileRow>

            <Card className="gap-1">
              <Text className="text-sm font-semibold text-foreground">
                {`Failure mix · ${formatCompactNumber(failures.failed)}`}
              </Text>
              {failureClasses.length === 0 ? (
                <Text className="text-sm text-muted-foreground">
                  No failed runs in this window.
                </Text>
              ) : (
                failureClasses.map((row) => (
                  <ShareRow
                    key={row.failureClass}
                    label={FAILURE_CLASS_LABEL[row.failureClass]}
                    value={formatCompactNumber(row.count)}
                    hint={formatRate(row.count, failures.failed)}
                    share={row.count / failureClasses[0].count}
                    barClassName="bg-destructive"
                  />
                ))
              )}
            </Card>

            <Card className="gap-1">
              <Text className="text-sm font-semibold text-foreground">
                Top offenders
              </Text>
              {offenders.length === 0 ? (
                <Text className="text-sm text-muted-foreground">
                  No failed runs in this window.
                </Text>
              ) : (
                <>
                  {offenders.slice(0, RANKING_LIMIT).map((row) => (
                    <ShareRow
                      key={row.agentId}
                      label={nameOf(row.agentId)}
                      value={formatCompactNumber(row.failed)}
                      hint={
                        hasRateSample(row)
                          ? `${formatCompactNumber(row.runs)} runs · ${formatRate(row.failed, row.runs)} failed`
                          : `Fewer than ${MIN_RATE_SAMPLE} runs — this rate is not meaningful.`
                      }
                      share={row.failed / offenders[0].failed}
                      barClassName="bg-destructive"
                      onPress={
                        row.agentId === UNKNOWN_AGENT_ID
                          ? undefined
                          : () => openAgent(row.agentId)
                      }
                    />
                  ))}
                </>
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Ranking rows for the selected metric, heaviest first. */
function rankingRows(
  metric: Metric,
  agentUsageRows: { agentId: string; tokens: number; runs: number }[],
  agentRunRows: { agentId: string; seconds: number; runs: number }[],
): { agentId: string; value: number; hint: string }[] {
  if (metric === "tokens") {
    return agentUsageRows.slice(0, RANKING_LIMIT).map((row) => ({
      agentId: row.agentId,
      value: row.tokens,
      hint: `${formatCompactNumber(row.runs)} runs`,
    }));
  }
  return agentRunRows.slice(0, RANKING_LIMIT).map((row) => ({
    agentId: row.agentId,
    value: metric === "time" ? row.seconds : row.runs,
    hint:
      metric === "time"
        ? `${formatCompactNumber(row.runs)} runs`
        : formatDuration(row.seconds),
  }));
}

function shareOf(
  value: number,
  rows: { value: number }[],
): number {
  const peak = rows.reduce((max, row) => Math.max(max, row.value), 0);
  return peak > 0 ? value / peak : 0;
}

function metricTitle(metric: Metric): string {
  return METRICS.find((m) => m.value === metric)?.title ?? "";
}

function metricNoun(metric: Metric): string {
  return metric === "time" ? "run time" : metric;
}

function metricFormat(metric: Metric): (value: number) => string {
  return metric === "time" ? formatDuration : formatCompactNumber;
}

/** Pill row — the same shape as the My Issues scope switcher: the selected pill
 *  fills with the accent token so it survives dark mode. */
function PillGroup<T extends string | number>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  return (
    <View
      className="flex-row flex-wrap items-center gap-1"
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Button
            key={String(option.value)}
            variant="outline"
            size="sm"
            onPress={() => onChange(option.value)}
            className={active ? "bg-accent" : ""}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text
              numberOfLines={1}
              className={
                active ? "text-accent-foreground" : "text-muted-foreground"
              }
            >
              {option.label}
            </Text>
          </Button>
        );
      })}
    </View>
  );
}

function EmptyState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <Text className="text-center text-base font-medium text-foreground">
        {title}
      </Text>
      <Text className="text-center text-sm text-muted-foreground">
        {description}
      </Text>
      <Button variant="outline" size="sm" onPress={onRetry}>
        <Text>Try again</Text>
      </Button>
    </View>
  );
}
