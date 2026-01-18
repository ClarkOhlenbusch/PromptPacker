async function ensureContentScript(tabId) {
  try {
    // Try sending a dummy ping to see if the script is there
    const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (!response || !response.success) {
      throw new Error("No valid response from content script");
    }
  } catch (err) {
    // If it fails, inject the script
    console.log("PromptPack: Injecting content script into tab " + tabId);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"]
    });
    // Wait for script to initialize its listeners
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

async function sendMessageWithRetry(tabId, message, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch (err) {
      console.log(`PromptPack: Attempt ${attempt}/${maxRetries} failed for ${message.type}`);
      if (attempt < maxRetries) {
        // Wait before retry, increasing delay each attempt
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        // Try re-injecting the content script
        await ensureContentScript(tabId);
      } else {
        throw err;
      }
    }
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url?.startsWith("https://colab.research.google.com/")) {
    return;
  }
  try {
    await ensureContentScript(tab.id);
    await sendMessageWithRetry(tab.id, { type: "TOGGLE_OVERLAY" });
  } catch (err) {
    console.warn("PromptPack: Failed to toggle overlay after retries.", err);
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "copy-notebook-full" && tab.id && tab.url?.startsWith("https://colab.research.google.com/")) {
    try {
      await ensureContentScript(tab.id);
      await sendMessageWithRetry(tab.id, { type: "TRIGGER_QUICK_COPY" });
    } catch (err) {
      console.warn("PromptPack: Quick Copy failed after retries.", err);
    }
  }
});
