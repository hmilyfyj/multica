/**
 * Autopilot detail identity block: title, lifecycle badge, description, the
 * system-pause banner, and the one write this screen offers — "Run now".
 *
 * Presentational on purpose: the route owns the mutation and the alert copy, so
 * this component only decides what the control looks like and when it is
 * offered.
 */
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Autopilot } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AutopilotStatusBadge } from "@/components/autopilots/autopilot-status-badge";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface Props {
  autopilot: Autopilot;
  /** The run-now request is in flight. */
  isRunning: boolean;
  onRunNow: () => void;
}

export function AutopilotDetailHeader({
  autopilot,
  isRunning,
  onRunNow,
}: Props) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  // `can_write === false` hides the control, exactly as web does; an absent
  // flag means "unknown" on an older server, and the server stays the write
  // gate, so the button is offered rather than assumed denied.
  const canWrite = autopilot.can_write !== false;
  const runtimeRequired = autopilot.pause_reason === "agent_runtime_required";

  return (
    <View className="gap-4 px-4 py-4">
      <View className="gap-1.5">
        <Text className="text-xl font-semibold text-foreground">
          {autopilot.title}
        </Text>
        {autopilot.description ? (
          <Text className="text-sm text-muted-foreground">
            {autopilot.description}
          </Text>
        ) : (
          <Text className="text-sm italic text-muted-foreground/70">
            No description
          </Text>
        )}
      </View>

      <View className="flex-row items-center gap-3">
        <AutopilotStatusBadge status={autopilot.status} />
        <View className="flex-1" />
        {canWrite ? (
          <Button
            size="sm"
            onPress={onRunNow}
            // A paused or archived autopilot cannot be triggered — the server
            // answers 400 — so the control must not invite the attempt.
            disabled={autopilot.status !== "active" || isRunning}
            accessibilityLabel={isRunning ? "Running" : "Run now"}
          >
            <Ionicons
              name={isRunning ? "hourglass-outline" : "play"}
              size={14}
              color={theme.primaryForeground}
            />
            <Text>{isRunning ? "Running..." : "Run now"}</Text>
          </Button>
        ) : null}
      </View>

      {runtimeRequired ? (
        <View className="flex-row items-center gap-2 rounded-md bg-warning/15 px-3 py-2">
          <Ionicons name="server-outline" size={14} color={theme.warning} />
          <Text className="flex-1 text-xs text-warning">
            Paused — the assignee needs a runtime
          </Text>
        </View>
      ) : null}
    </View>
  );
}
