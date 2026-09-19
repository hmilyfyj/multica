/**
 * Record of the newest realtime frame this process has received (FEATURE-562).
 *
 * "No notification in the background" has two very different causes — the phone
 * dropped the banner, or the event never arrived — and the second one is
 * invisible from inside the app: a backgrounded process that the OEM froze
 * simply stops receiving, with nothing to see. The settings screen prints this
 * timestamp next to the last notification attempt, so a user can answer "did
 * anything arrive at all while I was in the background?" without a computer and
 * logcat.
 *
 * Module-level and not React state on purpose: the writer is the websocket
 * subscription in `realtime-provider.tsx`, which lives for the whole workspace
 * session, while the reader is a settings screen that may not even be mounted
 * when the frame lands.
 */

let lastFrameAt: number | null = null;

/** Called for every inbound WS frame (any event type). */
export function recordRealtimeFrame(at: number = Date.now()): void {
  lastFrameAt = at;
}

/** When the newest frame arrived, or null if none has since this process started. */
export function getLastRealtimeFrameAt(): number | null {
  return lastFrameAt;
}
