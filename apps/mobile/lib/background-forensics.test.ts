// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getBackgroundSession,
  probeApiReachable,
  recordBackgroundFrame,
  recordJsTick,
  resetBackgroundSession,
  setAppBackgrounded,
} from "./background-forensics";

describe("background session record", () => {
  beforeEach(() => {
    resetBackgroundSession();
  });

  it("counts only what happens between background and foreground", () => {
    // A tick before backgrounding belongs to no session; a tick after the app is
    // back must not land in the finished one either — the panel reports the
    // session, and it has to keep reporting the same numbers while it is read.
    recordJsTick(1_000);
    setAppBackgrounded(true, 2_000);
    recordJsTick(3_000);
    recordJsTick(4_000);
    setAppBackgrounded(false, 5_000);
    recordJsTick(6_000);

    expect(getBackgroundSession()).toMatchObject({
      startedAt: 2_000,
      endedAt: 5_000,
      jsTicks: 2,
    });
  });

  it("counts realtime frames only while backgrounded", () => {
    recordBackgroundFrame();
    setAppBackgrounded(true, 2_000);
    recordBackgroundFrame();
    setAppBackgrounded(false, 3_000);
    recordBackgroundFrame();

    expect(getBackgroundSession()?.frames).toBe(1);
  });

  it("keeps the finished session and starts a new one on the next background", () => {
    setAppBackgrounded(true, 2_000);
    recordJsTick(2_500);
    setAppBackgrounded(false, 3_000);
    expect(getBackgroundSession()).toMatchObject({ startedAt: 2_000, jsTicks: 1 });

    setAppBackgrounded(true, 9_000);
    expect(getBackgroundSession()).toMatchObject({
      startedAt: 9_000,
      endedAt: null,
      jsTicks: 0,
    });
  });
});

describe("probeApiReachable", () => {
  beforeEach(() => {
    resetBackgroundSession();
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://example.test");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("records a probe when the process reaches the server", async () => {
    // An error *status* is still a reachable server — only a thrown request
    // means the network path is blocked, so the two must not be conflated.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    setAppBackgrounded(true);

    expect(await probeApiReachable()).toBe(true);
    expect(getBackgroundSession()).toMatchObject({
      httpProbes: 1,
      httpProbeFailures: 0,
      lastHttpProbeError: null,
    });
  });

  it("records the failure when the request cannot be made", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network request failed");
      }),
    );
    setAppBackgrounded(true);

    expect(await probeApiReachable()).toBe(false);
    expect(getBackgroundSession()).toMatchObject({
      httpProbes: 1,
      httpProbeFailures: 1,
      lastHttpProbeError: "Network request failed",
    });
  });

  it("does not probe outside a background session", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await probeApiReachable()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
