/**
 * Notification preferences subscreen. 6 inbox groups + system_notifications
 * toggle, each backed by an optimistic PATCH /api/notification-preferences.
 *
 * Copy mirrors packages/views/settings/components/notifications-tab.tsx but
 * hardcoded English (mobile has no i18n infra yet). The group labels MUST
 * stay in sync with web — they describe the same server-side semantics,
 * and divergent labels would violate behavioral parity (apps/mobile/CLAUDE.md).
 * On Android the screen also owns the OS-side permission (see
 * DeviceNotificationSection): the banner needs both that grant and the
 * server-side preference below.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  ScrollView,
  View,
} from "react-native";
import Constants from "expo-constants";
import { useQuery } from "@tanstack/react-query";
import type {
  NotificationGroupKey,
  NotificationPreferences,
} from "@multica/core/types";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useWorkspaceStore } from "@/data/workspace-store";
import { timeAgo } from "@/lib/time-ago";
import { notificationPreferenceOptions } from "@/data/queries/notification-preferences";
import { useUpdateNotificationPreferences } from "@/data/mutations/notification-preferences";
import {
  getInboxNotificationChannelState,
  getLastInboxNotificationAttempt,
  getLocalNotificationPermission,
  requestLocalNotificationPermission,
  showInboxNotification,
  type InboxNotificationAttempt,
  type InboxNotificationChannelState,
  type LocalNotificationPermission,
} from "@/lib/local-notifications";
import { getLastRealtimeFrameAt } from "@/lib/ws-activity";

const INBOX_GROUPS: {
  key: Exclude<NotificationGroupKey, "system_notifications">;
  label: string;
  description?: string;
}[] = [
  {
    key: "assignments",
    label: "Assignments",
    description: "Assigned or unassigned.",
  },
  {
    key: "status_changes",
    label: "Status changes",
  },
  {
    key: "comments",
    label: "Comments",
    description: "New comments on issues you're subscribed to.",
  },
  {
    key: "mentions",
    label: "Mentions",
    description: "When someone @mentions you, including @all and @squad.",
  },
  {
    key: "updates",
    label: "Issue updates",
    description: "Edits to title, description, labels, priority, or due date.",
  },
  {
    key: "agent_activity",
    label: "Agent activity",
    description: "When an agent picks up, runs, or completes a task.",
  },
];

export default function NotificationsSettingsScreen() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data, isLoading, error } = useQuery(
    notificationPreferenceOptions(wsId),
  );
  const mutation = useUpdateNotificationPreferences();

  const preferences: NotificationPreferences = data?.preferences ?? {};

  const onToggle = (key: NotificationGroupKey, enabled: boolean) => {
    const next: NotificationPreferences = { ...preferences };
    if (enabled) {
      // Default is "all" — omitting the key keeps the object clean.
      delete next[key];
    } else {
      next[key] = "muted";
    }
    mutation.mutate(next);
  };

  const systemEnabled = preferences.system_notifications !== "muted";

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-sm text-destructive text-center">
          Failed to load notification preferences.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-6"
    >
      {Platform.OS === "android" ? <DeviceNotificationSection /> : null}

      <Section
        title="Inbox notifications"
      >
        {INBOX_GROUPS.map((group, idx) => {
          const enabled = preferences[group.key] !== "muted";
          const isLast = idx === INBOX_GROUPS.length - 1;
          return (
            <View key={group.key}>
              <View className="flex-row items-center px-4 py-3 gap-3">
                <View className="flex-1">
                  <Text className="text-base font-medium text-foreground">
                    {group.label}
                  </Text>
                  {group.description ? (
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {group.description}
                    </Text>
                  ) : null}
                </View>
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) => onToggle(group.key, checked)}
                />
              </View>
              {!isLast ? <Separator /> : null}
            </View>
          );
        })}
      </Section>

      <Section
        title="System"
      >
        <View className="flex-row items-center px-4 py-3 gap-3">
          <View className="flex-1">
            <Text className="text-base font-medium text-foreground">
              System notifications
            </Text>
            <Text className="text-xs text-muted-foreground mt-0.5">
              Account changes, security alerts, product updates.
            </Text>
          </View>
          <Switch
            checked={systemEnabled}
            onCheckedChange={(checked) =>
              onToggle("system_notifications", checked)
            }
          />
        </View>
      </Section>
    </ScrollView>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <View className="px-1">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          {title}
        </Text>
        {description ? (
          <Text className="text-xs text-muted-foreground mt-1">
            {description}
          </Text>
        ) : null}
      </View>
      <View className="rounded-md border border-border bg-card overflow-hidden">
        {children}
      </View>
    </View>
  );
}

/**
 * Android system-notification state — the OS gate that must be open before any
 * banner can appear, plus the two things that silently contradict it. It is a
 * different switch from the server-side `system_notifications` toggle: that one
 * decides whether an item is created for this user, this one whether the phone
 * is allowed to display it.
 *
 * This section exists because a phone can swallow a banner three ways and none
 * of them is visible from inside the app: the permission may be missing, the
 * app may be switched off in the system's own notification settings (Android
 * reports that as `denied` too), or our channel may have been turned off in the
 * channel list. So it reports the OS state, reports what the last inbox event
 * actually did, and offers a test banner that goes through the same call as a
 * real one — "the event path works but the phone dropped it" and "no event ever
 * arrived" then look different.
 *
 * The ask stays behind an explicit tap here; the one-time prompt on the first
 * inbox visit (`lib/inbox-notification-prompt.ts`) covers the user who never
 * opens this screen. Nothing else in the app depends on the answer — with the
 * grant missing, items simply stay in the in-app inbox.
 */
