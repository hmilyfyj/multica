/**
 * Skills-list row. Same shape as the other read-only rows (identity first, a
 * muted detail line, a trailing timestamp).
 *
 *   audit-website                                 2d ago
 *   From GitHub
 *
 * The trailing stamp is `updated_at` — the field this list sorts by and the one
 * web's Updated column shows (packages/views/skills/components/skills-page.tsx).
 * Web's other columns are dropped on purpose: Used by needs the agent-skill
 * assignment caches and the row is the only place they would be read, while
 * Creator / Created are in the detail.
 */
import { Pressable, View } from "react-native";
import type { SkillSummary } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { useSkillOriginLabel } from "@/lib/use-skill-origin-label";
import { timeAgo } from "@/lib/time-ago";

interface Props {
  skill: SkillSummary;
  onPress: () => void;
}

export function SkillRow({ skill, onPress }: Props) {
  const sourceLabel = useSkillOriginLabel(skill);

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={skill.name}
      className="active:bg-secondary px-4 py-3"
    >
      <View className="gap-1">
        <View className="flex-row items-start gap-3">
          <Text
            className="flex-1 text-base font-medium text-foreground"
            numberOfLines={1}
          >
            {skill.name}
          </Text>
          <Text className="pt-0.5 text-[11px] text-muted-foreground/70">
            {skill.updated_at ? timeAgo(skill.updated_at) : "—"}
          </Text>
        </View>
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {sourceLabel}
        </Text>
      </View>
    </Pressable>
  );
}
