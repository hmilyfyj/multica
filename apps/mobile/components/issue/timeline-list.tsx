/**
 * The scrolling timeline. ASC chronological — oldest at top, newest near the
 * bottom (above the composer). Pull-to-refresh refetches issue + timeline.
 *
 * Backend returns the full timeline in one shot (server-side pagination
 * was dropped in #2322 — p99 ~30 entries per issue, cursor walking only
 * created bugs at reply-thread boundaries). The previous "Pull to load
 * older" UX and top-edge `fetchOlder` trigger are gone.
 *
 * Inbox deep-link landing:
 *   `resolveCommentLanding` (lib/comment-landing.ts) maps the id the
 *   notification carries to the row that holds it plus the view inside that
 *   row which has to end up at the top of the viewport — the reply's own
 *   bubble for a reply notification, the row itself for a root one. The
 *   effect below drives the list there (`startLanding`) and holds it while
 *   the row settles.
 *
 *   Why not a bare `scrollToIndex`: it positions a *row* against FlashList's
 *   layout model, which is exact but cannot know where a reply sits inside
 *   its thread bubble, and it is computed once — async markdown (Shiki
 *   highlight, image natural-size) keeps changing heights after the jump. So
 *   the row jump is only the coarse half; the fine half measures the anchor
 *   in window coordinates and turns the residual into a scroll offset, the
 *   same loop the web client runs
 *   (packages/views/issues/components/issue-detail.tsx:1940-1985).
 *
 *   `RootHighlightOverlay` / `ReplyHighlightOverlay` flash the anchor once it
 *   is on screen (`HIGHLIGHT_HOLD_MS`). The older behavior — land at the
 *   bottom, flash whichever row the user eventually scrolls past — made the
 *   deep link useless for a comment anywhere above the last screenful.
 *
 * `maintainVisibleContentPosition` is enabled by default on FlashList v2
 * and is implemented inside the C++ shadow tree — it compensates the
 * scroll offset both when a row is INSERTED above the viewport AND when
 * an upper row RESIZES (a WS `comment:updated` / `reaction:added` /
 * `resolved` event on an older comment used to push the user's read
 * position down by the delta). On FlatList the same prop was iOS-only
 * + JS-side; the FlashList path is steadier and animates the offset
 * compensation rather than snapping it.
 *
 * List engine: FlashList v2 (Shopify). Migrated from FlatList because:
 *   1. Cell recycling — markdown bubbles (Shiki highlight, image natural-
 *      size, lightbox provider injection) are expensive to mount; FlashList
 *      keeps them in recycled cells when scrolling through history rather
 *      than re-running the multi-pass render each time a row re-enters the
 *      window.
 *   2. Native MVCP — see paragraph above. Smoother behavior than FlatList's
 *      JS-side implementation when WS events resize an upper row.
 *   3. Async-render stability — async markdown size changes inside the
 *      viewport no longer cause the visual "twitch" we saw with FlatList,
 *      because FlashList re-layouts inside the shadow tree without
 *      surfacing a JS-side onContentSizeChange storm.
 *
 * What FlashList v2 does NOT change about this file:
 *   - Where an issue-open lands: the top, so the header (title, description,
 *     status) reads first. `startRenderingFromBottom` stays off — only a deep
 *     link moves the list, and only to its target.
 *   - Spacing between rows. FlashList ignores `gap-*` on
 *     `contentContainer` the same way it does in chat-message-list.tsx —
 *     we use `ItemSeparatorComponent` for the 12 px breathing room and
 *     `ListHeaderComponentStyle` to add the same gap below the header.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import type { Issue, TimelineEntry } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { IssueHeaderCard } from "./issue-header-card";
import { IssueDescription } from "./issue-description";
import { IssueReactionRow } from "./issue-reaction-row";
import { ActivityRow } from "./activity-row";
import { CommentCard } from "./comment-card";
import { useLastViewedStore } from "@/data/stores/last-viewed-store";
import { coalesceTimeline } from "@/lib/timeline-coalesce";
import { buildTimelineRows, type TimelineRow } from "@/lib/timeline-thread";
import { resolveCommentLanding, startLanding } from "@/lib/comment-landing";
import { ImageSequenceProvider } from "@/lib/markdown/image-sequence";
import { issueAttachmentsOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import type { ImageSequenceBlock } from "@multica/core/attachments/image-sequence";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useCommentSelectStore } from "@/data/comment-select-store";

interface Props {
  issue: Issue;
  entries: TimelineEntry[] | undefined;
  timelineLoading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Inbox deep-link target. Root comment id OR reply id — the timeline
   *  lands on whichever of them the id names, replies included, and the card
   *  flashes it (see lib/comment-landing.ts). */
  highlightCommentId?: string;
  /** Per-tap nonce. Re-tapping the same inbox row produces the same
   *  `highlightCommentId` but a fresh nonce, which re-triggers the
   *  scroll-and-flash effect (without this, identical props short-circuit). */
  highlightNonce?: string;
}

