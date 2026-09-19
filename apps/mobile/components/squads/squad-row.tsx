/**
 * Squads-list row. Same shape as `AgentRow` / `AutopilotRow` / `RuntimeRow`
 * (identity on the left, a muted detail line, a trailing value) so the list
 * screens read as one app.
 *
 *   [avatar] Reviewers                     5 members
 *            Leader Reviewer
 *
 * Both values come from the list payload: the count is server-derived
 * (server/internal/handler/squad.go `applySquadMemberSummary`) and the leader is
 * `leader_id`, which the screen resolves to a name through the agent list it
 * already holds. A row therefore never fetches the roster — web's Members cell
 * renders an avatar stack from the same payload (squads-page.tsx:213-248), which
 * buys nothing a phone-sized row can use.
 */
import { Pressable, View } from "react-native";
import type { Squad } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { squadLeaderLabel, squadMemberCountLabel } from "@/lib/squad-display";

interface Props {
  squad: Squad;
  /** Resolved leader name, or null while the agent list is still resolving. */
  leaderName: string | null;
  onPress: () => void;
}

export function SquadRow({ squad, leaderName, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={squad.name}
      className="active:bg-secondary px-4 py-3"
    >
      <View className="flex-row items-start gap-3">
        <ActorAvatar
          type="squad"
          id={squad.id}
          name={squad.name}
          avatarUrl={squad.avatar_url}
          size={40}
        />
        <View className="flex-1 gap-1">
          <Text className="text-base font-medium text-foreground" numberOfLines={1}>
            {squad.name}
          </Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {`Leader ${squadLeaderLabel(squad.leader_id, leaderName)}`}
          </Text>
        </View>
        <Text className="pt-0.5 text-[11px] text-muted-foreground/70">
          {squadMemberCountLabel(squad.member_count ?? 0)}
        </Text>
      </View>
    </Pressable>
  );
}
