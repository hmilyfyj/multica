import { useAuthStore } from "@/data/auth-store";

/**
 * Timezone every calendar day-bucket is sliced in, for the Usage screen's
 * dashboard reads.
 *
 * Mirrors `packages/views/common/use-viewing-timezone.ts`: the user's stored
 * preference wins, otherwise the device's zone. Unlike web there is no
 * Preferences screen on mobile yet, so the stored value is whatever the user
 * set on web (the profile carries it).
 *
 * `null` is a meaningful return: the callers omit the `tz` parameter entirely
 * rather than sending a guess, and the server then falls back to the caller's
 * stored timezone and finally UTC (`resolveViewingTZ`,
 * server/internal/handler/runtime.go).
 */
export function useViewingTimezone(): string | null {
  const stored = useAuthStore((s) => s.user?.timezone ?? null);
  if (stored && stored.trim() !== "") return stored;
  return deviceTimezone();
}

/** Hermes ships Intl, but a broken device zone must not take a screen down. */
function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
