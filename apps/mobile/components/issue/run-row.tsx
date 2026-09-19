/**
 * Single row inside the agent-runs formSheet route
 * (`app/(app)/[workspace]/issue/[id]/runs.tsx`). Same component for active
 * and past tasks —
 * the trailing Cancel button is conditional on `status in {queued,
 * dispatched, running}`, and the status badge / colour swaps based on the
 * AgentTask.status enum.
 *
 * Tapping the row opens the run-detail sheet
 * (`issue/[id]/runs/[taskId]`), and every row also carries an inline "Steps"
 * fold that reads the run's timeline without leaving the list. The status
 * badge and cancel button are exported because that detail sheet renders the
 * same two things in its header — one definition of "Failed · Timeout" and of
 * what cancelling a run asks.
 */
import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { RunStepsFold } from "@/components/issue/run-steps-fold";
import { useCancelTask } from "@/data/mutations/issues";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspaceStore } from "@/data/workspace-store";
import { isActiveTask } from "@/lib/agent-runs";
import { runFailureBadgeLabel } from "@/lib/run-failure-badge";
import { timeAgo } from "@/lib/time-ago";

interface Props {
  task: AgentTask;
  issueId: string;
}

export function RunRow({ task, issueId }: Props) {
  const { getName } = useActorLookup();
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  // Same active definition as web (`isActiveCommentRun`) and as the rest of
  // this app — `lib/agent-runs.ts` owns it so the row, the detail sheet and
  // the agents list can't drift on what "still running" means.
  const isActive = isActiveTask(task);
  const summary = task.trigger_summary?.trim() || fallbackSummary(task);
  // Past tasks use completed_at when present (server fills it for terminal
  // statuses); active tasks fall back to created_at so the user sees how
  // long it's been waiting.
  const timestamp = task.completed_at || task.created_at;

  const openDetail = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/issue/[id]/runs/[taskId]",
      params: { workspace: wsSlug, id: issueId, taskId: task.id },
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${getName("agent", task.agent_id)} run: ${summary}`}
      onPress={openDetail}
      className="flex-row items-start gap-3 py-2 active:opacity-70"
    >
      <ActorAvatar type="agent" id={task.agent_id} size={28} showPresence />
      <View className="flex-1 gap-1">
        <Text className="text-sm text-foreground" numberOfLines={2}>
          <Text className="font-medium">{getName("agent", task.agent_id)}</Text>
          <Text className="text-muted-foreground"> · {summary}</Text>
        </Text>
        <View className="flex-row items-center gap-2">
          <RunStatusBadge task={task} />
          <Text className="text-xs text-muted-foreground">
            {timestamp ? timeAgo(timestamp) : ""}
          </Text>
        </View>
        <RunStepsFold taskId={task.id} isStreaming={isActive} />
      </View>
      {isActive ? (
        <RunCancelButton taskId={task.id} issueId={issueId} />
      ) : (
        <Ionicons
          name="chevron-forward"
          size={16}
          color="#71717a"
          style={{ marginTop: 6 }}
        />
      )}
    </Pressable>
  );
}

export function RunStatusBadge({ task }: { task: AgentTask }) {
  const label = STATUS_LABEL[task.status] ?? task.status;
  const cls = STATUS_CLASS[task.status] ?? "text-muted-foreground";
  // For failed tasks, surface the failure_reason inline so users don't have
  // to drill in. Missing / empty / unrecognised stays as just "Failed".
  if (task.status === "failed") {
    const reasonLabel = runFailureBadgeLabel(task.failure_reason);
    if (reasonLabel) {
      return (
        <Text className={`text-xs ${cls}`}>
          {label} · {reasonLabel}
        </Text>
      );
    }
  }
  return <Text className={`text-xs ${cls}`}>{label}</Text>;
}

export function RunCancelButton({
  taskId,
  issueId,
}: {
  taskId: string;
  issueId: string;
}) {
  const mutation = useCancelTask(issueId);

  const onPress = () => {
    Alert.alert(
      "Cancel task?",
      "The agent will stop after the current step.",
      [
        { text: "Keep running", style: "cancel" },
        {
          text: "Cancel task",
          style: "destructive",
          onPress: () => mutation.mutate(taskId),
        },
      ],
    );
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={mutation.isPending}
      className="px-3 py-1.5 rounded-md bg-secondary active:opacity-70"
    >
      <Text className="text-xs font-medium text-foreground">Cancel</Text>
    </Pressable>
  );
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
