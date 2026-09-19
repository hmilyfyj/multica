/**
 * Squads browse page — read-only roster of the workspace's squads.
 *
 * Read-only by design (FEATURE-569): no create, archive, leader transfer, member
 * add/remove or role editing. Web owns all of those.
 *
 * Scope parity: `api.listSquads()` sends no filter and the server's ListSquads is
 * unfiltered workspace-wide (server/internal/handler/squad.go:191), so this list
 * is the same membership web's default view shows; archived squads are excluded
 * server-side. The list payload already carries `member_count`, `member_preview`
 * and `leader_id`, so opening it costs one request and no per-row detail fetch.
 *
 * Leader names come from the agent roster that the rest of the app already holds
 * (the presence sweep keeps it warm), which is how web's LeaderCell resolves them
 * too. A leader missing from that roster falls back to its id prefix.
 *
 * Sort: the server's order. Web's squad list has no default sort either
 * (squads-page.tsx), so there is nothing to mirror.
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
import { SquadRow } from "@/components/squads/squad-row";
import { agentListOptions } from "@/data/queries/agents";
import { squadListOptions } from "@/data/queries/squads";
import { useWorkspaceStore } from "@/data/workspace-store";
import { findSquadLeaderName } from "@/lib/squad-display";

export default function SquadsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    squadListOptions(wsId),
  );
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  // One roster lookup per row, against the agent list already in cache — not one
  // query per row.
  const leaderNames = useMemo(() => {
    const bySquad: Record<string, string | null> = {};
    for (const squad of data ?? []) {
      bySquad[squad.id] = findSquadLeaderName(squad.leader_id, agents);
    }
    return bySquad;
  }, [data, agents]);

  const openSquad = useCallback(
    (id: string) => {
      if (wsSlug) router.push(`/${wsSlug}/more/squads/${id}`);
    },
    [wsSlug],
  );

  const rows = data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={[]}>
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="gap-3 px-4 pt-4">
          <Text className="text-sm text-destructive">
            Couldn&apos;t load squads:{" "}
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
            <SquadRow
              squad={item}
              leaderName={leaderNames[item.id] ?? null}
              onPress={() => openSquad(item.id)}
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
    <View className="flex-1 items-center justify-center gap-2 px-6">
      <Text className="text-base font-medium text-foreground">
        No squads yet
      </Text>
      <Text className="text-center text-sm text-muted-foreground">
        A squad is a group of agents with one leader. Create one from the web
        app and it shows up here.
      </Text>
    </View>
  );
}
