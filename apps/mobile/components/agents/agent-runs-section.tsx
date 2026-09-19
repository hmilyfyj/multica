/**
 * Agent-detail "Runs" section — the agent's own task history, split into
 * Active (queued / dispatched / waiting_local_directory / running) and Recent
 * (terminal), newest first.
 *
 * Data: `GET /api/agents/{id}/tasks` (all tasks for one agent) — the only
 * source with enough history to show status + duration per run. The worksapce
 * task snapshot carries just one terminal row per agent, which is enough for a
 * presence dot but not for a run list.
 *
 * Read-only: no Cancel affordance (that lives on the issue Runs sheet, where
 * the task's issue context is present). A row with a linked issue is tappable
 * and pushes the issue detail route — the same route issue rows elsewhere use.
 *
 * Bucketing and duration come from `lib/agent-runs.ts` so the mapping is
 * unit-tested; the status word/colour map stays component-local, mirroring
 * `components/issue/run-row.tsx`.
 *
 * Realtime: subscribes per record and self-gates on `agent_id`, so a busy
 * workspace only refetches this page's own runs. Reconnect re-invalidates
 * (v1 has no replay buffer).
 */
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { agentTasksOptions } from "@/data/queries/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import {
  runDurationLabel,
  splitAgentTasks,
} from "@/lib/agent-runs";
import { runFailureBadgeLabel } from "@/lib/run-failure-badge";
import { timeAgo } from "@/lib/time-ago";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

// Recent runs are a scan surface, not an audit log — the sheet's own "show
// more" pattern exists on web; a phone gets the newest cohort.
const RECENT_LIMIT = 10;

interface Props {
  agentId: string;
}

export function AgentRunsSection({ agentId }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const queryClient = useQueryClient();
  const options = agentTasksOptions(wsId, agentId);
  const queryKey = options.queryKey;
  const { data, isLoading, error, refetch } = useQuery(options);

  // Deps are the two values the key is derived from — NOT `queryKey` itself,
  // which is a fresh array every render and would re-subscribe on each one.
  useWSSubscriptions(
    (ws) => {
      const invalidate = (payload: { agent_id?: string }) => {
        if (payload?.agent_id !== agentId) return;
        void queryClient.invalidateQueries({ queryKey });
      };
      return [
        ws.on("task:queued", invalidate),
        ws.on("task:dispatch", invalidate),
        ws.on("task:running", invalidate),
        ws.on("task:waiting_local_directory", invalidate),
        ws.on("task:completed", invalidate),
        ws.on("task:failed", invalidate),
        ws.on("task:cancelled", invalidate),
        ws.onReconnect(() => {
          void queryClient.invalidateQueries({ queryKey });
        }),
      ];
    },
    [agentId, wsId, queryClient],
  );

  const { active, past } = useMemo(() => splitAgentTasks(data ?? []), [data]);

  const openIssue = (issueId: string) => {
    if (wsSlug) router.push(`/${wsSlug}/issue/${issueId}`);
  };

  if (isLoading) {
    return (
      <Section title="Runs">
        <View className="gap-2 px-4 py-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </View>
      </Section>
    );
  }

  // A private agent returns 403 here for a non-owner member; the rest of the
  // page stays useful, so the failure is contained to this section.
  if (error) {
    return (
      <Section title="Runs">
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

  if (active.length === 0 && past.length === 0) {
    return (
      <Section title="Runs">
        <Text className="px-4 py-4 text-sm text-muted-foreground">
          No runs yet
        </Text>
      </Section>
    );
  }

  return (
    <Section title="Runs">
      {active.length > 0 ? (
        <View className="gap-1">
          <SubHeading>Active</SubHeading>
          {active.map((task) => (
            <RunRow
              key={task.id}
              task={task}
              onPressIssue={openIssue}
            />
          ))}
        </View>
      ) : null}
      {past.length > 0 ? (
        <View className="gap-1 pt-2">
          <SubHeading>Recent</SubHeading>
          {past.slice(0, RECENT_LIMIT).map((task) => (
            <RunRow
              key={task.id}
              task={task}
              onPressIssue={openIssue}
            />
          ))}
        </View>
      ) : null}
    </Section>
  );
}

function RunRow({
  task,
  onPressIssue,
}: {
  task: AgentTask;
  onPressIssue: (issueId: string) => void;
}) {
  const { colorScheme } = useColorScheme();
  const brand = THEME[colorScheme].brand;
  const summary = task.trigger_summary?.trim() || fallbackSummary(task);
  const duration = runDurationLabel(task, Date.now());
  const timestamp = task.completed_at || task.created_at;
  const linkedIssueId = task.issue_id?.trim() ? task.issue_id : null;

  const body = (
    <View className="flex-1 gap-1">
      <Text className="text-sm text-foreground" numberOfLines={2}>
        {summary}
      </Text>
      <View className="flex-row items-center gap-2">
        <StatusBadge task={task} />
        {timestamp ? (
          <Text className="text-xs text-muted-foreground">
            {timeAgo(timestamp)}
          </Text>
        ) : null}
        {duration ? (
          <Text className="text-xs text-muted-foreground/70">
            {duration}
          </Text>
        ) : null}
        {linkedIssueId ? (
          <View className="flex-row items-center gap-0.5">
            <Text className="text-xs text-brand">Issue</Text>
            <Ionicons name="chevron-forward" size={11} color={brand} />
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
      accessibilityLabel={`Open the issue for ${summary}`}
      className="active:bg-secondary px-4 py-2.5"
    >
      {body}
    </Pressable>
  );
}

function StatusBadge({ task }: { task: AgentTask }) {
  const label = STATUS_LABEL[task.status] ?? task.status;
  const cls = STATUS_CLASS[task.status] ?? "text-muted-foreground";
  // A failed run's reason is the actionable half — same inline treatment the
  // issue Runs sheet gives it.
  if (task.status === "failed") {
    const reason = runFailureBadgeLabel(task.failure_reason);
    if (reason) {
      return (
        <Text className={`text-xs ${cls}`}>
          {label} · {reason}
        </Text>
      );
    }
  }
  return <Text className={`text-xs ${cls}`}>{label}</Text>;
}

function fallbackSummary(task: AgentTask): string {
  switch (task.kind) {
    case "comment":
      return "Comment task";
    case "autopilot":
      return "Autopilot run";
    case "chat":
      return "Chat task";
    case "quick_create":
      return "Quick create";
    case "direct":
    default:
      return "Task";
  }
}

const STATUS_LABEL: Record<AgentTask["status"], string> = {
  queued: "Queued",
  dispatched: "Starting",
  waiting_local_directory: "Waiting for directory",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<AgentTask["status"], string> = {
  queued: "text-muted-foreground",
  dispatched: "text-brand",
  waiting_local_directory: "text-muted-foreground",
  running: "text-brand",
  completed: "text-muted-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="px-4 text-xs font-medium uppercase text-muted-foreground">
        {title}
      </Text>
      <View className="border-y border-border bg-background">{children}</View>
    </View>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text className="px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </Text>
  );
}
