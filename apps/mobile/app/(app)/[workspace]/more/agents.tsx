/**
 * Agents browse page — read-only roster of the workspace's agents.
 *
 * Read-only by design (FEATURE-565): no create, edit, archive, debug console,
 * or Skills/MCP management. Those stay on web for now.
 *
 * Scope parity: `api.listAgents()` calls `GET /api/agents` without
 * `include_archived`, which is exactly web's default "Active agents" scope —
 * retired agents are not listed, and the archived filter chip is out of scope.
 *
 * Data: the agent list carries identity + model + runtime binding; the task
 * snapshot supplies each agent's last-activity timestamp (one terminal row per
 * agent by design); presence comes from `useWorkspacePresenceMap`, i.e. ONE
 * map lookup per row instead of one presence subscription per row.
 *
 * Sort: most recent activity first, never-run agents last — mirrors web's
 * default "Recent activity" direction (mobile has no sort control in v1).
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
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AgentRow } from "@/components/agents/agent-row";
import { agentListOptions } from "@/data/queries/agents";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { useWorkspaceStore } from "@/data/workspace-store";
import { latestActivityAt, sortByRecentActivity } from "@/lib/agent-runs";
import { useWorkspacePresenceMap } from "@/lib/use-agent-presence";

export default function AgentsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    agentListOptions(wsId),
  );
  const { data: snapshot = [] } = useQuery(agentTaskSnapshotOptions(wsId));
  const { byAgent } = useWorkspacePresenceMap(wsId);

  const rows = useMemo(() => {
    const tasksByAgent: Record<string, AgentTask[]> = {};
    for (const task of snapshot) {
      const bucket = tasksByAgent[task.agent_id];
      if (bucket) bucket.push(task);
      else tasksByAgent[task.agent_id] = [task];
    }
    return sortByRecentActivity(
      (data ?? []).map((agent) => ({
        agent,
        name: agent.name,
        lastActivityAt: latestActivityAt(tasksByAgent[agent.id] ?? []),
      })),
    );
  }, [data, snapshot]);

  const openAgent = useCallback(
    (id: string) => {
      if (wsSlug) router.push(`/${wsSlug}/more/agents/${id}`);
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
            Couldn&apos;t load agents:{" "}
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
          keyExtractor={(item) => item.agent.id}
          ItemSeparatorComponent={() => (
            <View className="h-px bg-border ml-4" />
          )}
          renderItem={({ item }) => (
            <AgentRow
              agent={item.agent}
              presence={byAgent.get(item.agent.id) ?? null}
              lastActivityAt={item.lastActivityAt}
              onPress={() => openAgent(item.agent.id)}
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
        No agents yet
      </Text>
      <Text className="text-center text-sm text-muted-foreground">
        Agents created in this workspace show up here.
      </Text>
    </View>
  );
}
