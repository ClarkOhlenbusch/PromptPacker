async function ensureContentScript(tabId) {
  try {
    // Try sending a dummy ping to see if the script is there
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch (err) {
    // If it fails, inject the script
    console.log("PromptPack: Injecting content script into tab " + tabId);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"]
    });
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    try {
      await ensureContentScript(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
    } catch (err) {
      console.warn("PromptPack: Failed to toggle overlay.", err);
    }
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "copy-notebook-full" && tab.id) {
    try {
      await ensureContentScript(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_QUICK_COPY" });
    } catch (err) {
      console.warn("PromptPack: Quick Copy failed.", err);
    }
  }
});
