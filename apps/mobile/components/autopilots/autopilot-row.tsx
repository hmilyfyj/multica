/**
 * Autopilot list row. Same shape as `AgentRow` / `IssueRow` (title, a muted
 * detail line, a trailing timestamp column) so the three list screens read as
 * one app.
 *
 *   Title                                       2h ago
 *   [Active]  Schedule · Webhook
 *   Next run Sep 22, 2026, 9:00 AM
 *
 * Every value is the caller's: the list endpoint already carries the three
 * derived columns this row renders — `trigger_kinds` and `next_run_at` (enabled
 * triggers only) and the most recent run's `status` / `last_run_at` — so the row
 * never reaches into the detail endpoint per autopilot.
 */
import { Pressable, View } from "react-native";
import type { Autopilot } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { AutopilotStatusBadge } from "@/components/autopilots/autopilot-status-badge";
import { RunStatusLabel } from "@/components/autopilots/run-status-label";
import { formatAbsoluteTime, triggerKindsSummary } from "@/lib/autopilot-display";
import { timeAgo } from "@/lib/time-ago";

interface Props {
  autopilot: Autopilot;
  onPress: () => void;
}

export function AutopilotRow({ autopilot, onPress }: Props) {
  const kinds = triggerKindsSummary(autopilot.trigger_kinds);
  const lastRunStatus = autopilot.last_run_status ?? null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={autopilot.title}
      className="active:bg-secondary px-4 py-3"
    >
      <View className="gap-1.5">
        <View className="flex-row items-start gap-3">
          <Text
            className="flex-1 text-base font-medium text-foreground"
            numberOfLines={1}
          >
            {autopilot.title}
          </Text>
          <Text className="pt-0.5 text-[11px] text-muted-foreground/70">
            {autopilot.last_run_at ? timeAgo(autopilot.last_run_at) : "No runs"}
          </Text>
        </View>

        <View className="flex-row items-center gap-2">
          <AutopilotStatusBadge status={autopilot.status} />
          <Text
            className="flex-1 text-xs text-muted-foreground"
            numberOfLines={1}
          >
            {kinds || "No trigger"}
          </Text>
          {/* The most recent delivery's outcome, as a word rather than a bare
              dot: on a phone the dot alone cannot be read without a legend. */}
          {lastRunStatus ? <RunStatusLabel status={lastRunStatus} /> : null}
        </View>

        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {autopilot.next_run_at
            ? `Next run ${formatAbsoluteTime(autopilot.next_run_at)}`
            : "No upcoming run"}
        </Text>
      </View>
    </Pressable>
  );
}
