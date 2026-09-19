/**
 * Agent-detail identity block: avatar, name, description, and the two
 * lifecycle badges a read-only view must surface (archived / unbound
 * runtime).
 *
 * Text-only composition — presence lives in `AgentFactsSection` so the agent's
 * state has exactly one home on this screen.
 */
import { View } from "react-native";
import type { Agent } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { cn } from "@/lib/utils";

interface Props {
  agent: Agent;
}

export function AgentDetailHeader({ agent }: Props) {
  const runtimeBound = isAgentRuntimeBound(agent);
  const archived = !!agent.archived_at;

  return (
    <View className="flex-row items-start gap-4 px-4 py-4">
      <ActorAvatar
        type="agent"
        id={agent.id}
        name={agent.name}
        avatarUrl={agent.avatar_url}
        size={64}
      />
      <View className="flex-1 gap-1.5">
        <Text className="text-xl font-semibold text-foreground">
          {agent.name}
        </Text>
        {agent.description ? (
          <Text className="text-sm text-muted-foreground">
            {agent.description}
          </Text>
        ) : (
          <Text className="text-sm italic text-muted-foreground/70">
            No description
          </Text>
        )}
        {archived || !runtimeBound ? (
          <View className="flex-row flex-wrap gap-2 pt-0.5">
            {archived ? <Badge>Archived</Badge> : null}
            {!runtimeBound ? (
              <Badge tone="warning">Needs a runtime</Badge>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Local pill for the lifecycle badges — no shared badge primitive exists in
 *  `components/ui/` and these are the only two call sites. */
function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "warning";
}) {
  return (
    <View
      className={cn(
        "rounded-full px-2.5 py-1",
        tone === "warning" ? "bg-warning/15" : "bg-muted",
      )}
    >
      <Text
        className={cn(
          "text-xs",
          tone === "warning" ? "text-warning" : "text-muted-foreground",
        )}
      >
        {children}
      </Text>
    </View>
  );
}
