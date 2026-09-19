/**
 * Agents-list row. Mirrors the IssueRow / ProjectRow shape used across the
 * list screens (left avatar, flex middle column, trailing time column), per
 * apps/mobile/AGENTS.md "Visual alignment is baseline".
 *
 *   [avatar]  Name                         2d ago
 *             ● Online · Working 1/3
 *             claude-sonnet-4-5
 *
 * Everything the row shows comes from the caller: the workspace agent list
 * gives identity/model, `useWorkspacePresenceMap` gives the derived presence
 * (one map for the whole list rather than one subscription per row), and the
 * task snapshot gives the last-activity timestamp. `showPresence` stays off
 * on the avatar — the dot belongs to the presence line below, and one dot per
 * row is enough.
 */
import { Pressable, View } from "react-native";
import type { Agent } from "@multica/core/types";
import type { AgentPresenceDetail } from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { AgentPresenceLine } from "@/components/agents/agent-presence-line";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { timeAgo } from "@/lib/time-ago";

interface Props {
  agent: Agent;
  /** Derived presence, or null while the workspace queries are resolving. */
  presence: AgentPresenceDetail | null;
  /** Latest task activity for this agent; null when it has never run. */
  lastActivityAt: string | null;
  onPress: () => void;
}

export function AgentRow({ agent, presence, lastActivityAt, onPress }: Props) {
  const runtimeBound = isAgentRuntimeBound(agent);

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={agent.name}
      className="active:bg-secondary px-4 py-3"
    >
      <View className="flex-row items-start gap-3">
        <ActorAvatar
          type="agent"
          id={agent.id}
          name={agent.name}
          avatarUrl={agent.avatar_url}
          size={40}
        />
        <View className="flex-1 gap-1">
          <Text
            className="text-base font-medium text-foreground"
            numberOfLines={1}
          >
            {agent.name}
          </Text>
          <AgentPresenceLine presence={presence} />
          <Text
            className={
              runtimeBound
                ? "text-xs text-muted-foreground"
                : "text-xs text-warning"
            }
            numberOfLines={1}
          >
            {runtimeBound ? agent.model : "Needs a runtime"}
          </Text>
        </View>
        <View className="items-end gap-1 pt-0.5">
          <Text className="text-[11px] text-muted-foreground/70">
            {lastActivityAt ? timeAgo(lastActivityAt) : "No activity"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
