/**
 * Squad instructions — the leader's standing brief for this squad, read-only.
 *
 * Web renders the same body in an editor inside the Instructions tab
 * (packages/views/squads/components/squad-detail-page.tsx:1314+, locale key
 * `instructions_tab`); the copy here is that tab's description verbatim, because
 * the sentence is what tells a reader who these instructions are for.
 *
 * The body is selectable text rather than a disabled input: on a phone a
 * half-height scroll box inside a scrolling page is worse than letting the page
 * scroll the text.
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";

interface Props {
  instructions: string;
}

export function SquadInstructionsSection({ instructions }: Props) {
  const body = instructions.trim();

  return (
    <View className="gap-2">
      <Text className="px-4 text-xs font-medium uppercase text-muted-foreground">
        Instructions
      </Text>
      <Text className="px-4 text-xs text-muted-foreground">
        The leader reads these instructions whenever it works on an issue
        assigned to this squad.
      </Text>
      <View className="border-y border-border bg-background px-4 py-4">
        {body ? (
          <Text selectable className="text-sm text-foreground">
            {body}
          </Text>
        ) : (
          <Text className="text-sm italic text-muted-foreground/70">
            No instructions for this squad.
          </Text>
        )}
      </View>
    </View>
  );
}
