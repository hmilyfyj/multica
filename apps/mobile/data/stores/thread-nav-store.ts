/**
 * Cross-route channel between the issue timeline
 * (`components/issue/timeline-list.tsx`) and the thread outline formSheet
 * (`app/(app)/[workspace]/issue/[id]/threads.tsx`). The sheet is a separate
 * route and cannot reach the list's refs, so the jump is handed off here —
 * same two-slot shape as `chat-session-picker-store.ts`:
 *
 *   - `jumpRequest` — the sheet writes the thread root the user picked and
 *     dismisses itself; the timeline reads it, lands, then `consumeJump()`s.
 *     One-shot, so a later re-render or WS append cannot replay the jump.
 *   - `currentThreadId` — the timeline mirrors which thread the viewport is
 *     inside, so the sheet can mark the row the reader is on. Writing the
 *     same id twice must not notify: the list writes this on every
 *     viewability change while scrolling, and only the sheet (and the
 *     floating stepper) subscribe.
 *
 * Issue-scoped state, but nothing here needs clearing between issues: a
 * request that names a root absent from the open timeline resolves to no
 * landing (lib/comment-landing.ts returns null) and a stale current id
 * simply matches no row.
 */
import { create } from "zustand";

interface ThreadNavState {
  jumpRequest: { rootId: string; nonce: number } | null;
  requestJump: (rootId: string) => void;
  consumeJump: () => void;
  currentThreadId: string | null;
  setCurrentThreadId: (id: string | null) => void;
}

export const useThreadNavStore = create<ThreadNavState>((set, get) => ({
  jumpRequest: null,
  // Nonce re-arms a jump to the thread the user is already on: the id alone
  // would short-circuit the timeline's per-(id, nonce) stamp.
  requestJump: (rootId) =>
    set({ jumpRequest: { rootId, nonce: (get().jumpRequest?.nonce ?? 0) + 1 } }),
  consumeJump: () => set({ jumpRequest: null }),
  currentThreadId: null,
  setCurrentThreadId: (id) => {
    if (get().currentThreadId !== id) set({ currentThreadId: id });
  },
}));
