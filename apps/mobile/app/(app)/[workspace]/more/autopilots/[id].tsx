/**
 * Autopilot detail — read-only, plus the one write the mobile view offers:
 * "Run now". Sections, top to bottom:
 *
 *   Identity   title + lifecycle badge + description + system-pause banner
 *   Details    assignee / creator / output mode / project / created
 *   Triggers   each trigger's config summary (schedule, webhook URL, label)
 *   Run History active + past runs with status, source, time, failure reason
 *
 * The whole payload (`{ autopilot, triggers }`) comes from the detail endpoint;
 * the run history owns its own query so a pull refreshes it through the cache
 * instead of a prop-drilled refetch — the same split the agent detail screen uses.
 *
 * An id that the server does not know (deleted on another device, wrong
 * workspace) answers 404, and a payload that fails to parse degrades to the
 * `id: ""` sentinel; both render the not-found state.
 */
import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AutopilotDetailHeader } from "@/components/autopilots/autopilot-detail-header";
import { AutopilotFactsSection } from "@/components/autopilots/autopilot-facts-section";
import { AutopilotTriggersSection } from "@/components/autopilots/autopilot-triggers-section";
import { AutopilotRunsSection } from "@/components/autopilots/autopilot-runs-section";
import { ApiError } from "@/data/api";
import { useTriggerAutopilot } from "@/data/mutations/autopilots";
import {
  autopilotDetailOptions,
  autopilotRunsOptions,
} from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  RUN_NOW_FAILED_MESSAGE,
  RUN_NOW_SUCCESS_MESSAGE,
  runNowBlockedMessage,
  runNowOutcome,
} from "@/lib/autopilot-display";
import { dispatchReasonCode } from "@/lib/dispatch-reason";

export default function AutopilotDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery(autopilotDetailOptions(wsId, id));

  const triggerAutopilot = useTriggerAutopilot(id);

  const onRefresh = useCallback(async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({
        queryKey: autopilotRunsOptions(wsId, id).queryKey,
      }),
    ]);
  }, [refetch, queryClient, wsId, id]);

  /**
   * Manual run. The HTTP 2xx is not the answer — the server returns the run it
   * dispatched, and admission can block one with a 200 — so the outcome comes
   * from the run's own status/reason_code (MUL-4525), classified by the same
   * whitelist web uses. A request-level failure carries either the admission
   * reason (429 quota, refusals) or a 4xx sentence written for the user; a 5xx
   * one is internal detail and shows the generic sentence instead.
   *
   * Native alert rather than a toast: RN has no cross-platform toast, and the
   * blocked sentence is longer than an inline banner holds.
   */
  const onRunNow = useCallback(async () => {
    if (triggerAutopilot.isPending) return;
    try {
      const run = await triggerAutopilot.mutateAsync();
      const outcome = runNowOutcome(run?.status);
      if (outcome === "success") {
        Alert.alert(RUN_NOW_SUCCESS_MESSAGE);
        return;
      }
      Alert.alert(
        outcome === "warning" ? "Run skipped" : "Run not started",
        runNowBlockedMessage(run?.reason_code),
      );
    } catch (err) {
      const reason = dispatchReasonCode(err);
      if (reason) {
        Alert.alert("Run not started", runNowBlockedMessage(reason));
        return;
      }
      const clientMessage =
        err instanceof ApiError && err.status >= 400 && err.status < 500
          ? err.message
          : "";
      Alert.alert(
        "Couldn't run autopilot",
        clientMessage || RUN_NOW_FAILED_MESSAGE,
      );
    }
  }, [triggerAutopilot]);

  const autopilot = data?.autopilot;

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ title: "Autopilot" }} />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !autopilot || !autopilot.id) {
    const failed = !!error;
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ title: "Autopilot" }} />
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="text-base font-medium text-foreground">
            {failed ? "Couldn't load this autopilot" : "Autopilot not found"}
          </Text>
          <Text className="text-center text-sm text-muted-foreground">
            {failed
              ? error instanceof Error
                ? error.message
                : "Something went wrong fetching this autopilot."
              : "This autopilot may have been deleted or belongs to another workspace."}
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
        options={{ title: autopilot.title || "Autopilot", headerBackTitle: "Autopilots" }}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-6 pb-10"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />
        }
      >
        <AutopilotDetailHeader
          autopilot={autopilot}
          isRunning={triggerAutopilot.isPending}
          onRunNow={onRunNow}
        />
        <AutopilotFactsSection autopilot={autopilot} />
        <AutopilotTriggersSection triggers={data.triggers} />
        <AutopilotRunsSection autopilotId={autopilot.id} />
      </ScrollView>
    </SafeAreaView>
  );
}
