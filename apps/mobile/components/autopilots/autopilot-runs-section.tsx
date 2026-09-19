/**
 * Autopilot run history — the delivery record of this automation, newest first.
 *
 * Rows come from the runs endpoint, which pages at 20 by default and omits each
 * run's `trigger_payload` (a webhook envelope can reach 256 KiB). What is left is
 * exactly what a phone needs to answer "did it run, when, and how did it end":
 * status, source, timestamp, and the server's failure/skip reason.
 *
 * Section-local three states mirror `AgentRunsSection`: this is one block of a
 * scrolling detail screen, so a failure here must not take the screen down.
 */
import { Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { AutopilotRun } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RunStatusLabel } from "@/components/autopilots/run-status-label";
import { autopilotRunsOptions } from "@/data/queries/autopilots";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  formatAbsoluteTime,
  runSourceLabel,
  runStatusTone,
} from "@/lib/autopilot-display";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface Props {
  autopilotId: string;
}

export function AutopilotRunsSection({ autopilotId }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { data, isLoading, error, refetch } = useQuery(
    autopilotRunsOptions(wsId, autopilotId),
  );

  const openIssue = (issueId: string) => {
    if (wsSlug) router.push(`/${wsSlug}/issue/${issueId}`);
  };

  if (isLoading) {
    return (
      <Section>
        <View className="gap-2 px-4 py-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </View>
      </Section>
    );
  }

  if (error) {
    return (
      <Section>
        <View className="gap-3 px-4 py-4">
          <Text className="text-sm text-destructive">
            Couldn&apos;t load runs
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>Try again</Text>
          </Button>
        </View>
      </Section>
    );
  }

  const runs = data ?? [];
  if (runs.length === 0) {
    return (
      <Section>
        <Text className="px-4 py-4 text-sm text-muted-foreground">
          No runs yet. Tap &quot;Run now&quot; to trigger manually.
        </Text>
      </Section>
    );
  }

  return (
    <Section>
      {runs.map((run) => (
        <RunRow key={run.id} run={run} onPressIssue={openIssue} />
      ))}
    </Section>
  );
}

function RunRow({
  run,
  onPressIssue,
}: {
  run: AutopilotRun;
  onPressIssue: (issueId: string) => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const linkedIssueId = run.issue_id?.trim() ? run.issue_id : null;
  // `failure_reason` is an open string the backend keeps extending; it is shown
  // as-is (web does the same) and never gates the row.
  const reason = run.failure_reason?.trim() || null;
  const reasonClass =
    runStatusTone(run.status) === "failure"
      ? "text-destructive"
      : "text-muted-foreground";

  const body = (
    <View className="flex-1 gap-1">
      <View className="flex-row items-center gap-2">
        <RunStatusLabel status={run.status} />
        <Text className="text-xs text-muted-foreground">
          {runSourceLabel(run.source)}
        </Text>
        <View className="flex-1" />
        <Text className="text-xs text-muted-foreground/70">
          {formatAbsoluteTime(run.triggered_at || run.created_at)}
        </Text>
      </View>
      <View className="flex-row items-center gap-2">
        {reason ? (
          <Text className={`flex-1 text-xs ${reasonClass}`} numberOfLines={2}>
            {reason}
          </Text>
        ) : (
          <View className="flex-1" />
        )}
        {linkedIssueId ? (
          <View className="flex-row items-center gap-0.5">
            <Text className="text-xs text-brand">Issue</Text>
            <Ionicons name="chevron-forward" size={11} color={theme.brand} />
          </View>
        ) : null}
      </View>
    </View>
  );

  if (!linkedIssueId) {
    return <View className="px-4 py-2.5">{body}</View>;
  }

  return (
    <Pressable
      onPress={() => onPressIssue(linkedIssueId)}
      accessibilityLabel={`Open the issue created by this ${runSourceLabel(run.source)} run`}
      className="active:bg-secondary px-4 py-2.5"
    >
      {body}
    </Pressable>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="px-4 text-xs font-medium uppercase text-muted-foreground">
        Run History
      </Text>
      <View className="border-y border-border bg-background">{children}</View>
    </View>
  );
}
