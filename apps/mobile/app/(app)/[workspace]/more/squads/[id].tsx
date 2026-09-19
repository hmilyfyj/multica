/**
 * Squad detail — read-only. Sections, top to bottom:
 *
 *   Identity      name, description
 *   Details       leader / members / created by / created / updated
 *   Members       the roster with the leader marked
 *   Instructions  the leader's standing brief, read-only
 *
 * The squad comes from `GET /api/squads/{id}`, not from the list row: the list
 * payload carries every identity field but not `instructions`, which is the one
 * body this screen exists to show. The roster owns its own query so a pull
 * refreshes it through the cache instead of a prop-drilled refetch — the split
 * the agent / autopilot / runtime details use.
 *
 * An unknown or out-of-workspace id answers 404 and a payload that fails to
 * parse degrades to the `id: ""` sentinel; both render the not-found state.
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
import { SquadDetailHeader } from "@/components/squads/squad-detail-header";
import { SquadFactsSection } from "@/components/squads/squad-facts-section";
import { SquadMembersSection } from "@/components/squads/squad-members-section";
import { SquadInstructionsSection } from "@/components/squads/squad-instructions-section";
import {
  squadDetailOptions,
  squadMembersOptions,
} from "@/data/queries/squads";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function SquadDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    squadDetailOptions(wsId, id),
  );
  const { data: members = [] } = useQuery(squadMembersOptions(wsId, id));

  const onRefresh = useCallback(async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({
        queryKey: squadMembersOptions(wsId, id).queryKey,
      }),
    ]);
  }, [refetch, queryClient, wsId, id]);

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ title: "Squad" }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data || !data.id) {
    const failed = !!error;
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ title: "Squad" }} />
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="text-base font-medium text-foreground">
            {failed ? "Couldn't load this squad" : "Squad not found"}
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            {failed
              ? error instanceof Error
                ? error.message
                : "Something went wrong fetching this squad."
              : "This squad may have been archived or belongs to another workspace."}
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
        options={{ title: data.name || "Squad", headerBackTitle: "Squads" }}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-6 pb-10"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />
        }
      >
        <SquadDetailHeader squad={data} />
        <SquadFactsSection squad={data} />
        <SquadMembersSection squad={data} members={members} />
        <SquadInstructionsSection instructions={data.instructions} />
      </ScrollView>
    </SafeAreaView>
  );
}