/** How long the flash stays "claimed" before a new highlight may take over.
 *  The fade-out itself is the Reanimated sequence inside CommentCard (~3.2s
 *  start to finish); this gate only has to outlast it, so the anchor the
 *  landing parked at the top keeps its ring while the user reads it. */
const HIGHLIGHT_HOLD_MS = 5000;

/** Pixel slack at the bottom edge — inside this band we treat the user as
 *  "already at bottom" so the new-comment chip doesn't fire for entries
 *  the user is already about to see. */
const AT_BOTTOM_SLACK_PX = 80;

/** Sentinel id for the "New since last view" divider row injected into the
 *  FlatList data. Picked because it can never collide with a real comment
 *  / activity uuid. */
const DIVIDER_ID = "__divider__";

export function TimelineList({
  issue,
  entries,
  timelineLoading,
  refreshing,
  onRefresh,
  highlightCommentId,
  highlightNonce,
}: Props) {
  // Top-level selection subscription gates the outer "tap-outside-to-dismiss"
  // Pressable below. When null, the Pressable stays disabled and every tap
  // passes through to comment cards / chip rows / reactions normally.
  const selectingId = useCommentSelectStore((s) => s.selectingId);

  // Server already returns ASC oldest-first. Pipeline:
  //   1. coalesceTimeline → merge consecutive identical activities
  //   2. buildTimelineRows → reorder so replies sit adjacent to their parent
  //      and tag each reply with `replyTo` for the card to render the
  //      "↪ Replying to" header + thread-line border. This is the mobile
  //      flat-list interpretation of web's recursive reply tree.
  const data = useMemo<TimelineRow[]>(() => {
    if (!entries) return [];
    return buildTimelineRows(coalesceTimeline(entries));
  }, [entries]);

  // Every image on this screen, in render order: the description first, then
  // each comment row with its replies (MUL-5752). Tapping any of them opens
  // the lightbox at its real position so a swipe walks to the next.
  //
  // The description's attachments come from the same query IssueDescription
  // uses — TanStack Query dedupes it, so this adds no request.
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issueAttachments } = useQuery(
    issueAttachmentsOptions(wsId, issue.id),
  );
  const imageBlocks = useMemo<ImageSequenceBlock[]>(() => {
    const blocks: ImageSequenceBlock[] = [
      { content: issue.description, attachments: issueAttachments },
    ];
    for (const row of data) {
      if (row.entry.type !== "comment") continue;
      blocks.push({
        content: row.entry.content,
        attachments: row.entry.attachments,
      });
      for (const reply of row.replies) {
        blocks.push({ content: reply.content, attachments: reply.attachments });
      }
    }
    return blocks;
  }, [issue.description, issueAttachments, data]);

  const listRef = useRef<FlashListRef<TimelineRow>>(null);
  // Gates single-shot per (commentId, nonce) tuple. Re-tap from inbox
  // bumps the nonce → ref no longer matches → effect re-fires.
  const lastStampRef = useRef<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Landing plumbing. `viewportRef` is the window-space origin the correction
  // loop measures against; `anchorRef` is the row/reply view a deep link must
  // bring to the top, registered by whichever CommentCard owns it.
  const viewportRef = useRef<View>(null);
  const anchorRef = useRef<View | null>(null);
  const setAnchorView = useCallback((node: View | null) => {
    anchorRef.current = node;
  }, []);
  const cancelLandingRef = useRef<(() => void) | null>(null);

  // ── "New since last view" divider ─────────────────────────────────────
  // Snapshot the last-viewed timestamp ONCE on mount. Subsequent WS
  // appends shouldn't shift the divider — the user wants a stable
  // "where I was when I came back" boundary. The store update happens on
  // unmount, gated on the user having actually scrolled past the divider.
  const lastViewedSnapshotRef = useRef<string | null | undefined>(undefined);
  if (lastViewedSnapshotRef.current === undefined) {
    lastViewedSnapshotRef.current =
      useLastViewedStore.getState().getLastViewed(issue.id) ?? null;
  }
  const dividerAnchorId = useMemo(() => {
    const snapshot = lastViewedSnapshotRef.current;
    if (!snapshot) return null;
    // First entry strictly newer than the snapshot anchors the divider;
    // divider draws ABOVE this row. If everything is older, no divider.
    const found = data.find((r) => r.entry.created_at > snapshot);
    return found ? found.entry.id : null;
  }, [data]);
  const dividerScrolledPastRef = useRef(false);

  // ── New-comment-while-reading chip ────────────────────────────────────
  // After landing, if WS appends new entries while the user is NOT at the
  // bottom, surface a floating "↓ N new" chip instead of silently shifting
  // content below the viewport. Tapping the chip scrolls to bottom and
  // clears the counter; reaching the bottom by hand also clears it.
  const [newCount, setNewCount] = useState(0);
  const isAtBottomRef = useRef(true);
  const lastDataLenRef = useRef(0);
  useEffect(() => {
    const grew = data.length > lastDataLenRef.current;
    const diff = data.length - lastDataLenRef.current;
    lastDataLenRef.current = data.length;
    if (!grew) return;
    // `isAtBottomRef` defaults to `true` so the initial 0→N load is treated
    // as "user is already at the bottom" and the chip stays silent until a
    // later WS append arrives while the user is scrolled up.
    if (isAtBottomRef.current) return;
    setNewCount((prev) => prev + diff);
  }, [data.length]);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);
      const wasAtBottom = isAtBottomRef.current;
      isAtBottomRef.current = distFromBottom < AT_BOTTOM_SLACK_PX;
      // Reaching the bottom clears the unread-new chip — same iMessage /
      // chat-app semantic: "I've caught up".
      if (!wasAtBottom && isAtBottomRef.current && newCount > 0) {
        setNewCount(0);
      }
    },
    [newCount],
  );

  const onJumpToNew = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
    setNewCount(0);
  }, []);

  // ── Inject divider as a sentinel row before its anchor entry ──────────
  // FlatList wants a flat data[] and a stable key per row. Rather than
  // teach the renderer about "items + dividers" via a union type, fake a
  // TimelineRow with a sentinel id; renderItem checks the id first.
  const dataWithDivider = useMemo<TimelineRow[]>(() => {
    if (!dividerAnchorId) return data;
    const anchorIdx = data.findIndex((r) => r.entry.id === dividerAnchorId);
    if (anchorIdx <= 0) return data;
    const divider: TimelineRow = {
      // Cast: this entry is a synthetic marker, not a real TimelineEntry —
      // renderItem keys off `id === DIVIDER_ID` and never reads other fields.
      entry: {
        id: DIVIDER_ID,
        type: "activity",
        created_at: "",
        actor_type: "",
        actor_id: "",
      } as unknown as TimelineEntry,
      replies: [],
    };
    return [...data.slice(0, anchorIdx), divider, ...data.slice(anchorIdx)];
  }, [data, dividerAnchorId]);

  // ── Inbox deep-link landing ────────────────────────────────────────────
  // One landing per (comment id, nonce) pair: the nonce is what re-arms a
  // re-tap of the same inbox row, and the stamp is what stops a WS append
  // (fresh `dataWithDivider`) from replaying the jump under the user.
  useEffect(() => {
    if (!highlightCommentId) return;
    const list = listRef.current;
    const landing = list
      ? resolveCommentLanding(dataWithDivider, highlightCommentId)
      : null;
    if (!list || !landing) return;
    const stamp = `${highlightCommentId}:${highlightNonce ?? ""}`;
    if (lastStampRef.current === stamp) return;
    lastStampRef.current = stamp;

    setHighlightedId(highlightCommentId);

    const cancelLanding = startLanding({
      list,
      targetIndex: landing.rowIndex,
      probeDown:
        landing.anchorId !== dataWithDivider[landing.rowIndex]?.entry.id,
      anchorNode: () => anchorRef.current,
      viewport: () => viewportRef.current,
    });
    cancelLandingRef.current = cancelLanding;

    const fade = setTimeout(() => setHighlightedId(null), HIGHLIGHT_HOLD_MS);
    return () => {
      clearTimeout(fade);
      cancelLanding();
    };
  }, [highlightCommentId, highlightNonce, dataWithDivider]);

  // Mark "scrolled past" once the divider row leaves the viewport — used
  // by the unmount effect below to decide whether to bump last-viewed.
  const viewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 1 }),
    [],
  );
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (!dividerAnchorId) return;
      if (dividerScrolledPastRef.current) return;
      const dividerIdx = dataWithDivider.findIndex(
        (r) => r.entry.id === DIVIDER_ID,
      );
      if (dividerIdx < 0) return;
      const minVisibleIdx = viewableItems.reduce(
        (acc, v) => (v.index != null && v.index < acc ? v.index : acc),
        Number.POSITIVE_INFINITY,
      );
      if (minVisibleIdx > dividerIdx) {
        dividerScrolledPastRef.current = true;
      }
    },
    [dividerAnchorId, dataWithDivider],
  );
  // FlashList v2 captures `viewabilityConfigCallbackPairs` at mount —
  // "Changing viewabilityConfig on the fly is not supported." So we wrap
  // the handler in a stable ref-backed forwarder and pass a frozen pairs
  // array. The inner closure still updates with deps (dividerAnchorId,
  // dataWithDivider), but the prop identity FlashList sees is stable.
  const handlerRef = useRef(handleViewableItemsChanged);
  useEffect(() => {
    handlerRef.current = handleViewableItemsChanged;
  }, [handleViewableItemsChanged]);
  const stableViewabilityHandler = useCallback(
    (info: { viewableItems: ViewToken[] }) => handlerRef.current(info),
    [],
  );
  const viewabilityCallbackPairs = useRef([
    {
      viewabilityConfig,
      onViewableItemsChanged: stableViewabilityHandler,
    },
  ]);

  // On unmount, mark the issue's timeline as "viewed up to now" if the
  // user has either (a) scrolled past the divider or (b) had no divider
  // because everything was already older than their previous visit.
  // Otherwise leave the snapshot alone so a next visit preserves the
  // "where I was" line.
  const markViewed = useLastViewedStore((s) => s.markViewed);
  useEffect(() => {
    const issueId = issue.id;
    return () => {
      if (!dividerAnchorId || dividerScrolledPastRef.current) {
        markViewed(issueId);
      }
    };
    // We intentionally bind the cleanup to the issueId-snapshot only —
    // re-running on `dividerAnchorId` changes would lose the original
    // anchor's "scrolled past" state if WS extended the timeline mid-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue.id]);

  const ListHeader = (
    <View>
      <IssueHeaderCard issue={issue} />
      <IssueDescription issueId={issue.id} description={issue.description} />
      <IssueReactionRow issue={issue} />
      <View className="px-4 pt-4 pb-2 border-t border-border">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Activity
        </Text>
      </View>
      {timelineLoading && (!entries || entries.length === 0) ? (
        <View className="py-6 items-center">
          <ActivityIndicator />
        </View>
      ) : null}
    </View>
  );

  return (
    <ImageSequenceProvider blocks={imageBlocks}>
    <View className="flex-1" ref={viewportRef}>
      {/* Outer Pressable owns the "tap anywhere outside the selected
          comment to exit text-selection mode" gesture. Disabled when
          no comment is selected → layout-only wrapper, every tap passes
          through to cells / chips / reactions. Active state captures any
          tap that didn't fire an inner Pressable — selecting CommentBody
          renders without its own Pressable wrapper (see comment-card.tsx
          `if (isSelecting) return body;`), so taps on the selected
          comment dismiss too, matching iOS Notes / iMessage. Scroll
          gestures are unaffected. */}
      <Pressable
        onPress={
          selectingId
            ? () => useCommentSelectStore.getState().clear()
            : undefined
        }
        disabled={!selectingId}
        style={{ flex: 1 }}
      >
      <FlashList
        ref={listRef}
        data={dataWithDivider}
        keyExtractor={(row) => row.entry.id}
        ListHeaderComponent={ListHeader}
        // Drag-to-dismiss keyboard — when the user scrolls the timeline
        // while the composer keyboard is up, the keyboard slides down
        // interactively (iMessage / WhatsApp / Slack idiom). Pairs with the
        // composer's `onBlur` → auto-collapse to pill: scroll dismisses
        // keyboard → TextInput blurs → composer collapses if empty.
        keyboardDismissMode="on-drag"
        // Tap-on-row inside the list (long-press a comment, tap a
        // reaction) should still register even when the keyboard is up.
        keyboardShouldPersistTaps="handled"
        // FlashList v2 MVCP keeps its default (on): a landing scroll is
        // ordinary visible content, and MVCP is what holds it in place when an
        // upper row resizes via async markdown or a WS event. Two props stay
        // deliberately unset — `startRenderingFromBottom` (an issue-open must
        // show the header first) and `autoscrollToBottomThreshold` (the
        // timeline uses the explicit "↓ N new" chip instead of following
        // appends).
        // "Activity" is a section heading, not a sibling row — it should
        // hug the first entry the way iOS Settings / Linear sections do.
        // 4 px is just enough breathing room without making the heading
        // float above the list. (12 px = row-to-row gap, wrong here.)
        ListHeaderComponentStyle={{ marginBottom: 4 }}
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item }) => {
          if (item.entry.id === DIVIDER_ID) {
            return <UnreadDivider />;
          }
          return item.entry.type === "comment" ? (
            <CommentCard
              entry={item.entry}
              replies={item.replies}
              issueId={issue.id}
              issueIdentifier={issue.identifier}
              highlightedCommentId={highlightedId}
              landingViewRef={setAnchorView}
            />
          ) : (
            <ActivityRow entry={item.entry} />
          );
        }}
        onScroll={handleScroll}
        // Any user-initiated scroll exits comment text-selection mode —
        // matches iMessage's behavior where scrolling implicitly commits /
        // dismisses the selection caret. Hooks both drag-start and the
        // momentum kick after a flick so a fast scroll can't escape.
        onScrollBeginDrag={() => {
          useCommentSelectStore.getState().clear();
          cancelLandingRef.current?.();
        }}
        onMomentumScrollBegin={() => {
          useCommentSelectStore.getState().clear();
          cancelLandingRef.current?.();
        }}
        viewabilityConfigCallbackPairs={viewabilityCallbackPairs.current}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingBottom: 16 }}
      />
      </Pressable>
      {newCount > 0 ? (
        <NewCommentChip count={newCount} onPress={onJumpToNew} />
      ) : null}
    </View>
    </ImageSequenceProvider>
  );
}

