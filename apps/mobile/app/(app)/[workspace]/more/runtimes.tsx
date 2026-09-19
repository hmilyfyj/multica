/**
 * Runtimes browse page — read-only roster of the workspace's runtimes.
 *
 * Read-only by design (FEATURE-569): no connect-remote / cloud runtime, no
 * runtime profile editing, no pricing overrides, no rename / delete / update.
 * Web owns all of those.
 *
 * Scope parity: `api.listRuntimes()` sends no `owner` filter, which is exactly
 * the default web scope (`GET /api/runtimes` with no params, see
 * packages/core/api/client.ts:1809) — the server still applies the runtime
 * visibility gate to private runtimes, so this list shows what the caller may
 * read, not what the workspace owns.
 *
 * Web groups runtimes under machines (`buildRuntimeMachines`). Mobile lists them
 * flat: a machine is a grouping device for a wide screen's detail pane, and on a
 * phone it would add a level of navigation over rows that already carry the
 * device name. Order is the server's, as it is inside a web machine.
 */
import { useCallback } from "react";
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
import { RuntimeRow } from "@/components/runtimes/runtime-row";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function RuntimesPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    runtimeListOptions(wsId),
  );

  const openRuntime = useCallback(
    (id: string) => {
      if (wsSlug) router.push(`/${wsSlug}/more/runtimes/${id}`);
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
            Couldn&apos;t load runtimes:{" "}
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
            <RuntimeRow runtime={item} onPress={() => openRuntime(item.id)} />
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
        No runtimes yet
      </Text>
      <Text className="text-center text-sm text-muted-foreground">
        A runtime appears here once a daemon registers one with this workspace.
        Private runtimes are only visible to their owner.
      </Text>
    </View>
  );
}
