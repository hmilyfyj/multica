/**
 * Runtime usage summary — the read-only "what has this runtime spent?" block.
 *
 * Web answers this with four chart blocks plus a period selector
 * (packages/views/runtimes/components/usage-section.tsx). Mobile shows the same
 * numbers as one KPI list over a fixed window: a phone has no room for the
 * stacked charts, and the daily/weekly dimensions they exist for are a
 * drill-down nobody performs on a phone.
 *
 * The cost here is ONLY what the provider reported (`cost_usd_ticks`). Web adds
 * a client-side estimate for tokens the provider did not price, using a 186-line
 * MODEL_PRICING table that lives in `@multica/views` — a package mobile does not
 * depend on. Rather than copy that table (and then keep two rate tables in
 * step), the unpriced tokens get their own row, so a $0.00 cost with real
 * traffic can never be read as "nothing happened".
 */
import { useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { runtimeUsageOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  formatTokens,
  formatUsd,
  RUNTIME_USAGE_DAYS,
  runtimeUsageTotals,
  runtimeUsageWindow,
} from "@/lib/runtime-display";

interface Props {
  runtimeId: string;
}

export function RuntimeUsageSection({ runtimeId }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data, isLoading, error, refetch } = useQuery(
    runtimeUsageOptions(wsId, runtimeId, RUNTIME_USAGE_DAYS),
  );

  const totals = useMemo(
    () => runtimeUsageTotals(runtimeUsageWindow(data ?? [], RUNTIME_USAGE_DAYS)),
    [data],
  );

  return (
    <View className="gap-2">
      <Text className="px-4 text-xs font-medium uppercase text-muted-foreground">
        {`Usage · ${RUNTIME_USAGE_DAYS}D`}
      </Text>

      {isLoading ? (
        <View className="items-center border-y border-border bg-background px-4 py-6">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="gap-3 border-y border-border bg-background px-4 py-4">
          <Text className="text-sm text-destructive">
            Couldn&apos;t load usage:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : totals.totalTokens === 0 ? (
        <View className="border-y border-border bg-background px-4 py-4">
          <Text className="text-sm text-muted-foreground">
            No usage in this period.
          </Text>
        </View>
      ) : (
        <View className="border-y border-border bg-background">
          <Row
            label="Cost"
            value={formatUsd(totals.costUsd)}
            hint="reported by the provider"
          />
          <Separator />
          <Row
            label="Tokens"
            value={formatTokens(totals.totalTokens)}
            hint={`in ${formatTokens(totals.inputTokens)} · out ${formatTokens(totals.outputTokens)}`}
          />
          <Separator />
          <Row
            label="Cache"
            value={formatTokens(totals.cacheReadTokens)}
            hint={`${formatTokens(totals.cacheWriteTokens)} written`}
          />
          <Separator />
          <Row label="Active days" value={`${totals.activeDays}`} />
          {totals.unpricedTokens > 0 ? (
            <>
              <Separator />
              <Row
                label="Unpriced tokens"
                value={formatTokens(totals.unpricedTokens)}
                hint="not estimated on the device"
              />
            </>
          ) : null}
        </View>
      )}
    </View>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <View className="flex-row items-center justify-between gap-4 px-4 py-3">
      <View className="gap-0.5">
        <Text className="text-sm text-foreground">{label}</Text>
        {hint ? (
          <Text className="text-xs text-muted-foreground">{hint}</Text>
        ) : null}
      </View>
      <Text className="text-sm text-foreground">{value}</Text>
    </View>
  );
}

function Separator() {
  return <View className="ml-4 h-px bg-border" />;
}
