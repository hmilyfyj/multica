/**
 * Runtime-detail facts — the read-only identity of one runtime, in the iOS
 * Settings row shape the agent / autopilot / project details use (label left,
 * value right, full-width separators, no chevron: nothing here is tappable).
 *
 * Fields and their order follow web's HeroCard + DiagnosticsCard
 * (packages/views/runtimes/components/runtime-detail.tsx:253-374, 477-540):
 * device and runtime come from the two halves of `device_info`, and the daemon
 * CLI version is shown here rather than on a list row — it belongs to the
 * machine, so every runtime on one host reports the same string (#3838).
 *
 * The owner name resolves from the member list already in the cache, the
 * cache-only read `AgentFactsSection` does for its runtime name.
 */
import { View } from "react-native";
import type { AgentRuntime } from "@multica/core/types";
import { providerDisplayName } from "@multica/core/runtimes";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { useActorLookup } from "@/data/use-actor-name";
import {
  runtimeDaemonCliVersion,
  runtimeKindLabel,
  runtimeModeLabel,
  runtimeVersion,
  runtimeVisibilityLabel,
  splitDeviceInfo,
} from "@/lib/runtime-display";

interface Props {
  runtime: AgentRuntime;
}

export function RuntimeFactsSection({ runtime }: Props) {
  const { getName, getAvatarUrl } = useActorLookup();
  const device = runtime.device_info ? splitDeviceInfo(runtime.device_info) : null;
  const provider = runtime.provider.trim();
  const typeLabel = provider
    ? `${runtimeModeLabel(runtime.runtime_mode)} · ${providerDisplayName(provider)}`
    : runtimeModeLabel(runtime.runtime_mode);
  const ownerName = runtime.owner_id ? getName("member", runtime.owner_id) : null;

  return (
    <View className="gap-2">
      <Text className="px-4 text-xs font-medium uppercase text-muted-foreground">
        Details
      </Text>
      <View className="border-y border-border bg-background">
        <Row
          label="Type"
          value={<Value>{typeLabel}</Value>}
        />
        <Separator />
        <Row
          label="Kind"
          value={<Value>{runtimeKindLabel(runtime.profile_id)}</Value>}
        />
        <Separator />
        {/* The runtime's own CLI version; "—" for cloud and for a daemon that
            has not reported one yet. */}
        <Row
          label="Version"
          value={<Value mono>{runtimeVersion(runtime) ?? "—"}</Value>}
        />
        <Separator />
        <Row label="Runtime" value={<Value>{device?.runtime ?? "—"}</Value>} />
        <Separator />
        <Row label="Device" value={<Value mono>{device?.hostname ?? "—"}</Value>} />
        <Separator />
        <Row
          label="Daemon CLI"
          value={
            <Value mono>{runtimeDaemonCliVersion(runtime.metadata) ?? "—"}</Value>
          }
        />
        <Separator />
        <Row
          label="Visibility"
          value={<Value>{runtimeVisibilityLabel(runtime.visibility)}</Value>}
        />
        <Separator />
        <Row
          label="Owner"
          value={
            runtime.owner_id && ownerName ? (
              <View className="flex-row items-center gap-2">
                <ActorAvatar
                  type="member"
                  id={runtime.owner_id}
                  name={ownerName}
                  avatarUrl={getAvatarUrl("member", runtime.owner_id)}
                  size={20}
                />
                <Text className="text-sm text-foreground" numberOfLines={1}>
                  {ownerName}
                </Text>
              </View>
            ) : (
              <Value>—</Value>
            )
          }
        />
        <Separator />
        <Row label="Created" value={<Value>{formatDate(runtime.created_at)}</Value>} />
        <Separator />
        <Row label="Updated" value={<Value>{formatDate(runtime.updated_at)}</Value>} />
      </View>
    </View>
  );
}

function Value({
  children,
  mono,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <Text
      className={mono ? "font-mono text-sm text-foreground" : "text-sm text-foreground"}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between gap-4 px-4 py-3">
      <Text className="text-sm text-foreground">{label}</Text>
      <View className="flex-1 items-end">{value}</View>
    </View>
  );
}

function Separator() {
  return <View className="ml-4 h-px bg-border" />;
}
