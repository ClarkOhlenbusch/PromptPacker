export const BRIDGE_URL = "ws://127.0.0.1:47123";
export const BRIDGE_HEALTH_URL = BRIDGE_URL.replace("ws:", "http:") + "/health";
// This page lists Bridge releases only, rather than the unrelated desktop editor.
export const BRIDGE_DOWNLOAD_URL = "https://github.com/ClarkOhlenbusch/PromptPacker/releases?q=bridge-v&expanded=true";
export const BRIDGE_OPEN_URL = "promptpack-bridge://open";

export const AGENT_SETUP_URLS = {
  codex: "https://learn.chatgpt.com/docs/codex/cli",
  claude: "https://code.claude.com/docs/en/overview",
};
