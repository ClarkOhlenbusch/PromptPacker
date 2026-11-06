import { useEffect, useState } from "react";
import { BRIDGE_HEALTH_URL } from "../services/bridgeSetup";

interface BridgeHealth {
  ok: boolean;
  service?: string;
  agents?: { codex: boolean; claude: boolean };
}

export function useBridgeAvailability(connected: boolean) {
  const [status, setStatus] = useState<"checking" | "ready" | "missing">("checking");
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (connected) return;
    let disposed = false;
    let controller: AbortController | null = null;
    const check = async () => {
      if (controller) return;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 2000);
      try {
        const response = await fetch(BRIDGE_HEALTH_URL, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Bridge unavailable");
        const data = await response.json() as BridgeHealth;
        if (!data.ok || (data.service && data.service !== "promptpack-bridge")) throw new Error("Not PromptPack Bridge");
        if (!disposed) { setHealth(data); setStatus("ready"); }
      } catch {
        if (!disposed) { setHealth(null); setStatus("missing"); }
      } finally {
        window.clearTimeout(timeout);
        controller = null;
      }
    };
    void check();
    const interval = window.setInterval(() => { void check(); }, 3000);
    const onFocus = () => { void check(); };
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [connected, retry]);

  return { status: connected ? "ready" as const : status, health, checkAgain: () => setRetry(value => value + 1) };
}
