/**
 * Autopilot lifecycle badge (Active / Paused / Archived) — the list row and
 * the detail header both read a lifecycle state, so the label and its colour
 * live in one place (same rule as `AgentPresenceLine`: a row's word and its
 * colour must not be able to drift apart).
 *
 * Colours ride the mobile theme tokens (`success` / `warning` / `muted`) rather
 * than web's raw `emerald-500` / `amber-500`, so light and dark mode both come
 * from `global.css`.
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { autopilotStatusLabel } from "@/lib/autopilot-display";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<string, string> = {
  active: "bg-success/15 text-success",
  paused: "bg-warning/15 text-warning",
  // Archived rows are not in this list's scope (the endpoint excludes them),
  // so this is the badge's generic fallback as much as an archived look.
  archived: "bg-muted text-muted-foreground",
};

interface Props {
  status: string;
  className?: string;
}

export function AutopilotStatusBadge({ status, className }: Props) {
  return (
    <View
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1",
        TONE_CLASS[status] ?? TONE_CLASS.archived,
        className,
      )}
    >
      <Text className="text-xs font-medium">{autopilotStatusLabel(status)}</Text>
    </View>
  );
}
