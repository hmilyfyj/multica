/**
 * Skills browse page — read-only roster of the workspace's skills.
 *
 * Read-only by design (FEATURE-569): no create, no file-tree editing, no
 * refresh-from-source, no runtime-local import. Web owns all four.
 *
 * Scope parity: `api.listSkills()` calls `GET /api/skills` with no filter, the
 * same default scope web's list shows. The server omits every SKILL.md body from
 * this response on purpose (GH multica-ai/multica#2174) and attaches labels for
 * web's label filter; mobile renders neither, so a row here is one request.
 *
 * Sort: the server's order. Web's list defaults to its Updated column
 * descending, but it also offers a sort control mobile does not have; carrying
 * the sort without the control would hide which order a reader is looking at.
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
import { SkillRow } from "@/components/skills/skill-row";
import { skillListOptions } from "@/data/queries/skills";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function SkillsPage() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    skillListOptions(wsId),
  );

  const openSkill = useCallback(
    (id: string) => {
      if (wsSlug) router.push(`/${wsSlug}/more/skills/${id}`);
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
            Couldn&apos;t load skills:{" "}
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
            <SkillRow skill={item} onPress={() => openSkill(item.id)} />
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
        No skills yet
      </Text>
      <Text className="text-center text-sm text-muted-foreground">
        Skills this workspace can hand to its agents show up here. Create or
        import one from the web app.
      </Text>
    </View>
  );
}
