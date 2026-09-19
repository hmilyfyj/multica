/**
 * Skill-detail identity block: name plus the description.
 *
 * The description is the header's content, not a fact row — web puts it in
 * SkillIdentity (packages/views/skills/components/skill-detail-page.tsx:295-388)
 * for the same reason: on a phone this is the sentence that decides whether the
 * reader wants the files below it.
 */
import { View } from "react-native";
import type { SkillSummary } from "@multica/core/types";
import { Text } from "@/components/ui/text";

interface Props {
  skill: SkillSummary;
}

export function SkillDetailHeader({ skill }: Props) {
  const description = skill.description.trim();

  return (
    <View className="gap-2 px-4 py-4">
      <Text className="text-xl font-semibold text-foreground">{skill.name}</Text>
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
