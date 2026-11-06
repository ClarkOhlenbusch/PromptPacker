import { afterEach, expect, it, vi } from "vitest";
import { AgentBridgeClient } from "./AgentBridgeClient";

afterEach(() => vi.unstubAllGlobals());

it("rejects a failed connection so Start can be retried, and ignores an old socket closing", async () => {
  const sockets: MockSocket[] = [];
  class MockSocket {
    static OPEN = 1;
    readyState = 0;
    onopen?: () => void;
    onerror?: () => void;
    onclose?: () => void;
    constructor() { sockets.push(this); }
    close() { this.readyState = 3; this.onclose?.(); }
    send() {}
  }
  vi.stubGlobal("WebSocket", MockSocket);
  const client = new AgentBridgeClient();
  const failed = client.connect();
  sockets[0].onerror!();
  await expect(failed).rejects.toThrow("Open the Bridge app");
  const retried = client.connect();
  sockets[1].readyState = MockSocket.OPEN;
  sockets[1].onopen!();
  await retried;
  sockets[0].close();
  expect(client.isConnected()).toBe(true);
  client.disconnect();
});
