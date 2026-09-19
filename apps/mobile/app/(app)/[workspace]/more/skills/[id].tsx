/**
 * Skill detail — read-only. Sections, top to bottom:
 *
 *   Identity   name + description
 *   Details    source / added by / file count + size / created / updated
 *   Files      SKILL.md plus the supporting files, with sizes
 *
 * The payload is `GET /api/skills/{id}?include=metadata`: the skill's own fields
 * plus `content_size` and per-file metadata, with every file body left out. This
 * screen only ever renders a list of paths, so the bodies would be payload it
 * throws away on arrival — a single SKILL.md routinely runs 50-200KB
 * (server/internal/handler/skill.go:107-121), which is why the shrink exists.
 *
 * There is therefore no file viewer here, and no editing, refresh or delete:
 * those need the bodies web loads with the full detail response.
 *
 * An unknown or out-of-workspace id answers 404 and a payload that fails to parse
 * degrades to the `id: ""` sentinel; both render the not-found state.
 */
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { SkillDetailHeader } from "@/components/skills/skill-detail-header";
import { SkillFactsSection } from "@/components/skills/skill-facts-section";
import { SkillFilesSection } from "@/components/skills/skill-files-section";
import { skillDetailOptions } from "@/data/queries/skills";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function SkillDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    skillDetailOptions(wsId, id),
  );

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ title: "Skill" }} />
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
        <Stack.Screen options={{ title: "Skill" }} />
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="text-base font-medium text-foreground">
            {failed ? "Couldn't load this skill" : "Skill not found"}
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            {failed
              ? error instanceof Error
                ? error.message
                : "Something went wrong fetching this skill."
              : "This skill may have been deleted or belongs to another workspace."}
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
        options={{ title: data.name || "Skill", headerBackTitle: "Skills" }}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-6 pb-10"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        <SkillDetailHeader skill={data} />
        <SkillFactsSection detail={data} />
        <SkillFilesSection detail={data} />
      </ScrollView>
    </SafeAreaView>
  );
}
