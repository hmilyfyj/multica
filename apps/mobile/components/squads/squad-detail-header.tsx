/**
 * Squad-detail identity block: the squad's name and description.
 *
 * Same split as `AgentDetailHeader` / `RuntimeDetailHeader` — identity here,
 * labelled facts in `SquadFactsSection` — so the squad name appears once on the
 * screen and the description sits where a reader looks for it first. Web puts the
 * same pair at the top of its detail page (packages/views/squads/components/
 * squad-detail-page.tsx, `SquadOverviewPane`).
 */
import { View } from "react-native";
import type { Squad } from "@multica/core/types";
import { Text } from "@/components/ui/text";

interface Props {
  squad: Squad;
}

export function SquadDetailHeader({ squad }: Props) {
  const description = squad.description.trim();

  return (
    <View className="gap-2 px-4 py-4">
      <Text className="text-xl font-semibold text-foreground">{squad.name}</Text>
      {description ? (
        <Text className="text-sm text-muted-foreground">{description}</Text>
      ) : (
        <Text className="text-sm italic text-muted-foreground/70">
          No description
        </Text>
      )}
    </View>
  );
}
