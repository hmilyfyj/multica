/**
 * Autopilot triggers — the read-only config summary of "how this automation
 * fires today".
 *
 * Scope note: this mirrors web's `TriggerRow`
 * (packages/views/autopilots/components/autopilot-detail-page.tsx:258) minus
 * every control — no add / edit / delete, no webhook token rotation, no
 * signing-secret editor. The webhook URL keeps web's copy affordance because the
 * value's whole purpose is to be pasted into the external service that will call
 * it.
 *
 * The schedule line is the raw cron plus its zone, which is web's own fallback
 * rendering for expressions beyond its structured model — see the divergence
 * note on `triggerScheduleLine`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import type { AutopilotTrigger } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { type IoniconName } from "@/components/ui/nav-icon";
import {
  formatAbsoluteTime,
  triggerKindLabel,
  triggerScheduleLine,
} from "@/lib/autopilot-display";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

/** Server-side `kind` is an open vocabulary; an unknown kind still renders, with
 *  the generic bolt web falls back to for its trigger icons. */
const KIND_ICON: Record<string, IoniconName> = {
  schedule: "time-outline",
  webhook: "globe-outline",
  api: "code-slash-outline",
};

interface Props {
  triggers: AutopilotTrigger[];
}

export function AutopilotTriggersSection({ triggers }: Props) {
  return (
    <View className="gap-2">
      <Text className="px-4 text-xs font-medium uppercase text-muted-foreground">
        Triggers
      </Text>
      <View className="border-y border-border bg-background">
        {triggers.length === 0 ? (
          <Text className="px-4 py-4 text-sm text-muted-foreground">
            No triggers configured. Add a schedule on the web app to run
            automatically.
          </Text>
        ) : (
          triggers.map((trigger, index) => (
            <View key={trigger.id || index}>
              {index > 0 ? <View className="ml-4 h-px bg-border" /> : null}
              <TriggerRow trigger={trigger} />
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function TriggerRow({ trigger }: { trigger: AutopilotTrigger }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const scheduleLine = triggerScheduleLine(trigger);
  // webhook_url is only present when the server has a public URL configured;
  // webhook_path is always computable, so it is the fallback.
  const webhookUrl = trigger.webhook_url ?? trigger.webhook_path ?? null;

  return (
    <View className="gap-1.5 px-4 py-3">
      <View className="flex-row items-center gap-2">
        <Ionicons
          name={KIND_ICON[trigger.kind] ?? "flash-outline"}
          size={14}
          color={theme.mutedForeground}
        />
        <Text className="text-sm font-medium text-foreground">
          {triggerKindLabel(trigger.kind)}
        </Text>
        {trigger.label ? (
          <Text
            className="flex-1 text-xs text-muted-foreground"
            numberOfLines={1}
          >
            {trigger.label}
          </Text>
        ) : (
          <View className="flex-1" />
        )}
        {trigger.enabled ? null : (
          <View className="rounded-full bg-muted px-2 py-0.5">
            <Text className="text-[11px] text-muted-foreground">Disabled</Text>
          </View>
        )}
      </View>

      {scheduleLine ? (
        <Text className="font-mono text-xs text-muted-foreground">
          {scheduleLine}
        </Text>
      ) : null}

      {trigger.next_run_at ? (
        <Text className="text-xs text-muted-foreground">
          Next run {formatAbsoluteTime(trigger.next_run_at)}
        </Text>
      ) : null}

      {webhookUrl ? (
        <View className="flex-row items-center gap-2 pt-0.5">
          <Text
            className="flex-1 text-xs text-muted-foreground"
            numberOfLines={1}
            selectable
          >
            {webhookUrl}
          </Text>
          <CopyUrlButton url={webhookUrl} />
        </View>
      ) : null}
    </View>
  );
}

function CopyUrlButton({ url }: { url: string }) {
  const { colorScheme } = useColorScheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = useCallback(async () => {
    await Clipboard.setStringAsync(url);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [url]);

  return (
    <Pressable
      onPress={onCopy}
      accessibilityLabel="Copy webhook URL"
      hitSlop={8}
      className="flex-row items-center gap-1 rounded-md px-2 py-1 active:bg-secondary"
    >
      <Ionicons
        name="copy-outline"
        size={13}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="text-xs text-muted-foreground">
        {copied ? "Copied" : "Copy"}
      </Text>
    </Pressable>
  );
}
