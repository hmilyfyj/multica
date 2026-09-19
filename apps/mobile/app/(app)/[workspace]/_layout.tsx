import { useEffect } from "react";
import type { ComponentProps } from "react";
import { Platform } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { RealtimeProvider } from "@/data/realtime/realtime-provider";
import { useInboxRealtime } from "@/data/realtime/use-inbox-realtime";
import { useIssuesRealtime } from "@/data/realtime/use-issues-realtime";
import { useMyIssuesRealtime } from "@/data/realtime/use-my-issues-realtime";
import { useChatSessionsRealtime } from "@/data/realtime/use-chat-sessions-realtime";
import { useProjectsRealtime } from "@/data/realtime/use-projects-realtime";
import { usePinsRealtime } from "@/data/realtime/use-pins-realtime";
import { usePresenceRealtime } from "@/data/realtime/use-presence-realtime";
import { useWorkspaceRealtime } from "@/data/realtime/use-workspace-realtime";
import { useCatalogsRealtime } from "@/data/realtime/use-catalogs-realtime";
import { useWorkspacePresencePrefetch } from "@/lib/use-workspace-presence-prefetch";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { useNewIssueDraftResetOnWorkspaceChange } from "@/data/stores/new-issue-draft-store";
import { useNewProjectDraftResetOnWorkspaceChange } from "@/data/stores/new-project-draft-store";
import { useChatSessionPickerResetOnWorkspaceChange } from "@/data/stores/chat-session-picker-store";

/**
 * Shared Stack.Screen options for every formSheet-presented sheet route. The
 * values below are chosen for iOS; the Android block at the end of this
 * comment records what each one does there.
 *
 * Why these specific values:
 *   - `presentation: "formSheet"` instantiates iOS
 *     UISheetPresentationController — native grabber, stacked-card backdrop,
 *     drag-to-dismiss spring physics, detents.
 *   - `sheetAllowedDetents: [0.6, 0.95]` — explicit numeric detents. The
 *     ergonomic `"fitToContents"` is broken on iOS 26 + Expo 55
 *     (expo/expo#42904 padding inconsistency, expo/expo#42965 zero-size).
 *     Predictable two-snap presentation across every picker-row sheet >
 *     shrink-wrap; this is the right default for sheets that sit next to
 *     other sheets in the same chip row (issue / project AttributeRow) so
 *     the user gets the same gesture regardless of which chip they tap.
 *     Isolated sheets with no chip-row neighbour to be consistent with may
 *     override this with `"fitToContents"` to avoid the large blank area
 *     below their content.
 *   - `sheetGrabberVisible: true` — surfaces the iOS native drag handle
 *     so users discover the gesture.
 *   - `contentStyle.height: "100%"` — safety net against the same
 *     zero-size class of bugs above; ensures the sheet body fills the
 *     allotted detent.
 *   - `headerShown: false` — every sheet body draws its own header (title
 *     + optional right action). The native Stack header would double up.
 *
 * Android (measured on the API 35 emulator with react-native-screens 4.23 —
 * see .trellis/tasks/09-18-android-formsheet/research/android-sheets.md):
 *   - the same four values are honoured, by different machinery. `formSheet`
 *     becomes a Material BottomSheet where the detent array maps to
 *     `peekHeight = detents[0]` and `maxHeight = detents[detents.length - 1]`,
 *     with `fitToContents` forced on — a short sheet therefore sits at its
 *     content height instead of a fixed 60%, and drag-up/drag-down move
 *     between the same two snap points.
 *   - `sheetCornerRadius` rounds the sheet's top corners (Material
 *     ShapeAppearanceModel) rather than every corner of a card.
 *   - `sheetGrabberVisible` is accepted and then dropped: RNS never draws a
 *     grabber on Android, so the drag gesture has no affordance there.
 *   - BACK closes the sheet (RNS routes it to `dismissSelf`), and so does a
 *     tap on the dimmed backdrop — both Android conventions, neither true on
 *     iOS. Keep `sheetAllowedDetents` numeric for both platforms: Android
 *     never sees the iOS 26 `"fitToContents"` bugs above.
 *   - `headerShown: true` (set by the search pickers below) draws nothing
 *     here: no title bar, no search field, and it takes no height — the
 *     sheet starts at its first content row. The pickers' filter input is
 *     therefore rendered by the route inside the sheet body
 *     (`usePickerSearchBar` → `components/ui/search-field.tsx`), while iOS
 *     keeps its native `UISearchController`.
 */
