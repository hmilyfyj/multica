/**
 * Runtime detail — read-only. Sections, top to bottom:
 *
 *   Identity   display name + health + last heartbeat + device host
 *   Details    type / kind / version / device / daemon CLI / visibility / owner
 *   Usage      cost, tokens and cache over the last 30 days
 *
 * The runtime itself is read out of the workspace roster rather than a
 * `GET /api/runtimes/{id}` — there is no such endpoint; the path only carries
 * PATCH and read-only sub-resources (server/cmd/server/router.go:2190-2220), and
 * web reads the row from the same list. An id the roster does not contain
 * (deleted on another device, or a private runtime owned by someone else)
 * renders the not-found state, which is the same scope the list page shows.
 *
 * Usage owns its own query (and its own key root, see data/queries/runtimes.ts)
 * so a pull refreshes it through the cache instead of a prop-drilled refetch —
 * the split the agent and autopilot details use.
 */
import { useCallback } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { runtimeDisplayName } from "@multica/core/runtimes";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { RuntimeDetailHeader } from "@/components/runtimes/runtime-detail-header";
import { RuntimeFactsSection } from "@/components/runtimes/runtime-facts-section";
import { RuntimeUsageSection } from "@/components/runtimes/runtime-usage-section";
import {
  runtimeListOptions,
  runtimeUsageOptions,
} from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { RUNTIME_USAGE_DAYS } from "@/lib/runtime-display";

export default function RuntimeDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();

  const {
    data: runtimes,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery(runtimeListOptions(wsId));

  const runtime = runtimes?.find((candidate) => candidate.id === id);

  const onRefresh = useCallback(async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({
        queryKey: runtimeUsageOptions(wsId, id, RUNTIME_USAGE_DAYS).queryKey,
      }),
    ]);
  }, [refetch, queryClient, wsId, id]);

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ title: "Runtime" }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !runtime) {
    const failed = !!error;
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ title: "Runtime" }} />
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="text-base font-medium text-foreground">
            {failed ? "Couldn't load this runtime" : "Runtime not found"}
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            {failed
              ? error instanceof Error
                ? error.message
                : "Something went wrong fetching this runtime."
              : "This runtime may have been deleted, or it is private to another member."}
          </Text>
          {failed ? (
            <Button variant="outline" onPress={() => refetch()}>
              <Text>Try again</Text>
            </Button>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  const name = runtimeDisplayName(runtime);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen
        options={{ title: name, headerBackTitle: "Runtimes" }}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-6 pb-10"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />
        }
      >
        <RuntimeDetailHeader runtime={runtime} />
        <RuntimeFactsSection runtime={runtime} />
        <RuntimeUsageSection runtimeId={runtime.id} />
      </ScrollView>
    </SafeAreaView>
  );
}
