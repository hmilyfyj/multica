/**
 * Autopilots browse page — read-only roster of the workspace's automations.
 *
 * Read-only by design (FEATURE-567): no create, edit, pause/resume, delete,
 * trigger editing, or webhook token handling. Those stay on web for now.
 *
 * Scope parity: `api.listAutopilots()` sends no `status` filter, which is exactly
 * web's default "all" scope — the server returns active + paused and never
 * archived rows (server/pkg/db/queries/autopilot.sql), so this list and web's
 * agree on membership without a filter chip.
 *
 * Each row is fed entirely by the list payload: `trigger_kinds`, `next_run_at`
 * and `last_run_status` are server-derived columns (enabled triggers only), so
 * opening the list costs one request and no per-row detail fetch.
 *
 * Sort: most recent run first, never-run rows last — web's default `lastRun`
 * descending direction (mobile has no sort control in v1).
 */
import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AutopilotRow } from "@/components/autopilots/autopilot-row";
import { autopilotListOptions } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import { sortAutopilotsByRecentRun } from "@/lib/autopilot-display";

export default function AutopilotsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    autopilotListOptions(wsId),
  );

  const rows = useMemo(() => sortAutopilotsByRecentRun(data ?? []), [data]);

  const openAutopilot = useCallback(
    (id: string) => {
      if (wsSlug) router.push(`/${wsSlug}/more/autopilots/${id}`);
    },
    [wsSlug],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={[]}>
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            Couldn&apos;t load autopilots:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
          renderItem={({ item }) => (
            <AutopilotRow
              autopilot={item}
              onPress={() => openAutopilot(item.id)}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          contentContainerClassName="pb-6"
        />
      )}
    </SafeAreaView>
  );
}

function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-2">
      <Text className="text-base font-medium text-foreground">
        No autopilots yet
      </Text>
      <Text className="text-center text-sm text-muted-foreground">
        Autopilots created in this workspace show up here. Schedule recurring
        work for your agents from the web app.
      </Text>
    </View>
  );
}
