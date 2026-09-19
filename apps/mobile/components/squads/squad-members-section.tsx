/**
 * Squad roster — who is in the squad, read-only.
 *
 * Row set follows web's Members tab (packages/views/squads/components/
 * squad-detail-page.tsx:1090-1311): avatar, name, kind (Agent / Member) and a
 * Leader chip. Web also renders each agent's live status and its active issues,
 * which come from a separate per-squad endpoint
 * (`GET /api/squads/:id/members/status`); the mobile read-only view does not
 * spend a second request on it — the roster itself is what this screen is for.
 *
 * Names and avatars resolve from the workspace member / agent lists already in
 * the cache: a roster row carries only `member_type` + `member_id`.
 */
import { View } from "react-native";
import type { Squad, SquadMember } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useActorLookup } from "@/data/use-actor-name";
import {
  isSquadLeader,
  squadMemberCountLabel,
  squadMemberTypeLabel,
} from "@/lib/squad-display";

interface Props {
  squad: Squad;
  members: SquadMember[];
}

export function SquadMembersSection({ squad, members }: Props) {
  const { getName, getAvatarUrl } = useActorLookup();

  return (
    <View className="gap-2">
      <View className="px-4">
        <Text className="text-xs font-medium uppercase text-muted-foreground">
          Members
        </Text>
        <Text className="text-xs text-muted-foreground">
          {squadMemberCountLabel(members.length)}
        </Text>
      </View>

      {members.length === 0 ? (
        <View className="border-y border-border bg-background px-4 py-4">
          <Text className="text-sm text-muted-foreground">
            No members in this squad yet.
          </Text>
        </View>
      ) : (
        <View className="border-y border-border bg-background">
          {members.map((member, index) => {
            const type = member.member_type;
            const name = getName(type, member.member_id);
            return (
              <View key={member.id}>
                {index > 0 ? <Separator /> : null}
                <View className="flex-row items-center gap-3 px-4 py-3">
                  <ActorAvatar
                    type={type}
                    id={member.member_id}
                    name={name}
                    avatarUrl={getAvatarUrl(type, member.member_id)}
                    size={32}
                  />
                  <Text
                    className="flex-1 text-sm text-foreground"
                    numberOfLines={1}
                  >
                    {name}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {squadMemberTypeLabel(type)}
                  </Text>
                  {isSquadLeader(member, squad.leader_id) ? (
                    <View className="rounded-full bg-warning/15 px-2 py-0.5">
                      <Text className="text-xs font-medium text-warning">
                        Leader
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function Separator() {
  return <View className="ml-4 h-px bg-border" />;
}
