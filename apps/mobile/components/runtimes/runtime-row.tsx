/**
 * Runtimes-list row. Same shape as `AgentRow` / `AutopilotRow` / `IssueRow`
 * (identity first, a muted detail line, a trailing timestamp) so the list
 * screens read as one app.
 *
 *   Name                                          2m ago
 *   [Online]  Local · Claude Code
 *   2.1.121 (Claude Code) · Built-in
 *
 * Every value is the caller's: the roster endpoint already carries status,
 * last_seen_at, provider, runtime_mode, profile_id and the metadata bag the
 * version is read from, so a row never reaches into the usage endpoint.
 *
 * Web's per-row columns this deliberately drops
 * (packages/views/runtimes/components/runtime-list.tsx): Owner and Agents need
 * the agent/task caches and Cost · 7d costs one usage request per row. The
 * read-only detail screen shows the owner instead.
 */
import { Pressable, View } from "react-native";
import type { AgentRuntime } from "@multica/core/types";
import {
  deriveRuntimeHealth,
  providerDisplayName,
  runtimeDisplayName,
} from "@multica/core/runtimes";
import { Text } from "@/components/ui/text";
import { RuntimeHealthBadge } from "@/components/runtimes/runtime-health-badge";
import {
  runtimeKindLabel,
  runtimeModeLabel,
  runtimeVersion,
} from "@/lib/runtime-display";
import { timeAgo } from "@/lib/time-ago";

interface Props {
  runtime: AgentRuntime;
  onPress: () => void;
}

export function RuntimeRow({ runtime, onPress }: Props) {
  const name = runtimeDisplayName(runtime);
  const health = deriveRuntimeHealth(runtime, Date.now());
  const provider = runtime.provider.trim();
  const typeLabel = provider
    ? `${runtimeModeLabel(runtime.runtime_mode)} · ${providerDisplayName(provider)}`
    : runtimeModeLabel(runtime.runtime_mode);

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={name}
      className="active:bg-secondary px-4 py-3"
    >
      <View className="gap-1.5">
        <View className="flex-row items-start gap-3">
          <Text
            className="flex-1 text-base font-medium text-foreground"
            numberOfLines={1}
          >
            {name}
          </Text>
          <Text className="pt-0.5 text-[11px] text-muted-foreground/70">
            {runtime.last_seen_at ? timeAgo(runtime.last_seen_at) : "Never"}
          </Text>
        </View>

        <View className="flex-row items-center gap-2">
          <RuntimeHealthBadge health={health} />
          <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
            {typeLabel}
          </Text>
        </View>

        {/* Version reads "—" for a cloud runtime and for one whose daemon has
            not reported yet, matching web's CliCell. */}
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {`${runtimeVersion(runtime) ?? "—"} · ${runtimeKindLabel(runtime.profile_id)}`}
        </Text>
      </View>
    </Pressable>
  );
}
