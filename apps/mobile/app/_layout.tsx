import "../global.css";

import { useEffect, useRef } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ThemeProvider } from "@react-navigation/native";
import { PortalHost } from "@rn-primitives/portal";
import { api } from "@/data/api";
import { maybeRenewSession } from "@/data/session-renewal";
import { queryClient } from "@/data/query-client";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { SessionActivityBoundary } from "@/components/auth/session-activity-boundary";
import { ActionSheetHost } from "@/components/ui/action-sheet";
import { subscribeToInboxNotificationResponses } from "@/lib/inbox-notification-response";
import {
  configureLocalNotificationHandler,
  ensureInboxNotificationChannel,
} from "@/lib/local-notifications";
import { LightboxProvider, prewarmHighlighter } from "@/lib/markdown";
import { NAV_THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

// Kick off Shiki highlighter init at module load — fires once per process,
// finishes before the user navigates to any screen with a code block. If
// init fails (engine unavailable) the highlighter falls back to plain
// text; nothing here is allowed to throw.
prewarmHighlighter();

// Android local notifications — plan "A" (FEATURE-562). The behavior handler is
// the one piece that must be armed before any banner can arrive; the channel
// and the tap listener are wired in RootLayout, and the feature itself lives in
// lib/local-notifications.ts + data/realtime/inbox-notification.ts.
if (Platform.OS === "android") {
  // Foreground banners are on. This is a JS-side switch with no native call, so
  // it can be armed here — before any screen, and before the socket that
  // produces the first banner can connect.
  configureLocalNotificationHandler();
}

function AuthInitializer({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore((s) => s.initialize);
  const qc = useQueryClient();
  // Idempotent guard: 401 on multiple in-flight requests would otherwise
  // logout/navigate repeatedly during the same session-expire moment.
  const signingOutRef = useRef(false);

  useEffect(() => {
    // Wire 401 handling onto the shared ApiClient singleton. Must be set
    // before any request fires — initialize() below kicks off the first
    // getMe() call, so do this synchronously first.
    api.setOptions({
      onUnauthorized: () => {
        if (signingOutRef.current) return;
        signingOutRef.current = true;
        void (async () => {
          await useAuthStore.getState().logout();
          await useWorkspaceStore.getState().clear();
          qc.clear();
          router.replace("/login");
          // Reset on next tick so a fresh session can hit 401 again later
          // without being silently swallowed.
          setTimeout(() => {
            signingOutRef.current = false;
          }, 0);
        })();
      },
    });
    // Launch check for the sliding session (MUL-7436). Runs after the token
    // is restored and the identity probe has settled, so it never races the
    // first getMe(); a no-op when there is no session to extend.
    void initialize().then(() => maybeRenewSession());
  }, [initialize, qc]);

  // Foreground transitions are one of the two "someone is using this" signals;
  // SessionActivityBoundary below supplies the other, so an app that stays
  // foregrounded for longer than the check interval still renews. Deliberately
  // not a timer: a backgrounded or untouched app must not keep the session of
  // someone who stopped using it alive.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (status === "active") maybeRenewSession();
    });
    return () => sub.remove();
  }, []);

  return <>{children}</>;
}

export default function RootLayout() {
  const { colorScheme, isDarkColorScheme } = useColorScheme();
  const authLoading = useAuthStore((s) => s.isLoading);

  // Android local notifications — plan "A" (FEATURE-562): the channel the
  // banners are posted to, and the taps that come back. Deferred to an effect
  // because both reach native modules (a module-scope call runs before the
  // registry is guaranteed up), and held until auth hydration finishes so a
  // tap that launched the app deep-links into a restored workspace instead of
  // racing the entry redirect.
  //
  // Android only, deliberately: the banner, its permission prompt and its tap
  // handling are behaviour iOS must not acquire from this change. A killed or
  // reclaimed app cannot be notified at all — the banner is produced by this
  // process from an already-open WebSocket, so there is no push channel behind
  // it (see lib/local-notifications.ts for why that is the accepted limit).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    // Android 8+ drops a notification that names an unknown channel. A failure
    // here is not fatal — the library falls back to its own channel rather than
    // losing the banner.
    ensureInboxNotificationChannel().catch((err) =>
      console.warn("[notifications] failed to create inbox channel", err),
    );
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android" || authLoading) return;
    return subscribeToInboxNotificationResponses();
  }, [authLoading]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider value={NAV_THEME[colorScheme]}>
              <AuthInitializer>
                <SessionActivityBoundary>
                <LightboxProvider>
                  <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="index" />
                    <Stack.Screen name="(auth)" />
                    <Stack.Screen name="(app)" />
                  </Stack>
                  <PortalHost />
                  <ActionSheetHost />
                </LightboxProvider>
                </SessionActivityBoundary>
              </AuthInitializer>
            </ThemeProvider>
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
