/**
 * Squad-detail facts — the read-only identity of one squad, in the iOS Settings
 * row shape the agent / runtime / autopilot details use (label left, value
 * right, full-width separators, nothing tappable).
 *
 * Row set follows web's inspector (packages/views/squads/components/
 * squad-detail-page.tsx:716-818): Leader / Members / Created by / Created /
 * Updated. Manager-only actions web puts in that rail (Archive, rename, leader
 * transfer) are out of scope — the mobile view is read-only.
 *
 * Leader and creator names resolve from the workspace lists already in the
 * cache, so the section costs no request of its own.
 */
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Squad } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { agentListOptions } from "@/data/queries/agents";
import { useActorLookup } from "@/data/use-actor-name";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  findSquadLeaderName,
  squadLeaderLabel,
  squadMemberCountLabel,
} from "@/lib/squad-display";

interface Props {
  squad: Squad;
}

export function SquadFactsSection({ squad }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { getName, getAvatarUrl } = useActorLookup();

  // Null when the leader has been deleted, which is what lets the label fall
  // back to the id prefix instead of printing a generic "Unknown Agent".
  const leaderName = findSquadLeaderName(squad.leader_id, agents);
  const creatorName = squad.creator_id ? getName("member", squad.creator_id) : null;

  return (
    <View className="gap-2">
      <Text className="px-4 text-xs font-medium uppercase text-muted-foreground">
        Details
      </Text>
      <View className="border-y border-border bg-background">
        <Row
          label="Leader"
          value={
            <ActorValue
              type="agent"
              id={squad.leader_id}
              name={squadLeaderLabel(squad.leader_id, leaderName)}
              avatarUrl={getAvatarUrl("agent", squad.leader_id)}
            />
          }
        />
        <Separator />
        <Row
          label="Members"
          value={<Value>{squadMemberCountLabel(squad.member_count ?? 0)}</Value>}
        />
        <Separator />
        <Row
          label="Created by"
          value={
            squad.creator_id && creatorName ? (
              <ActorValue
                type="member"
                id={squad.creator_id}
                name={creatorName}
                avatarUrl={getAvatarUrl("member", squad.creator_id)}
              />
            ) : (
              <Value>—</Value>
            )
          }
        />
        <Separator />
        <Row label="Created" value={<Value>{formatDate(squad.created_at)}</Value>} />
        <Separator />
        <Row label="Updated" value={<Value>{formatDate(squad.updated_at)}</Value>} />
      </View>
    </View>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-sm text-foreground" numberOfLines={1}>
      {children}
    </Text>
  );
}

function ActorValue({
  type,
  id,
  name,
  avatarUrl,
}: {
  type: "member" | "agent";
  id: string;
  name: string;
  avatarUrl: string | null;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <ActorAvatar type={type} id={id} name={name} avatarUrl={avatarUrl} size={20} />
      <Text className="text-sm text-foreground" numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "—";
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
