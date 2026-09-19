/**
 * Agent detail — read-only. Sections, top to bottom:
 *
 *   Identity   avatar + name + description + lifecycle badges
 *   Status     derived presence, model, runtime
 *   Details    owner / access / concurrency / created
 *   Runs       active + recent runs with status and duration, issue-linked
 *
 * The agent itself comes from the workspace agent list rather than a
 * dedicated `GET /api/agents/{id}`: the list already carries every field this
 * screen shows, it is invalidated by the `agent:*` realtime events, and
 * reusing it means one cache entry instead of a second fetch path. An id that
 * is not in that list (archived on another device, deleted) renders the
 * not-found state — the same scope the list page shows, so the two agree.
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
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AgentDetailHeader } from "@/components/agents/agent-detail-header";
import { AgentFactsSection } from "@/components/agents/agent-facts-section";
import { AgentRunsSection } from "@/components/agents/agent-runs-section";
import { agentListOptions, agentTasksOptions } from "@/data/queries/agents";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function AgentDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();

  const {
    data: agents,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery(agentListOptions(wsId));

  const agent = agents?.find((a) => a.id === id);

  // The runs list owns its own query, so a pull refreshes it through the cache
  // instead of a prop-drilled refetch.
  const onRefresh = useCallback(async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({
        queryKey: agentTasksOptions(wsId, id).queryKey,
      }),
    ]);
  }, [refetch, queryClient, wsId, id]);

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ title: "Agent" }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !agent) {
    const failed = !!error;
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ title: "Agent" }} />
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="text-base font-medium text-foreground">
            {failed ? "Couldn't load this agent" : "Agent not found"}
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            {failed
              ? error instanceof Error
                ? error.message
                : "Something went wrong fetching this agent."
              : "This agent may have been archived or removed."}
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

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen
        options={{ title: agent.name, headerBackTitle: "Agents" }}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-6 pb-10"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />
        }
      >
        <AgentDetailHeader agent={agent} />
        <AgentFactsSection agent={agent} />
        <AgentRunsSection agentId={agent.id} />
      </ScrollView>
    </SafeAreaView>
  );
}
