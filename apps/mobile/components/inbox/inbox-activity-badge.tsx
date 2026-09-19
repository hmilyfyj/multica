/**
 * "An agent is working on this issue right now" cue for an inbox row — the
 * phone's counterpart of web's IssueAgentActivityIndicator
 * (packages/views/issues/components/issue-agent-activity-indicator.tsx), as
 * web's own inbox row mounts it: the badge alone, no hover card (web passes
 * `hoverCard={false}` there, and a touch row has no hover to give it anyway).
 *
 *   ≥1 running task      → avatar stack + pulse dot + "Working" (brand)
 *   0 running, ≥1 queued → half-opacity stack + "Queued" (muted)
 *   neither              → null — no chrome, no placeholder
 *
 * The "alive" signal rides the PulseDot rather than web's text shimmer: the
 * shimmer is a CSS `background-clip: text` effect with no RN equivalent, and
 * a pulsing brand dot is what this app already uses for a running agent
 * (agent-activity-row.tsx, agent-header-badge.tsx). Both tones are semantic
 * tokens (`text-brand` / `text-muted-foreground`), so light and dark carry
 * the same reading. It renders nothing when no agent is active, so an inbox
 * with nothing running looks exactly as it did before this existed.
 *
 * Data comes from the ONE shared workspace agent-task snapshot with web's
 * per-issue `select` (lib/issue-activity.ts): a row issues no request of its
 * own, and React Query's structural sharing keeps the selected value stable
 * while other issues' tasks move, so a snapshot invalidation does not
 * re-render every row.
 */
import { useCallback } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { AvatarStack, type StackActor } from "@/components/ui/avatar-stack";
import { PulseDot } from "@/components/ui/pulse-dot";
import { agentTaskSnapshotOptions } from "@/data/queries/agent-task-snapshot";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  AGENT_ACTIVITY_LABEL,
  deriveIssueAgentActivity,
} from "@/lib/issue-activity";
import { cn } from "@/lib/utils";

/** 16pt keeps the stack a cue, not a third line of content. */
const AVATAR_SIZE = 16;

interface Props {
  issueId: string | null | undefined;
}

export function InboxActivityBadge({ issueId }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const select = useCallback(
    (snapshot: AgentTask[]) => deriveIssueAgentActivity(snapshot, issueId),
    [issueId],
  );
  const { data: activity } = useQuery({
    ...agentTaskSnapshotOptions(wsId),
    select,
  });

  if (!activity) return null;

  const actors = activity.agentIds.map<StackActor>((id) => ({
    type: "agent",
    id,
  }));
  const isRunning = activity.kind === "running";

  return (
    <View className="flex-row items-center gap-1 shrink-0">
      {/* Half opacity is web's "queued" stack treatment (opacity-* is the
          NativeWind equivalent, and dimming the faces reads as "not started
          yet" without a second colour token). */}
      <View className={isRunning ? undefined : "opacity-50"}>
        <AvatarStack actors={actors} max={3} size={AVATAR_SIZE} />
      </View>
      {isRunning ? <PulseDot size={5} /> : null}
      <Text
        className={cn(
          "text-xs",
          isRunning ? "text-brand" : "text-muted-foreground",
        )}
      >
        {AGENT_ACTIVITY_LABEL[activity.kind]}
      </Text>
    </View>
  );
}
