import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("hides and reopens the same iframe, and docks agent mode without a notebook backdrop", async () => {
  vi.useFakeTimers();
  let handleRuntimeMessage!: (request: { type: string }, sender: object, respond: (value: unknown) => void) => void;
  vi.stubGlobal("chrome", {
    runtime: {
      getURL: (path: string) => `chrome-extension://promptpack/${path}`,
      onMessage: { addListener: vi.fn(handler => { handleRuntimeMessage = handler; }) },
    },
    storage: {
      local: { get: (_keys: unknown, callback: (result: object) => void) => callback({}) },
      onChanged: { addListener: vi.fn() },
    },
  });
  await import("./content");
  const toggle = () => handleRuntimeMessage({ type: "TOGGLE_OVERLAY" }, {}, vi.fn());
  toggle();
  const container = document.getElementById("promptpack-overlay-container")!;
  const iframe = container.querySelector("iframe")!;
  const frameWindow = iframe.contentWindow;
  toggle();
  expect(container.isConnected).toBe(true);
  expect(container.style.display).toBe("none");
  expect(iframe.contentWindow).toBe(frameWindow);
  document.getElementById("promptpack-reopen")!.click();
  expect(container.style.display).toBe("flex");
  expect(document.querySelectorAll("#promptpack-overlay-container iframe")).toHaveLength(1);
  expect(container.querySelector("iframe")).toBe(iframe);

  window.dispatchEvent(new MessageEvent("message", {
    data: { type: "PROMPTPACK_PANEL_MODE", mode: "agent" },
    origin: "chrome-extension://promptpack", source: frameWindow,
  }));
  expect(container.style.width).toBe("620px");
  expect(container.style.maxWidth).toBe("100vw");
  expect(container.style.left).toBe("auto");
  expect(container.style.backgroundColor).toBe("transparent");
  expect(iframe.style.width).toBe("100%");
  toggle();
  expect(iframe.contentWindow).toBe(frameWindow);
  const received = vi.spyOn(frameWindow!, "postMessage");
  window.dispatchEvent(new MessageEvent("message", {
    data: { type: "PROMPTPACK_APPLY_RESULT", requestId: "hidden-sync", payload: { success: true } },
    origin: "https://colab.research.google.com", source: window,
  }));
  expect(received).toHaveBeenCalledWith(expect.objectContaining({ requestId: "hidden-sync" }), "*");
});