const SHEET_OPTIONS: ComponentProps<typeof Stack.Screen>["options"] = {
  presentation: "formSheet",
  sheetGrabberVisible: true,
  sheetAllowedDetents: [0.6, 0.95],
  sheetCornerRadius: 20,
  contentStyle: { flex: 1 },
  headerShown: false,
};

/**
 * Due-date sheets. Identical to SHEET_OPTIONS on iOS; on Android the route
 * degrades to a full-screen `modal`.
 *
 * Reason (measured, not assumed): Android has no inline date picker — every
 * `display` mode renders a DialogFragment, and one opened from inside a
 * formSheet never receives input. Taps land on the sheet underneath, CANCEL
 * and OK are inert, and BACK pops the sheet while the dialog stays on screen
 * over the whole app until the process dies. Presenting the route as a
 * full-screen modal puts it back in the activity's own window, where the
 * dialog works normally.
 */
const DUE_DATE_OPTIONS: ComponentProps<typeof Stack.Screen>["options"] = {
  ...SHEET_OPTIONS,
  ...(Platform.OS === "android" ? { presentation: "modal" as const } : null),
};

/**
 * Cold-start deep-link anchor. Expo Router otherwise treats whatever
 * route resolves the URL as the root of the stack — if the user opens a
 * notification that targets `issue/[id]/picker/status` directly, they
 * land on the formSheet with NO parent under it, no way to go back to
 * the tabs. `anchor: "(tabs)"` tells the router to mount the tab UI as
 * the implicit underlying screen so back/swipe-dismiss returns the user
 * to a sensible base state.
 */
export const unstable_settings = { anchor: "(tabs)" } as const;

/**
 * Mounts every per-feature realtime subscription. Lives inside
 * RealtimeProvider so the WSClient context is available, and stays alive
 * for the whole workspace session — the inbox unread count must keep
 * refreshing even while the user is on an issue page or settings, not
 * just when the inbox tab is foregrounded.
 *
 * Add new realtime feature hooks here as they land (issue, chat, etc).
 */
function RealtimeSubscriptions() {
  useInboxRealtime();
  useIssuesRealtime();
  useMyIssuesRealtime();
  useChatSessionsRealtime();
  useProjectsRealtime();
  usePinsRealtime();
  // Presence: warm the three queries up front so avatars don't flash a
  // dotless first render, and listen for daemon/agent/task events to keep
  // the runtime + snapshot caches fresh. See use-presence-realtime.ts for
  // the deliberately-skipped high-frequency events.
  useWorkspacePresencePrefetch();
  usePresenceRealtime();
  // Workspace identity/membership and the picker catalogs (squads, labels,
  // the issue status catalog) — the families web answers in its refreshMap
  // prefixes. See use-workspace-realtime.ts / use-catalogs-realtime.ts.
  useWorkspaceRealtime();
  useCatalogsRealtime();
  return null;
}

/**
 * Workspace context layout. Reads the slug from the URL (the route is the
 * source of truth — see apps/mobile/CLAUDE.md "Behavioral parity"), validates
 * membership against the workspaces list, then syncs id+slug into the
 * Zustand store so ApiClient.fetch can read the slug synchronously when
 * injecting the X-Workspace-Slug header.
 *
 * If the slug doesn't match any workspace the user belongs to, redirect to
 * /select-workspace (covers stale persisted slugs after the user lost
 * membership, deep links to wrong slugs, etc.).
 */
