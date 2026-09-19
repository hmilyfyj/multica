/**
 * Background-session forensics (FEATURE-562).
 *
 * "Nothing arrives while the app is in the background" has exactly two
 * mechanisms, and they need opposite fixes:
 *
 *   1. the OS stopped running the process — Android freezes *cached* apps
 *      through the cgroup freezer, which is a different switch from the battery
 *      policy ("no restrictions" does not exempt an app from being frozen). A
 *      frozen process keeps all its memory and resumes instantly, so "the app
 *      was not killed" is no evidence that it ever ran; or
 *   2. the process ran, but the data did not arrive (dead socket, or background
 *      network blocked by the ROM).
 *
 * The app can tell these apart by itself. Between going to the background and
 * coming back, three numbers are collected:
 *
 *   - **JS ticks** — a timer that runs whenever the JS thread gets CPU. Zero
 *     ticks means the process was frozen (mechanism 1), and nothing at the
 *     socket layer could have been read.
 *   - **Realtime frames** — WS frames that actually arrived.
 *   - **HTTP probes** — a request issued from the same process, which separates
 *     "the network path is blocked" from "the socket is dead" once ticks say the
 *     process was running.
 *
 * The settings screen renders the verdict ("On this device" → background
 * section); this module owns the record. Module-level rather than React state
 * because the writers live for the app's whole lifetime while the reader is a
 * settings screen that is usually not mounted when they fire.
 *
 * This module must not import `react-native` (Node test lane — see
 * `apps/mobile/vitest.config.ts`); its callers are RN-side.
 */

const PROBE_TIMEOUT_MS = 10_000;

export interface BackgroundSession {
  /** When the app last went to the background. */
  startedAt: number;
  /** When it came back, or null while it is still backgrounded. */
  endedAt: number | null;
  /** JS timer ticks during the session. Zero ⇒ the process was frozen. */
  jsTicks: number;
  /** WS frames during the session. */
  frames: number;
  httpProbes: number;
  httpProbeFailures: number;
  lastHttpProbeError: string | null;
}

let backgrounded = false;
let session: BackgroundSession | null = null;
let lastJsTickAt: number | null = null;

/** Every tick of the app-lifetime timer, foreground or background. */
export function recordJsTick(at: number = Date.now()): void {
  lastJsTickAt = at;
  const current = session;
  if (current && current.endedAt === null) current.jsTicks += 1;
}

export function getLastJsTickAt(): number | null {
  return lastJsTickAt;
}

/** Every inbound WS frame (any event type), called from the realtime provider. */
export function recordBackgroundFrame(): void {
  const current = session;
  if (current && current.endedAt === null) current.frames += 1;
}

/**
 * Track the foreground/background edge. Going to the background starts a fresh
 * session; returning to the foreground stamps its end but **keeps** it, because
 * that is when the user reads it.
 */
export function setAppBackgrounded(next: boolean, at: number = Date.now()): void {
  if (next === backgrounded) return;
  backgrounded = next;
  if (next) {
    session = {
      startedAt: at,
      endedAt: null,
      jsTicks: 0,
      frames: 0,
      httpProbes: 0,
      httpProbeFailures: 0,
      lastHttpProbeError: null,
    };
  } else if (session && session.endedAt === null) {
    session.endedAt = at;
  }
}

export function isAppBackgrounded(): boolean {
  return backgrounded;
}

export function getBackgroundSession(): BackgroundSession | null {
  return session;
}

/** Test seam: forget the recorded session. */
export function resetBackgroundSession(): void {
  session = null;
  backgrounded = false;
}

/**
 * One request from the same process, to prove the network path while
 * backgrounded. Any HTTP answer counts — a 404 still proves the process reached
 * the server; only a thrown request means the path is blocked.
 */
export async function probeApiReachable(): Promise<boolean> {
  const base = process.env.EXPO_PUBLIC_API_URL;
  const current = session;
  if (!base || !current || current.endedAt !== null) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new Error("probe timed out")),
    PROBE_TIMEOUT_MS,
  );
  try {
    await fetch(base, { method: "HEAD", signal: controller.signal });
    current.httpProbes += 1;
    return true;
  } catch (err) {
    current.httpProbes += 1;
    current.httpProbeFailures += 1;
    current.lastHttpProbeError =
      err instanceof Error ? err.message : String(err);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
