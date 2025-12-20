chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  try {
    // Try sending the message first
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
  } catch (err) {
    // If it fails (e.g., content script not loaded), inject the script
    console.log("Content script not found, injecting...", err);
    
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      
      // Retry sending the message
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
    } catch (injectionErr) {
      console.error("Failed to inject or communicate with content script:", injectionErr);
    }
  }
});