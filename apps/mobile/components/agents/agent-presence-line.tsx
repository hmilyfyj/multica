/**
 * Presence line for the Agents views: dot + availability + workload
 * (+ running/capacity while the agent has work running).
 *
 * The two dimensions come from `AgentPresenceDetail`
 * (`packages/core/agents/derive-presence.ts`) — never re-derived here; this
 * component only maps them to words and colour via the existing
 * `PresenceDot`. Words mirror the en locale bundle
 * (`packages/views/locales/en/agents.json` → `availability.*` / `workload.*`);
 * mobile v1 is English-only, and keeping both maps beside the dot is what
 * stops a row's word and its colour from drifting apart.
 *
 * `null` presence = the caller's queries are still resolving; renders the
 * same em-dash placeholder the project row uses for an unknown value instead
 * of guessing a colour.
 */
import { View } from "react-native";
import type {
  AgentAvailability,
  AgentPresenceDetail,
  Workload,
} from "@multica/core/agents";
import { Text } from "@/components/ui/text";
import { PresenceDot } from "@/components/ui/presence-dot";
import { cn } from "@/lib/utils";

const AVAILABILITY_LABEL: Record<AgentAvailability, string> = {
  online: "Online",
  unstable: "Unstable",
  offline: "Offline",
  archived: "Archived",
};

const WORKLOAD_LABEL: Record<Workload, string> = {
  working: "Working",
  queued: "Queued",
  idle: "Idle",
};

interface Props {
  presence: AgentPresenceDetail | null;
  className?: string;
}

export function AgentPresenceLine({ presence, className }: Props) {
  if (!presence) {
    return (
      <Text
        className={cn("text-xs text-muted-foreground/60", className)}
      >
        —
      </Text>
    );
  }

  const { availability, workload, runningCount, capacity } = presence;
  // Only show the ratio when there is something running — "0/3" on an idle
  // agent is noise, and capacity 0 (unknown) would read as a broken ratio.
  const ratio =
    runningCount > 0 && capacity > 0 ? ` ${runningCount}/${capacity}` : "";

  return (
    <View className={cn("flex-row items-center gap-1.5", className)}>
      <PresenceDot availability={availability} />
      <Text
        className="text-xs text-muted-foreground"
        numberOfLines={1}
      >
        {AVAILABILITY_LABEL[availability]}
        {" · "}
        {WORKLOAD_LABEL[workload]}
        {ratio}
      </Text>
    </View>
  );
}
