/**
 * Agent-detail facts: current state (derived presence + model + runtime) and
 * read-only identity fields, in the iOS Settings row shape the project detail
 * screen uses (label left, value right, full-width separators, no chevron —
 * nothing here is tappable in a read-only view).
 *
 * The section owns its lookups: presence comes from `useAgentPresence` (the
 * same derivation that paints every dot in the app), the runtime name from the
 * workspace runtime list, and the owner name from `useActorLookup`. The route
 * only passes the agent it already resolved from the agent list.
 */
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@multica/core/types";
import { visibilityLabel } from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { AgentPresenceLine } from "@/components/agents/agent-presence-line";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAgentPresence } from "@/lib/use-agent-presence";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";

interface Props {
  agent: Agent;
}

export function AgentFactsSection({ agent }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const presence = useAgentPresence(wsId, agent.id);
  const { getName } = useActorLookup();

  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const runtime = runtimes.find((r) => r.id === agent.runtime_id) ?? null;

  const runtimeBound = isAgentRuntimeBound(agent);
  const ownerName = agent.owner_id
    ? getName("member", agent.owner_id)
    : "—";

  return (
    <View className="gap-6">
      <Group title="Status">
        <Row
          label="Presence"
          value={
            <AgentPresenceLine
              presence={presence === "loading" ? null : presence}
            />
          }
        />
        <Separator />
        <Row
          label="Model"
          value={
            <Text className="text-sm text-foreground" numberOfLines={1}>
              {agent.model || "—"}
            </Text>
          }
        />
        <Separator />
        <Row
          label="Runtime"
          value={
            <Text
              className={
                runtimeBound
                  ? "text-sm text-foreground"
                  : "text-sm text-warning"
              }
              numberOfLines={1}
            >
              {runtime?.name ?? (runtimeBound ? "—" : "Needs a runtime")}
            </Text>
          }
        />
      </Group>

      <Group title="Details">
        <Row
          label="Owner"
          value={
            <Text className="text-sm text-foreground" numberOfLines={1}>
              {ownerName}
            </Text>
          }
        />
        <Separator />
        <Row
          label="Access"
          value={
            <Text className="text-sm text-foreground">
              {visibilityLabel(agent.visibility)}
            </Text>
          }
        />
        <Separator />
        <Row
          label="Concurrency"
          value={
            <Text className="text-sm text-foreground tabular-nums">
              {String(agent.max_concurrent_tasks)}
            </Text>
          }
        />
        <Separator />
        <Row
          label="Created"
          value={
            <Text className="text-sm text-foreground">
              {formatCreatedAt(agent.created_at)}
            </Text>
          }
        />
      </Group>
    </View>
  );
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Group({
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-4 px-4 py-3">
      <Text className="text-sm text-foreground">{label}</Text>
      <View className="flex-1 items-end">{value}</View>
    </View>
  );
}

function Separator() {
  return <View className="ml-4 h-px bg-border" />;
}
