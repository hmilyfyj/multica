/**
 * Runtime-detail identity block: display name, health pill, last heartbeat and
 * the device line the daemon composed. Text and pill only — every labelled fact
 * lives in `RuntimeFactsSection`, so each value has exactly one home on the
 * screen (the split `AgentDetailHeader` / `AgentFactsSection` already uses).
 *
 * Last-seen is a compound relative timestamp ("2m 14s ago"), the same precision
 * web puts next to the runtime's name (packages/views/runtimes/components/
 * runtime-detail.tsx `HeroCard`): "just lost" and "long gone" are different
 * problems and this line is where the difference is legible.
 */
import { View } from "react-native";
import type { AgentRuntime } from "@multica/core/types";
import { deriveRuntimeHealth, runtimeDisplayName } from "@multica/core/runtimes";
import { Text } from "@/components/ui/text";
import { RuntimeHealthBadge } from "@/components/runtimes/runtime-health-badge";
import { formatLastSeen, splitDeviceInfo } from "@/lib/runtime-display";

interface Props {
  runtime: AgentRuntime;
}

export function RuntimeDetailHeader({ runtime }: Props) {
  const health = deriveRuntimeHealth(runtime, Date.now());
  const device = runtime.device_info ? splitDeviceInfo(runtime.device_info) : null;

  return (
    <View className="gap-2 px-4 py-4">
      <Text className="text-xl font-semibold text-foreground">
        {runtimeDisplayName(runtime)}
      </Text>
      <View className="flex-row flex-wrap items-center gap-2">
        <RuntimeHealthBadge health={health} />
        <Text className="text-xs text-muted-foreground">
          Last seen {formatLastSeen(runtime.last_seen_at)}
        </Text>
      </View>
      {device?.hostname ? (
        <Text className="font-mono text-xs text-muted-foreground" numberOfLines={1}>
          {device.hostname}
        </Text>
      ) : null}
    </View>
  );
}