/**
 * 12 px vertical gap between every timeline row. FlashList ignores
 * `gap-*` on `contentContainer`, so the spacing is supplied via this
 * separator component — same pattern as chat-message-list.tsx.
 */
function RowSeparator() {
  return <View style={{ height: 12 }} />;
}

/**
 * Horizontal rule + "New" pill spanning the row width. Drawn between the
 * last entry the user had seen on their previous visit and the first one
 * they haven't. Mirrors Slack / iMessage / Things' "unread divider"
 * idiom — a passive visual mark, not interactive (no tap-to-dismiss; it
 * disappears the next time the user scrolls past and unmounts the screen).
 */
function UnreadDivider() {
  return (
    <View className="flex-row items-center gap-2 px-4">
      <View className="flex-1 h-px bg-destructive/40" />
      <Text className="text-[10px] uppercase tracking-wider font-medium text-destructive">
        New
      </Text>
      <View className="flex-1 h-px bg-destructive/40" />
    </View>
  );
}

/**
 * Floating "↓ N new" chip pinned above the composer area. Surfaces WS
 * arrivals the user can't currently see because they're scrolled up.
 * Tap → smooth scrollToEnd + reset counter. Reaching the bottom by hand
 * also clears it (see handleScroll above).
 *
 * Positioned absolute bottom-center inside the parent <View flex-1> wrap;
 * doesn't overlap content because the timeline's `contentContainer`
 * already has its own bottom padding for breathing room above the
 * composer hand-off.
 */
function NewCommentChip({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const fg = THEME[colorScheme].primaryForeground;
  return (
    <Pressable
      onPress={onPress}
      className="absolute bottom-3 self-center px-3.5 py-1.5 rounded-full bg-primary active:opacity-80 flex-row items-center gap-1.5"
      accessibilityRole="button"
      accessibilityLabel={`Jump to ${count} new ${count === 1 ? "message" : "messages"}`}
      style={{
        // shadow comes from system, not Tailwind — keeps the chip readable
        // against either light or dark timeline content beneath.
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
        elevation: 4,
      }}
    >
      <Ionicons name="arrow-down" size={14} color={fg} />
      <Text className="text-xs font-semibold text-primary-foreground">
        {count} new
      </Text>
    </Pressable>
  );
}
