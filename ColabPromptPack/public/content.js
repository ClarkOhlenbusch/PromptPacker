// Content script for PromptPack Colab

function isExtensionContextValid() {
  try {
    chrome.runtime.getURL('');
    return true;
  } catch (e) {
    return false;
  }
}

if (window.hasRunPromptPack && isExtensionContextValid()) {
  console.log("PromptPack: Content script already loaded.");
} else {
  window.hasRunPromptPack = true;
  console.log("PromptPack Colab: Content script loaded");

  const COLAB_ORIGIN = "https://colab.research.google.com";
  const EXTENSION_ORIGIN_PREFIX = "chrome-extension://";

  let overlayContainer = null;
  let overlayIframe = null;
  let cachedCells = [];
  let pendingQuickCopy = false;
  let injectedScriptReady = false;
  let pendingCellRequests = [];
  let pendingGetCellsCallbacks = [];
  let snapshotCells = null; // Persisted snapshot data (survives iframe destroy/recreate)

  function requestCells() {
    if (injectedScriptReady) {
      window.postMessage({ type: "PROMPTPACK_REQUEST_CELLS" }, COLAB_ORIGIN);
    } else {
      pendingCellRequests.push(true);
    }
  }

  // Inject the Page Script
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function () { this.remove(); };
  (document.head || document.documentElement).appendChild(script);

  // Hotkey State
  let quickCopyShortcut = { modifiers: ["Alt", "Shift"], key: "C" };
  let quickCopyIncludesOutput = false;

  chrome.storage.local.get(['quickCopyShortcut', 'quickCopyIncludesOutput'], (result) => {
    if (result.quickCopyShortcut) quickCopyShortcut = result.quickCopyShortcut;
    if (result.quickCopyIncludesOutput !== undefined) quickCopyIncludesOutput = result.quickCopyIncludesOutput;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.quickCopyShortcut) quickCopyShortcut = changes.quickCopyShortcut.newValue;
    if (changes.quickCopyIncludesOutput) quickCopyIncludesOutput = changes.quickCopyIncludesOutput.newValue;
  });

  window.addEventListener("keydown", (e) => {
    const tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (!quickCopyShortcut) return;

    const pressedKey = e.key.toUpperCase();
    const requiredKey = quickCopyShortcut.key.toUpperCase();
    const alt = quickCopyShortcut.modifiers.includes("Alt");
    const shift = quickCopyShortcut.modifiers.includes("Shift");
    const modMeta = quickCopyShortcut.modifiers.includes("Meta") || quickCopyShortcut.modifiers.includes("Command");
    const modCtrl = quickCopyShortcut.modifiers.includes("Control") || quickCopyShortcut.modifiers.includes("Ctrl");

    if (modMeta === e.metaKey && modCtrl === e.ctrlKey && alt === e.altKey && shift === e.shiftKey && pressedKey === requiredKey) {
      e.preventDefault();
      e.stopPropagation();
      pendingQuickCopy = true;
      requestCells();
    }
  });

  window.addEventListener("message", (event) => {
    if (event.data.type === "PROMPTPACK_INJECTED_READY") {
      if (event.source !== window || event.origin !== COLAB_ORIGIN) return;
      injectedScriptReady = true;
      if (pendingCellRequests.length > 0) {
        pendingCellRequests = [];
        window.postMessage({ type: "PROMPTPACK_REQUEST_CELLS" }, COLAB_ORIGIN);
      }
    } else if (event.data.type === "PROMPTPACK_RESPONSE_CELLS") {
      if (event.source !== window || event.origin !== COLAB_ORIGIN) return;
      cachedCells = event.data.cells || [];
      while (pendingGetCellsCallbacks.length > 0) {
        const callback = pendingGetCellsCallbacks.shift();
        try { callback({ cells: cachedCells }); } catch (e) { }
      }
      if (pendingQuickCopy) {
        handleQuickCopy(cachedCells);
        pendingQuickCopy = false;
      }
    } else if (event.data.type === 'CLOSE_PROMPTPACK') {
      if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
      if (overlayIframe && event.source !== overlayIframe.contentWindow) return;
      closeOverlay();
    } else if (event.data.type === 'COPY_TO_CLIPBOARD') {
      if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
      if (overlayIframe && event.source !== overlayIframe.contentWindow) return;
      copyTextToClipboard(event.data.text);
    } else if (event.data.type === 'PROMPTPACK_TAKE_SNAPSHOT') {
      // Take a snapshot: fetch fresh cells and persist them
      if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
      const requestId = event.data.requestId;

      const onCells = (response) => {
        const cells = response.cells || [];
        snapshotCells = cells.map(c => ({
          path: c.path,
          relative_path: c.relative_path,
          content: c.content || "",
          output: c.output || ""
        }));
        console.log("PromptPack content: Snapshot taken,", snapshotCells.length, "cells stored");
        if (overlayIframe && overlayIframe.contentWindow) {
          overlayIframe.contentWindow.postMessage({
            type: "PROMPTPACK_SNAPSHOT_RESPONSE",
            requestId: requestId,
            payload: { success: true, cellCount: snapshotCells.length }
          }, "*");
        }
      };

      let resolved = false;
      const wrappedCallback = (response) => { if (!resolved) { resolved = true; onCells(response); } };
      pendingGetCellsCallbacks.push(wrappedCallback);
      requestCells();
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const idx = pendingGetCellsCallbacks.indexOf(wrappedCallback);
          if (idx > -1) pendingGetCellsCallbacks.splice(idx, 1);
          onCells({ cells: cachedCells });
        }
      }, 5000);
    } else if (event.data.type === 'PROMPTPACK_GET_SNAPSHOT') {
      // Return the persisted snapshot to the iframe
      if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
      const requestId = event.data.requestId;
      if (overlayIframe && overlayIframe.contentWindow) {
        overlayIframe.contentWindow.postMessage({
          type: "PROMPTPACK_SNAPSHOT_RESPONSE",
          requestId: requestId,
          payload: { cells: snapshotCells || [] }
        }, "*");
      }
    } else if (event.data.type === 'PROMPTPACK_CLEAR_SNAPSHOT') {
      // Clear the persisted snapshot
      if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
      snapshotCells = null;
      console.log("PromptPack content: Snapshot cleared");
    } else if (event.data.type === 'SHOW_TOAST') {
      // Show a toast notification
      if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
      showToast(event.data.text || "Action successful", event.data.isError || false);
    } else if (event.data.type === 'PROMPTPACK_GET_CELLS') {
      // Handle cell requests from the extension iframe
      if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;

      const requestId = event.data.requestId;

      const sendCellsToIframe = (cells) => {
        try {
          if (overlayIframe && overlayIframe.contentWindow) {
            overlayIframe.contentWindow.postMessage({
              type: "PROMPTPACK_CELLS_RESPONSE",
              requestId: requestId,
              payload: { cells: cells }
            }, "*");
          }
        } catch (e) {
          console.error("PromptPack content: Failed to send cells to iframe", e);
        }
      };

      let resolved = false;
      const wrappedCallback = (response) => {
        if (!resolved) {
          resolved = true;
          sendCellsToIframe(response.cells || []);
        }
      };
      pendingGetCellsCallbacks.push(wrappedCallback);
      requestCells();
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const idx = pendingGetCellsCallbacks.indexOf(wrappedCallback);
          if (idx > -1) pendingGetCellsCallbacks.splice(idx, 1);
          sendCellsToIframe(cachedCells.length > 0 ? cachedCells : []);
        }
      }, 5000);
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      if (request.type === "GET_CELLS") {
        if (cachedCells.length > 0) {
          sendResponse({ cells: cachedCells });
          return false;
        }
        let resolved = false;
        const wrappedCallback = (response) => { if (!resolved) { resolved = true; sendResponse(response); } };
        pendingGetCellsCallbacks.push(wrappedCallback);
        requestCells();
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            const idx = pendingGetCellsCallbacks.indexOf(wrappedCallback);
            if (idx > -1) pendingGetCellsCallbacks.splice(idx, 1);
            sendResponse({ cells: [], error: "Timeout" });
          }
        }, 5000);
        return true;
      } else if (request.type === "TOGGLE_OVERLAY") {
        toggleOverlay();
        requestCells();
        sendResponse({ success: true });
      } else if (request.type === "TRIGGER_QUICK_COPY") {
        pendingQuickCopy = true;
        requestCells();
        sendResponse({ success: true });
      } else if (request.type === "PING") {
        sendResponse({ success: true });
      }
    } catch (error) {
      sendResponse({ error: error.message });
    }
    return true;
  });

  function handleQuickCopy(cells) {
    if (!cells || cells.length === 0) {
      showToast("PromptPack: No cells found to copy.", true);
      return;
    }
    copyTextToClipboard(generatePromptString(cells), true);
  }

  function generatePromptString(cells) {
    let output = "### PROJECT STRUCTURE ###\n";
    cells.forEach(cell => {
      output += `├─ ${cell.relative_path} (${formatSize(cell.size)}, ${cell.line_count || 0} lines)\n`;
    });
    output += "\n\n### FILE CONTENTS ###\n\n";
    cells.forEach(cell => {
      output += `##### File: ${cell.relative_path} (FULL) #####\n\`\`\`python\n${cell.content}\n\`\`\`\n`;
      if (quickCopyIncludesOutput && cell.output && cell.output.trim().length > 0) {
        output += `\n# Output:\n\`\`\`text\n${cell.output}\n\`\`\`\n`;
      }
      output += "\n";
    });
    return output;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function copyTextToClipboard(text, showToastMsg = false) {
    try {
      await navigator.clipboard.writeText(text);
      if (showToastMsg) showToast("Notebook Copied to Clipboard!");
    } catch (err) {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful && showToastMsg) showToast("Notebook Copied to Clipboard!");
        else if (!successful) throw new Error("execCommand failed");
      } catch (fallbackErr) {
        if (showToastMsg) showToast("Failed to Copy", true);
      }
    }
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.innerText = message;
    Object.assign(toast.style, {
      position: "fixed", bottom: "20px", right: "20px",
      backgroundColor: isError ? "#ef4444" : "#0069C3", color: "white",
      padding: "12px 24px", borderRadius: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      zIndex: "2147483647", fontFamily: "sans-serif", fontSize: "14px", fontWeight: "bold",
      opacity: "0", transition: "opacity 0.3s ease, transform 0.3s ease", transform: "translateY(10px)"
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = "1"; toast.style.transform = "translateY(0)"; });
    setTimeout(() => {
      toast.style.opacity = "0"; toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function toggleOverlay() {
    if (overlayContainer) closeOverlay();
    else openOverlay();
  }

  function openOverlay() {
    if (overlayContainer) return;
    overlayContainer = document.createElement('div');
    overlayContainer.id = "promptpack-overlay-container";
    Object.assign(overlayContainer.style, {
      position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
      zIndex: '2147483647', backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)'
    });
    overlayContainer.onclick = (e) => { if (e.target === overlayContainer) closeOverlay(); };
    overlayIframe = document.createElement('iframe');
    overlayIframe.src = chrome.runtime.getURL("index.html");
    Object.assign(overlayIframe.style, {
      width: '90%', maxWidth: '1200px', height: '85%', maxHeight: '900px',
      border: 'none', borderRadius: '12px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', backgroundColor: 'white'
    });
    overlayContainer.appendChild(overlayIframe);
    document.body.appendChild(overlayContainer);
  }

  function closeOverlay() {
    if (overlayContainer) { overlayContainer.remove(); overlayContainer = null; overlayIframe = null; }
  }
}
