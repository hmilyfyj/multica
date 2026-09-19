/**
 * Run status text with its outcome colour. Shared by the list row's "last run"
 * and the detail's run history so the two cannot disagree about what a status
 * looks like — the same reason `AgentPresenceLine` owns its own colour map.
 *
 * The palette decision lives in `lib/autopilot-display.ts:runStatusTone`
 * (mirroring web's `RUN_VISUAL`); this file only maps a tone onto the mobile
 * theme tokens. A live run uses `brand`, the same colour the agent run rows use
 * for work in flight.
 */
import { Text } from "@/components/ui/text";
import { runStatusLabel, runStatusTone, type RunStatusTone } from "@/lib/autopilot-display";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<RunStatusTone, string> = {
  info: "text-brand",
  running: "text-brand",
  success: "text-success",
  failure: "text-destructive",
  muted: "text-muted-foreground",
};

interface Props {
  status: string;
  className?: string;
}

export function RunStatusLabel({ status, className }: Props) {
  return (
    <Text
      className={cn("text-xs font-medium", TONE_CLASS[runStatusTone(status)], className)}
      numberOfLines={1}
    >
      {runStatusLabel(status)}
    </Text>
  );
}
