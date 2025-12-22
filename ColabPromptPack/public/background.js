chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" })
      .catch(err => {
        console.warn("PromptPack: Content script not ready. Please refresh the page.", err);
      });
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "copy-notebook-full" && tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_QUICK_COPY" })
      .catch(err => {
        console.warn("PromptPack: Quick Copy failed. Refresh page?", err);
      });
  }
});