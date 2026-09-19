/**
 * Runtime health pill — the four derived states of `deriveRuntimeHealth`
 * (online / recently_lost / offline / long_offline). The word and its colour
 * live in one place so the list row and the detail header cannot drift apart
 * (the same rule `AutopilotStatusBadge` follows).
 *
 * Colours ride the mobile theme tokens (success / warning / muted / destructive)
 * instead of web's raw palette, so light and dark both come from `global.css`.
 * The dot carries the state at a glance, the word carries it without one — on a
 * phone a bare dot has nowhere to put a legend.
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { runtimeHealthLabel } from "@/lib/runtime-display";
import { cn } from "@/lib/utils";

const DOT_CLASS: Record<string, string> = {
  online: "bg-success",
  recently_lost: "bg-warning",
  offline: "bg-muted-foreground/40",
  long_offline: "bg-destructive",
};

const PILL_CLASS: Record<string, string> = {
  online: "bg-success/15 text-success",
  recently_lost: "bg-warning/15 text-warning",
  offline: "bg-muted text-muted-foreground",
  long_offline: "bg-destructive/15 text-destructive",
};

/** Offline's muted treatment doubles as the fallback for an unknown state. */
const FALLBACK_PILL = "bg-muted text-muted-foreground";
const FALLBACK_DOT = "bg-muted-foreground/40";

interface Props {
  health: string;
  className?: string;
}

export function RuntimeHealthBadge({ health, className }: Props) {
  return (
    <View
      className={cn(
        "shrink-0 flex-row items-center gap-1.5 rounded-full px-2.5 py-1",
        PILL_CLASS[health] ?? FALLBACK_PILL,
        className,
      )}
    >
      <View
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          DOT_CLASS[health] ?? FALLBACK_DOT,
        )}
      />
      <Text className="text-xs font-medium">{runtimeHealthLabel(health)}</Text>
    </View>
  );
}