export default function WorkspaceLayout() {
  const { workspace: slug } = useLocalSearchParams<{ workspace: string }>();
  const { data: workspaces, isLoading } = useQuery(workspaceListOptions());
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);

  const matched = workspaces?.find((w) => w.slug === slug);

  useEffect(() => {
    if (matched) {
      setCurrentWorkspace(matched.id, matched.slug);
    }
  }, [matched, setCurrentWorkspace]);

  // Wipe cross-route Zustand draft stores whenever the active workspace
  // changes — a draft picked under workspace A (assignee id, draft
  // session id, etc.) is invalid in workspace B and must not leak.
  useNewIssueDraftResetOnWorkspaceChange(matched?.id ?? null);
  useNewProjectDraftResetOnWorkspaceChange(matched?.id ?? null);
  useChatSessionPickerResetOnWorkspaceChange(matched?.id ?? null);

  // Wait for the workspaces list before deciding membership — otherwise a
  // valid deep link would briefly redirect away on cold start.
  if (isLoading) return null;

  if (!matched) return <Redirect href="/select-workspace" />;

  // Tabs hide their own header; pushed screens (issue/[id]) get a native
  // iOS Stack header with the standard back button + swipe-to-dismiss.
  return (
    <RealtimeProvider>
      <RealtimeSubscriptions />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="issue/[id]"
          options={{
            title: "Issue",
            headerBackTitle: "Back",
          }}
        />
        <Stack.Screen
          name="project/[id]"
          options={{
            title: "Project",
            headerBackTitle: "Back",
          }}
        />
        <Stack.Screen
          name="project/[id]/edit"
          options={{
            title: "Edit Project",
            presentation: "modal",
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        <Stack.Screen
          name="issue/[id]/edit"
          options={{
            title: "Edit Issue",
            presentation: "modal",
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        <Stack.Screen
          name="project/new"
          options={{
            title: "New Project",
            presentation: "modal",
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        <Stack.Screen name="inbox/[id]" options={SHEET_OPTIONS} />
        {/* Issue-detail formSheet pickers. All share the same sheet config:
            explicit numeric detents to dodge expo/expo#42904+#42965 (the
            `fitToContents` zero-size / padding bugs on iOS 26 + Expo 55),
            iOS native grabber, and contentStyle.height=100% as a safety
            net against the same zero-size class of bugs. */}
        <Stack.Screen
          name="issue/[id]/picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="issue/[id]/picker/priority"
          options={SHEET_OPTIONS}
        />
        {/* Search-enabled pickers wire their filter input through
            `usePickerSearchBar`. On iOS that is the native nav header +
            UISearchController registered below (`headerShown: true` +
            title), which eliminates the #3634 overlap class of bugs and the
            focus-loss footgun of a custom TextInput inside
            ListHeaderComponent. Android accepts `headerSearchBarOptions` and
            renders none of it, so the hook hands those routes a
            body-rendered `SearchField` instead. Both platforms keep this
            config as-is, so nothing on the iOS side changes.
            label / project / lead are intentionally NOT in this group: they
            still register bare SHEET_OPTIONS (no header), so iOS shows no
            search field for them either — a pre-existing gap left untouched
            by FEATURE-546, which is scoped to Android. */}
        <Stack.Screen
          name="issue/[id]/picker/assignee"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: "Assignee",
          }}
        />
        <Stack.Screen
          name="issue/[id]/picker/label"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="mention-picker"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: "Mention",
          }}
        />
        <Stack.Screen
          name="issue/[id]/picker/project"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="issue/[id]/picker/due-date"
          options={DUE_DATE_OPTIONS}
        />
        <Stack.Screen name="issue/[id]/runs" options={SHEET_OPTIONS} />
        {/* Thread outline — quick jump between an issue's comment threads,
            pushed from the timeline's floating thread stepper. */}
        <Stack.Screen name="issue/[id]/threads" options={SHEET_OPTIONS} />
        {/* Full emoji picker for a comment reaction. Pushed from the "+"
            button inside the comment long-press tapback row — see
            components/issue/comment-context-menu.tsx. */}
        <Stack.Screen
          name="issue/[id]/comment/[commentId]/emoji-picker"
          options={SHEET_OPTIONS}
        />
        {/* Project-detail formSheet pickers. */}
        <Stack.Screen
          name="project/[id]/picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="project/[id]/picker/priority"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="project/[id]/picker/lead"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="project/[id]/add-resource"
          options={SHEET_OPTIONS}
        />
        {/* New-issue draft formSheet pickers — stacked on top of the
            new-issue.tsx Stack.Screen (which is itself a `modal`).
            Expo Router 55 / RN Screens 4 support a formSheet pushed on top
            of a modal in the same Stack. */}
        <Stack.Screen
          name="new-issue-picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-issue-picker/priority"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-issue-picker/assignee"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: "Assignee",
          }}
        />
        <Stack.Screen
          name="new-issue-picker/project"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-issue-picker/due-date"
          options={DUE_DATE_OPTIONS}
        />
        {/* New-project draft formSheet pickers — same pattern as
            new-issue-picker/*. Stacked on top of `project/new` (a modal). */}
        <Stack.Screen
          name="new-project-picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-project-picker/priority"
          options={SHEET_OPTIONS}
        />
        {/* Shared filter sheet for My Issues and the workspace Issues page —
            chooses the right view-store via `?scope=my|all` URL param. */}
        <Stack.Screen name="issues-filter" options={SHEET_OPTIONS} />
        {/* Chat session-switch sheet. */}
        <Stack.Screen name="chat-sessions" options={SHEET_OPTIONS} />
        {/* Workspace switcher — reached from the More popover's collapsed
            WorkspaceCard. Two-step (pick → iOS Alert confirm → switch). */}
        <Stack.Screen name="switch-workspace" options={SHEET_OPTIONS} />
        <Stack.Screen
          name="more/issues"
          options={{ title: "Issues", headerBackTitle: "Back" }}
        />
        <Stack.Screen
          name="more/projects"
          options={{ title: "Projects", headerBackTitle: "Back" }}
        />
        <Stack.Screen
          name="more/agents"
          options={{ title: "Agents", headerBackTitle: "Back" }}
        />
        {/* Agent detail. The title is overridden in-screen with the agent's
            own name once the roster resolves; this is the cold-start /
            deep-link fallback. */}
        <Stack.Screen
          name="more/agents/[id]"
          options={{ title: "Agent", headerBackTitle: "Agents" }}
        />
        <Stack.Screen
          name="more/pins"
          options={{ title: "Pinned", headerBackTitle: "Back" }}
        />
        <Stack.Screen
          name="more/settings"
          options={{ title: "Settings", headerBackTitle: "Back" }}
        />
        <Stack.Screen
          name="more/settings/profile"
          options={{ title: "Profile", headerBackTitle: "Settings" }}
        />
        <Stack.Screen
          name="more/settings/notifications"
          options={{ title: "Notifications", headerBackTitle: "Settings" }}
        />
        <Stack.Screen
          name="more/settings/workspace"
          options={{ title: "Workspace", headerBackTitle: "Settings" }}
        />
        <Stack.Screen
          name="more/settings/labels"
          options={{ title: "Labels", headerBackTitle: "Settings" }}
        />
        <Stack.Screen
          name="more/settings/issue-statuses"
          options={{ title: "Statuses", headerBackTitle: "Settings" }}
        />
        {/* Label and status editors. Both are forms with a keyboard, so they
            follow the sheet rule in apps/mobile/AGENTS.md ("long list, search,
            form, or keyboard interaction") rather than pushing a full screen.
            Same SHEET_OPTIONS as every other body that owns its own data. */}
        <Stack.Screen name="more/settings/label-form" options={SHEET_OPTIONS} />
        <Stack.Screen name="more/settings/status-form" options={SHEET_OPTIONS} />
        <Stack.Screen
          name="new-issue"
          options={{
            title: "New Issue",
            presentation: "modal",
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        <Stack.Screen
          name="search"
          options={{
            title: "Search",
            presentation: "modal",
            headerLeft: () => <ModalCloseButton />,
          }}
        />
      </Stack>
    </RealtimeProvider>
  );
}
