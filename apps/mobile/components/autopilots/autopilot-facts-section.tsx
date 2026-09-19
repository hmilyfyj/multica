/**
 * Autopilot detail facts — the read-only identity of the automation, in the
 * iOS Settings row shape the agent/project detail screens use (label left, value
 * right, full-width separators, no chevron: nothing here is tappable).
 *
 * The section owns its lookups: assignee and creator names come from the shared
 * actor lookup (member/agent/squad lists already in the cache) and the project
 * name from the workspace project list — the same cache-only reads
 * `AgentFactsSection` does for its runtime name. Output mode and the project both
 * matter beyond cosmetics: they decide whether a run produces an issue and where
 * it executes.
 */
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Autopilot } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { projectListOptions } from "@/data/queries/projects";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspaceStore } from "@/data/workspace-store";
import { executionModeLabel } from "@/lib/autopilot-display";

/** The actor vocabulary the avatar and the name lookup accept. */
type ActorType = "member" | "agent" | "squad";

/**
 * `assignee_type` is the two-value union, but `created_by_type` is a plain
 * string on the wire (the server stamps a member for HTTP creation and an agent
 * for agent-created rows). Narrowing instead of casting means an actor kind this
 * build does not know degrades to the generic actor — never a crash, and never a
 * silently wrong avatar.
 */
function actorType(value: string): ActorType | null {
  return value === "member" || value === "agent" || value === "squad"
    ? value
    : null;
}

interface Props {
  autopilot: Autopilot;
}

export function AutopilotFactsSection({ autopilot }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { getName, getAvatarUrl } = useActorLookup();
  const { data: projects = [] } = useQuery(projectListOptions(wsId));

  const assignee = actorType(autopilot.assignee_type);
  const creator = actorType(autopilot.created_by_type);

  const project = autopilot.project_id
    ? (projects.find((p) => p.id === autopilot.project_id) ?? null)
    : null;
  const projectName = autopilot.project_id
    ? (project?.title ?? "Unavailable")
    : "No project";

  return (
    <View className="gap-2">
      <Text className="px-4 text-xs font-medium uppercase text-muted-foreground">
        Details
      </Text>
      <View className="border-y border-border bg-background">
        <Row
          label="Assignee"
          value={
            <ActorValue
              type={assignee}
              id={autopilot.assignee_id}
              name={getName(assignee, autopilot.assignee_id)}
              avatarUrl={getAvatarUrl(assignee, autopilot.assignee_id)}
            />
          }
        />
        <Separator />
        <Row
          label="Created by"
          value={
            <ActorValue
              type={creator}
              id={autopilot.created_by_id}
              name={getName(creator, autopilot.created_by_id)}
              avatarUrl={getAvatarUrl(creator, autopilot.created_by_id)}
            />
          }
        />
        <Separator />
        <Row
          label="Output mode"
          value={
            <Text className="text-sm text-foreground">
              {executionModeLabel(autopilot.execution_mode)}
            </Text>
          }
        />
        <Separator />
        <Row
          label="Project"
          value={
            <Text className="text-sm text-foreground" numberOfLines={1}>
              {projectName}
            </Text>
          }
        />
        <Separator />
        <Row
          label="Created"
          value={
            <Text className="text-sm text-foreground">
              {formatCreatedAt(autopilot.created_at)}
            </Text>
          }
        />
      </View>
    </View>
  );
}

function ActorValue({
  type,
  id,
  name,
  avatarUrl,
}: {
  type: ActorType | null;
  id: string;
  name: string;
  avatarUrl: string | null;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <ActorAvatar
        type={type}
        id={id}
        name={name}
        avatarUrl={avatarUrl}
        size={20}
      />
      <Text className="text-sm text-foreground" numberOfLines={1}>
        {name}
      </Text>
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
