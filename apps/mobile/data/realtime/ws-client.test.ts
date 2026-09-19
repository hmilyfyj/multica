import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WSClient } from "./ws-client";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  send(frame: string) {
    this.sent.push(frame);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

function connectAuthenticatedClient() {
  const client = new WSClient({
    url: "wss://example.test/ws",
    token: "token",
    workspaceSlug: "workspace",
    clientOS: "ios",
  });
  client.connect();
  const socket = MockWebSocket.instances[0];
  socket.open();
  socket.receive({ type: "auth_ack" });
  return { client, socket };
}

describe("WSClient application heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reconnects a stale OPEN socket through the jittered backoff path", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { client, socket } = connectAuthenticatedClient();

    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { type: "auth", payload: { token: "token" } },
      { type: "ping" },
    ]);

    // No pong arrives even though the JS-visible readyState remains OPEN.
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(1);

    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it("keeps a healthy socket connected when its pong arrives", () => {
    const { client, socket } = connectAuthenticatedClient();
    socket.receive({ type: "pong" });

    vi.advanceTimersByTime(10_000);

    expect(MockWebSocket.instances).toHaveLength(1);
    client.disconnect();
  });
});

// A phone reconnects constantly — after every backgrounding, every network
// switch. By the time it does, a sliding session may have been renewed, and
// the token captured when this client was built is on its way out (MUL-7436).
describe("WSClient session renewal", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("authenticates each connection with the current token", () => {
    let current = "token-v1";
    const client = new WSClient({
      url: "wss://example.test/ws",
      token: "token-v1",
      workspaceSlug: "workspace",
      clientOS: "ios",
      getToken: () => current,
    });

    client.connect();
    MockWebSocket.instances[0].open();
    expect(JSON.parse(MockWebSocket.instances[0].sent[0])).toEqual({
      type: "auth",
      payload: { token: "token-v1" },
    });

    current = "token-v2";
    client.forceReconnect();
    const reconnected = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    reconnected.open();

    expect(JSON.parse(reconnected.sent[0])).toEqual({
      type: "auth",
      payload: { token: "token-v2" },
    });
  });

  it("falls back to the constructor token when no reader is supplied", () => {
    const client = new WSClient({
      url: "wss://example.test/ws",
      token: "token-only",
      workspaceSlug: "workspace",
      clientOS: "ios",
    });

    client.connect();
    MockWebSocket.instances[0].open();

    expect(JSON.parse(MockWebSocket.instances[0].sent[0])).toEqual({
      type: "auth",
      payload: { token: "token-only" },
    });
  });
});

// The server records client_os verbatim for macos / windows / linux / ios /
// android / chromeos, and normalizes anything else to `unknown`
// (server/internal/handler/client_usage.go). A literal in the transport is how
// every Android device reported `ios` in the backend logs (FEATURE-559).
describe("WSClient client identity", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports the caller's platform as client_os", () => {
    const client = new WSClient({
      url: "wss://example.test/ws",
      token: "token",
      workspaceSlug: "workspace",
      clientOS: "android",
    });

    client.connect();

    const dialed = new URL(MockWebSocket.instances[0].url);
    expect(dialed.searchParams.get("client_os")).toBe("android");
    expect(dialed.searchParams.get("client_platform")).toBe("mobile");

    client.disconnect();
  });
});

// An upgrade can open and then never authenticate — a half-open socket after a
// network flap, or a server that never answers the auth frame. The heartbeat
// only covers authenticated sockets, so this state used to have no timer, no
// onclose and no redial: the client never reconnected, so no subscriber was
// told to refresh and the visible data stayed stale until a remount.
describe("WSClient auth handshake", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("redials a socket that opens but never authenticates", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = new WSClient({
      url: "wss://example.test/ws",
      token: "token",
      workspaceSlug: "workspace",
      clientOS: "ios",
    });

    client.connect();
    MockWebSocket.instances[0].open();

    // Past the handshake window; the extra tick runs the jittered redial the
    // failure schedules (same shape as the heartbeat test above).
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(1);

    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it("keeps the socket once auth_ack lands", () => {
    const { client, socket } = connectAuthenticatedClient();

    // Past the handshake window, answering each ping so that the heartbeat —
    // and not a watchdog left armed — is the only thing that could redial.
    for (let round = 0; round < 2; round += 1) {
      socket.receive({ type: "pong" });
      vi.advanceTimersByTime(10_000);
    }

    expect(MockWebSocket.instances).toHaveLength(1);
    client.disconnect();
  });
});
