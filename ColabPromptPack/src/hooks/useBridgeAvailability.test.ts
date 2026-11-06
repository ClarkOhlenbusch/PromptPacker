import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBridgeAvailability } from "./useBridgeAvailability";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("discovers Bridge after installation without surfacing connection errors", async () => {
  vi.useFakeTimers();
  const fetchHealth = vi.fn().mockRejectedValue(new Error("Not running"));
  vi.stubGlobal("fetch", fetchHealth);
  const { result } = renderHook(() => useBridgeAvailability(false));
  await act(async () => {});
  expect(result.current.status).toBe("missing");
  fetchHealth.mockResolvedValue({ ok: true, json: async () => ({ service: "promptpack-bridge", ok: true, agents: { codex: true, claude: false } }) });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(result.current.status).toBe("ready");
  expect(result.current.health?.agents).toEqual({ codex: true, claude: false });
});

it("rejects unrelated services and provides a manual recheck", async () => {
  const fetchHealth = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, service: "unrelated-service" }) });
  vi.stubGlobal("fetch", fetchHealth);
  const { result } = renderHook(() => useBridgeAvailability(false));
  await act(async () => {});
  expect(result.current.status).toBe("missing");
  fetchHealth.mockResolvedValue({ ok: true, json: async () => ({ ok: true, service: "promptpack-bridge" }) });
  await act(async () => { result.current.checkAgain(); });
  expect(result.current.status).toBe("ready");
});

it("does not probe or show setup when a bridge session is already connected", () => {
  const fetchHealth = vi.fn();
  vi.stubGlobal("fetch", fetchHealth);
  const { result } = renderHook(() => useBridgeAvailability(true));
  expect(result.current.status).toBe("ready");
  expect(fetchHealth).not.toHaveBeenCalled();
});
