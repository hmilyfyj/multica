/**
 * Thread outline route for an issue — presented as a formSheet by the parent
 * Stack (registered in `app/(app)/[workspace]/_layout.tsx`), pushed from the
 * timeline's floating thread stepper.
 *
 * Owns its data lookup like every other sheet body: it reads the same
 * `issueTimelineOptions` cache the detail screen fills, so opening it costs no
 * request, and runs the timeline's own pipeline (coalesce → bundle replies
 * into their root row → index) so the outline's order is the page's order.
 *
 * Picking a thread hands the id to the timeline through
 * `data/stores/thread-nav-store.ts` and dismisses; the timeline is mounted
 * behind the sheet, so it lands while the sheet is still sliding away.
 */
import { useCallback, useMemo } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ThreadNavSheet } from "@/components/issue/thread-nav-sheet";
import { issueTimelineOptions } from "@/data/queries/issues";
import { useThreadNavStore } from "@/data/stores/thread-nav-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { coalesceTimeline } from "@/lib/timeline-coalesce";
import { buildTimelineRows } from "@/lib/timeline-thread";
import { buildThreadNav } from "@/lib/thread-nav";

export default function IssueThreadsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: entries } = useQuery(issueTimelineOptions(wsId, id));
  const currentThreadId = useThreadNavStore((s) => s.currentThreadId);
  const requestJump = useThreadNavStore((s) => s.requestJump);

  const threads = useMemo(
    () => buildThreadNav(buildTimelineRows(coalesceTimeline(entries ?? []))),
    [entries],
  );

  const onJump = useCallback(
    (rootId: string) => {
      requestJump(rootId);
      router.back();
    },
    [requestJump],
  );

  return (
    <ThreadNavSheet
      threads={threads}
      currentThreadId={currentThreadId}
      onJump={onJump}
    />
  );
}
