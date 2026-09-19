/**
 * Run detail — the body of the `issue/[id]/runs/[taskId]` formSheet route,
 * pushed from a row in the Runs sheet (`components/issue/run-row.tsx`).
 *
 * Shows one run's complete timeline: the header answers "which run is this"
 * (agent, status, how long it ran, what triggered it, why it failed) and the
 * body is the transcript itself (`RunTranscript`), which grows live while the
 * task runs.
 *
 * The task record comes from the Runs sheet's own `issueTasksOptions` cache,
 * so opening a row costs no extra request; a deep link that lands here cold
 * simply renders the transcript without the summary line rather than erroring.
 * The transcript query is keyed on the task alone — its own cache entry, shared
 * with the inline steps fold on the list row.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { RunCancelButton, RunStatusBadge } from "@/components/issue/run-row";
import { RunTranscript } from "@/components/issue/run-transcript";
import { useRunTranscript } from "@/components/issue/use-run-transcript";
import { issueTasksOptions } from "@/data/queries/issues";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspaceStore } from "@/data/workspace-store";
import { isActiveTask, runDurationLabel } from "@/lib/agent-runs";
import { timeAgo } from "@/lib/time-ago";

export default function IssueRunDetailRoute() {
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { getName } = useActorLookup();

  const { data: tasks = [] } = useQuery(issueTasksOptions(wsId, id));
  const task = tasks.find((candidate) => candidate.id === taskId);
  const isActive = task ? isActiveTask(task) : false;

  const { entries, isLoading, isError, refetch } = useRunTranscript(taskId);

  // A running task's elapsed time has to tick; a finished one is stamped
  // (web's InlineCommentRun runs the same one-second clock).
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isActive]);

  const agentName = task ? getName("agent", task.agent_id) : "Run";
  const summary = task?.trigger_summary?.trim();
  const elapsed = task ? runDurationLabel(task, now) : undefined;
  const timestamp = task ? task.completed_at || task.created_at : undefined;

  return (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-2 gap-2">
        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close run detail"
            onPress={() => router.back()}
            className="p-1 active:opacity-70"
          >
            <Ionicons name="chevron-down" size={18} color="#71717a" />
          </Pressable>
          <Text
            className="flex-1 text-base font-semibold text-foreground"
            numberOfLines={1}
          >
            {agentName}
          </Text>
          {task && isActive ? (
            <RunCancelButton taskId={task.id} issueId={id} />
          ) : null}
        </View>

        {task ? (
          <View className="flex-row items-start gap-2">
            <ActorAvatar type="agent" id={task.agent_id} size={28} showPresence />
            <View className="flex-1 gap-1">
              {summary ? (
                <Text className="text-sm text-foreground" numberOfLines={3}>
                  {summary}
                </Text>
              ) : null}
              <View className="flex-row flex-wrap items-center gap-2">
                <RunStatusBadge task={task} />
                {elapsed ? (
                  <Text className="text-xs text-muted-foreground">
                    {isActive ? `${elapsed} elapsed` : `Ran for ${elapsed}`}
                  </Text>
                ) : null}
                {timestamp ? (
                  <Text className="text-xs text-muted-foreground">
                    {timeAgo(timestamp)}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}
      </View>

      <View className="flex-1 px-4">
        {isLoading && entries.length === 0 ? (
          <View className="items-center pt-6">
            <ActivityIndicator />
          </View>
        ) : isError ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => refetch()}
            className="flex-row items-center gap-1 py-2 active:opacity-70"
          >
            <Ionicons name="refresh" size={12} color="#71717a" />
            <Text className="text-xs text-muted-foreground">
              {"Couldn't load this run's steps. Tap to retry."}
            </Text>
          </Pressable>
        ) : (
          <RunTranscript entries={entries} isStreaming={isActive} />
        )}
      </View>
    </View>
  );
}