function DeviceNotificationSection() {
  const [permission, setPermission] =
    useState<LocalNotificationPermission | null>(null);
  const [channel, setChannel] = useState<InboxNotificationChannelState | null>(
    null,
  );
  const [attempt, setAttempt] = useState<InboxNotificationAttempt | null>(null);
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once an ask came back unresolved: from then on the only route left is
  // the system settings app, so the button stops offering a dialog that will
  // not appear.
  const [needsSystemSettings, setNeedsSystemSettings] = useState(false);

  const refresh = useCallback(() => {
    getLocalNotificationPermission()
      .then(setPermission)
      .catch((err) =>
        console.warn("[notifications] failed to read permission", err),
      );
    getInboxNotificationChannelState()
      .then(setChannel)
      .catch((err) =>
        console.warn("[notifications] failed to read channel", err),
      );
    setAttempt(getLastInboxNotificationAttempt());
    setLastFrameAt(getLastRealtimeFrameAt());
  }, []);

  useEffect(() => {
    refresh();
    // The user can flip any of this in the system settings app; coming back to
    // the foreground is when that becomes visible here.
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const openSystemSettings = () => {
    Linking.openSettings().catch((err) =>
      console.warn("[notifications] failed to open settings", err),
    );
  };

  const onTurnOn = async () => {
    setBusy(true);
    try {
      const next = await requestLocalNotificationPermission();
      setPermission(next);
      if (next.status !== "granted") setNeedsSystemSettings(true);
    } catch (err) {
      console.warn("[notifications] permission request failed", err);
      setNeedsSystemSettings(true);
    } finally {
      setBusy(false);
    }
  };

  const onSendTest = async () => {
    setBusy(true);
    try {
      // Same call the real events use, so a banner here proves the whole native
      // path works. `itemId` doubles as the notification tag, so repeat taps
      // replace one another instead of piling up.
      await showInboxNotification({
        slug: "",
        itemId: "test-notification",
        issueId: null,
        title: "Test notification",
        body: "If you can see this, banners reach this device.",
      });
    } catch (err) {
      console.warn("[notifications] test notification failed", err);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const granted = permission?.status === "granted";
  const offerSettings = needsSystemSettings || permission?.canAskAgain === false;
  // A channel that has not been created yet (first launch, before bootstrap
  // finishes) is not a problem worth warning about.
  const channelOff = channel?.exists === true && !channel.enabled;

  return (
    <Section
      title="On this device"
      description="Android banner for new inbox items. It arrives while the app is running — if the app is swiped away or reclaimed by the system, nothing is delivered."
    >
      <View className="flex-row items-center px-4 py-3 gap-3">
        <View className="flex-1">
          <Text className="text-base font-medium text-foreground">
            System notifications
          </Text>
          <Text className="text-xs text-muted-foreground mt-0.5">
            {granted
              ? "On — new inbox items raise a banner."
              : "Off — the phone is not allowed to show them yet."}
          </Text>
        </View>
        {granted ? (
          <Text className="text-sm text-muted-foreground">On</Text>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy || permission === null}
            onPress={offerSettings ? openSystemSettings : onTurnOn}
          >
            <Text>{offerSettings ? "Open settings" : "Turn on"}</Text>
          </Button>
        )}
      </View>

      {!granted && needsSystemSettings ? (
        <View className="px-4 pb-3">
          <Text className="text-xs text-muted-foreground">
            Android did not offer a dialog (it is already decided, or the app is
            switched off in the system settings). Allow notifications for 海尔商城
            there.
          </Text>
        </View>
      ) : null}

      {channelOff ? (
        <>
          <Separator />
          <View className="flex-row items-center px-4 py-3 gap-3">
            <View className="flex-1">
              <Text className="text-base font-medium text-foreground">
                Inbox channel
              </Text>
              <Text className="text-xs text-muted-foreground mt-0.5">
                Turned off in the system notification settings — banners posted
                to it are discarded.
              </Text>
            </View>
            <Button variant="outline" size="sm" onPress={openSystemSettings}>
              <Text>Open settings</Text>
            </Button>
          </View>
        </>
      ) : null}

      <Separator />
      <View className="px-4 py-3 gap-2">
        <Text className="text-base font-medium text-foreground">
          Last attempt
        </Text>
        <Text className="text-xs text-muted-foreground">
          {describeAttempt(attempt)}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {describeFrames(lastFrameAt)}
        </Text>
        <Text className="text-xs text-muted-foreground">{describeBuild()}</Text>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onPress={onSendTest}
          className="self-start"
        >
          <Text>Send a test notification</Text>
        </Button>
      </View>
    </Section>
  );
}

/** Plain-language form of the newest attempt, for a user with no logcat. */
function describeAttempt(attempt: InboxNotificationAttempt | null): string {
  if (!attempt) {
    return "No inbox event has reached this app since it started.";
  }
  const at = new Date(attempt.at).toLocaleTimeString();
  switch (attempt.outcome) {
    case "shown":
      return `${at} · sent to the phone. If no banner appeared, the phone dropped it — check this app's notification settings there.`;
    case "skipped-permission":
      return `${at} · skipped: notifications are not allowed on this device (${attempt.detail ?? "denied"}).`;
    case "skipped-muted":
      return `${at} · skipped: “System notifications” is muted for this workspace.`;
    case "failed":
      return `${at} · failed: ${attempt.detail ?? "unknown error"}`;
  }
}

/**
 * Whether realtime data is still arriving. This is the datum that separates the
 * two causes of "no notification in the background": if the newest frame is old,
 * nothing reached the app (the process was frozen — plan A's limit); if it is
 * seconds old, the event arrived and the phone dropped the banner, which is on
 * the notification side.
 */
function describeFrames(lastFrameAt: number | null): string {
  if (lastFrameAt === null) {
    return "No realtime data since the app started.";
  }
  return `Last realtime data ${timeAgo(new Date(lastFrameAt).toISOString())}`;
}

/**
 * Which build is installed. Sideloaded APKs get reinstalled repeatedly during
 * a device round-trip, and "did the new one actually land?" was otherwise
 * unanswerable from inside the app. Native values rather than `expoConfig`: a
 * bare release build resolves those from the installed package.
 */
function describeBuild(): string {
  const version = Constants.nativeAppVersion ?? "?";
  const build = Constants.nativeBuildVersion ?? "?";
  return `App build ${version} (vc${build})`;
}
