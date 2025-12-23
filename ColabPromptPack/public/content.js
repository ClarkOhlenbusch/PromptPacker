// Content script for PromptPack Colab

// Check if extension context is still valid (handles extension updates/reloads)
function isExtensionContextValid() {
  try {
    chrome.runtime.getURL('');
    return true;
  } catch (e) {
    return false;
  }
}

if (window.hasRunPromptPack && isExtensionContextValid()) {
  console.log("PromptPack: Content script already loaded and context valid. Skipping re-initialization.");
} else {
  if (window.hasRunPromptPack) {
    console.log("PromptPack: Extension context was invalidated. Re-initializing...");
  }
  window.hasRunPromptPack = true;
  console.log("PromptPack Colab: Content script loaded");

  // Security: Define allowed origins for postMessage communication
  const COLAB_ORIGIN = "https://colab.research.google.com";
  const EXTENSION_ORIGIN_PREFIX = "chrome-extension://";

  let overlayContainer = null;
  let overlayIframe = null; // Store reference to iframe for origin validation
let cachedCells = [];
let cachedDiffs = [];
let pendingQuickCopy = false;
let injectedScriptReady = false;
let pendingCellRequests = [];
let pendingGetCellsCallbacks = []; // Queue for GET_CELLS response callbacks
let pendingGetDiffsCallbacks = []; // Queue for GET_DIFFS response callbacks
let pendingSnapshotCallbacks = []; // Queue for TAKE_SNAPSHOT response callbacks

// Helper to request cells, queuing if injected script isn't ready yet
function requestCells() {
  if (injectedScriptReady) {
    window.postMessage({ type: "PROMPTPACK_REQUEST_CELLS" }, COLAB_ORIGIN);
  } else {
    console.log("PromptPack: Injected script not ready, queuing cell request");
    pendingCellRequests.push(true);
  }
}

// Helper to request diffs
function requestDiffs() {
  if (injectedScriptReady) {
    window.postMessage({ type: "PROMPTPACK_REQUEST_DIFFS" }, COLAB_ORIGIN);
  } else {
    console.log("PromptPack: Injected script not ready for diffs");
  }
}

// Helper to take a snapshot (mark current state as baseline)
function requestSnapshot() {
  if (injectedScriptReady) {
    window.postMessage({ type: "PROMPTPACK_TAKE_SNAPSHOT" }, COLAB_ORIGIN);
  } else {
    console.log("PromptPack: Injected script not ready for snapshot");
  }
}

// Helper to clear history
function requestClearHistory(cellPath = null) {
  if (injectedScriptReady) {
    window.postMessage({ type: "PROMPTPACK_CLEAR_HISTORY", cellPath: cellPath }, COLAB_ORIGIN);
  }
}

// 1. Inject the Page Script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() {
    this.remove(); // Clean up script tag
};
(document.head || document.documentElement).appendChild(script);



// Hotkey State

let quickCopyShortcut = {

  modifiers: ["Alt", "Shift"],

  key: "C" // Upper case for code comparison

};

let quickCopyIncludesOutput = false;

// Load saved shortcut and settings

chrome.storage.local.get(['quickCopyShortcut', 'quickCopyIncludesOutput'], (result) => {
  console.log("PromptPack: Loaded settings from storage", result);

  if (result.quickCopyShortcut) {
    quickCopyShortcut = result.quickCopyShortcut;
  }

  if (result.quickCopyIncludesOutput !== undefined) {
     quickCopyIncludesOutput = result.quickCopyIncludesOutput;
     console.log("PromptPack: Initial quickCopyIncludesOutput =", quickCopyIncludesOutput);
  }
});



// Listen for updates

chrome.storage.onChanged.addListener((changes, areaName) => {
  console.log("PromptPack: Storage changed", areaName, changes);

  if (changes.quickCopyShortcut) {
    quickCopyShortcut = changes.quickCopyShortcut.newValue;
    console.log("PromptPack: Updated quickCopyShortcut", quickCopyShortcut);
  }

  if (changes.quickCopyIncludesOutput) {
     quickCopyIncludesOutput = changes.quickCopyIncludesOutput.newValue;
     console.log("PromptPack: Updated quickCopyIncludesOutput to", quickCopyIncludesOutput);
  }
});



// Global Key Listener

window.addEventListener("keydown", (e) => {

  // Ignore if user is typing in an input

  const tag = e.target.tagName.toLowerCase();

  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;



  if (!quickCopyShortcut) return;



  const pressedKey = e.key.toUpperCase();

  const requiredKey = quickCopyShortcut.key.toUpperCase();



  // Check Modifiers

  const alt = quickCopyShortcut.modifiers.includes("Alt");

  const shift = quickCopyShortcut.modifiers.includes("Shift");

  const ctrl = quickCopyShortcut.modifiers.includes("Ctrl") || quickCopyShortcut.modifiers.includes("Meta"); // Treat Meta (Cmd) as Ctrl for simplicity or separate?

  // Let's match strict names: "Meta", "Control", "Alt", "Shift"



  const modMeta = quickCopyShortcut.modifiers.includes("Meta") || quickCopyShortcut.modifiers.includes("Command");

  const modCtrl = quickCopyShortcut.modifiers.includes("Control") || quickCopyShortcut.modifiers.includes("Ctrl");

  

  const matchesMeta = modMeta === e.metaKey;

  const matchesCtrl = modCtrl === e.ctrlKey;

  const matchesAlt = alt === e.altKey;

  const matchesShift = shift === e.shiftKey;



  if (matchesMeta && matchesCtrl && matchesAlt && matchesShift && pressedKey === requiredKey) {
     e.preventDefault();
     e.stopPropagation();
     pendingQuickCopy = true;
     requestCells();
     showToast("Quick Copy Triggered...");
  }

});



// 2. Listen for Data from Page Script & Overlay IFrame
window.addEventListener("message", (event) => {
  // We accept messages from:
  // 1. The page itself (injected script) -> PROMPTPACK_RESPONSE_CELLS, PROMPTPACK_INJECTED_READY
  // 2. The overlay IFrame (App.tsx) -> CLOSE_PROMPTPACK, COPY_TO_CLIPBOARD

  if (event.data.type === "PROMPTPACK_INJECTED_READY") {
    // Security: Only accept from the same window and origin (injected script)
    if (event.source !== window || event.origin !== COLAB_ORIGIN) return;
    console.log("PromptPack: Injected script is ready");
    injectedScriptReady = true;

    // Process any queued cell requests
    if (pendingCellRequests.length > 0) {
      console.log(`PromptPack: Processing ${pendingCellRequests.length} queued cell requests`);
      pendingCellRequests = [];
      window.postMessage({ type: "PROMPTPACK_REQUEST_CELLS" }, COLAB_ORIGIN);
    }
  } else if (event.data.type === "PROMPTPACK_RESPONSE_CELLS") {
    // Security: Only accept cell data from the same window and origin (injected script)
    if (event.source !== window || event.origin !== COLAB_ORIGIN) return;

    const cells = event.data.cells || [];
    cachedCells = cells;

    // Resolve all pending GET_CELLS callbacks
    while (pendingGetCellsCallbacks.length > 0) {
      const callback = pendingGetCellsCallbacks.shift();
      try {
        callback({ cells: cells });
      } catch (e) {
        console.warn("PromptPack: Error in GET_CELLS callback", e);
      }
    }

    if (pendingQuickCopy) {
      handleQuickCopy(cells);
      pendingQuickCopy = false;
    }
  } else if (event.data.type === "PROMPTPACK_RESPONSE_DIFFS") {
    // Security: Only accept diff data from the same window and origin (injected script)
    if (event.source !== window || event.origin !== COLAB_ORIGIN) return;

    const diffs = event.data.diffs || [];
    cachedDiffs = diffs;

    // Resolve all pending GET_DIFFS callbacks
    while (pendingGetDiffsCallbacks.length > 0) {
      const callback = pendingGetDiffsCallbacks.shift();
      try {
        callback({ diffs: diffs });
      } catch (e) {
        console.warn("PromptPack: Error in GET_DIFFS callback", e);
      }
    }
  } else if (event.data.type === "PROMPTPACK_SNAPSHOT_TAKEN") {
    // Security: Only accept from the same window and origin (injected script)
    if (event.source !== window || event.origin !== COLAB_ORIGIN) return;

    const count = event.data.cellCount || 0;
    showToast(`Snapshot taken: ${count} cells`);

    // Resolve all pending snapshot callbacks
    while (pendingSnapshotCallbacks.length > 0) {
      const callback = pendingSnapshotCallbacks.shift();
      try {
        callback({ success: true, cellCount: count });
      } catch (e) {
        console.warn("PromptPack: Error in snapshot callback", e);
      }
    }
  } else if (event.data.type === "PROMPTPACK_HISTORY_CLEARED") {
    // Security: Only accept from the same window and origin (injected script)
    if (event.source !== window || event.origin !== COLAB_ORIGIN) return;
    showToast("History cleared");
  } else if (event.data.type === 'CLOSE_PROMPTPACK') {
    // Security: Only accept from our extension iframe
    if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) {
      console.warn("PromptPack: Rejected CLOSE_PROMPTPACK from unauthorized origin:", event.origin);
      return;
    }
    // Verify it's from our iframe
    if (overlayIframe && event.source !== overlayIframe.contentWindow) {
      console.warn("PromptPack: Rejected CLOSE_PROMPTPACK from unknown source");
      return;
    }
    closeOverlay();
  } else if (event.data.type === 'COPY_TO_CLIPBOARD') {
    // Security: Only accept from our extension iframe
    if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) {
      console.warn("PromptPack: Rejected COPY_TO_CLIPBOARD from unauthorized origin:", event.origin);
      return;
    }
    // Verify it's from our iframe
    if (overlayIframe && event.source !== overlayIframe.contentWindow) {
      console.warn("PromptPack: Rejected COPY_TO_CLIPBOARD from unknown source");
      return;
    }
    copyTextToClipboard(event.data.text);
  }
});

// 3. Listen for Messages from Background/App
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.type === "GET_CELLS") {
      // If we have fresh cached cells, return immediately
      if (cachedCells.length > 0) {
        sendResponse({ cells: cachedCells });
        return false;
      }

      // Track if this callback has been resolved
      let resolved = false;
      const wrappedCallback = (response) => {
        if (!resolved) {
          resolved = true;
          sendResponse(response);
        }
      };

      // Queue the callback to be resolved when cells are received
      pendingGetCellsCallbacks.push(wrappedCallback);

      // Request cells from the injected script
      requestCells();

      // Safety timeout: if no response after 5 seconds, return empty array with error
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn("PromptPack: Timeout waiting for cells from injected script");
          // Remove from pending queue
          const idx = pendingGetCellsCallbacks.indexOf(wrappedCallback);
          if (idx > -1) pendingGetCellsCallbacks.splice(idx, 1);
          sendResponse({ cells: [], error: "Timeout waiting for notebook cells" });
        }
      }, 5000);

      // Return true to indicate we'll respond asynchronously
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
    } else if (request.type === "GET_DIFFS") {
      // Track if this callback has been resolved
      let resolved = false;
      const wrappedCallback = (response) => {
        if (!resolved) {
          resolved = true;
          sendResponse(response);
        }
      };

      // Queue the callback
      pendingGetDiffsCallbacks.push(wrappedCallback);

      // Request diffs from the injected script
      requestDiffs();

      // Safety timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const idx = pendingGetDiffsCallbacks.indexOf(wrappedCallback);
          if (idx > -1) pendingGetDiffsCallbacks.splice(idx, 1);
          sendResponse({ diffs: [], error: "Timeout waiting for diffs" });
        }
      }, 5000);

      return true;

    } else if (request.type === "TAKE_SNAPSHOT") {
      let resolved = false;
      const wrappedCallback = (response) => {
        if (!resolved) {
          resolved = true;
          sendResponse(response);
        }
      };

      pendingSnapshotCallbacks.push(wrappedCallback);
      requestSnapshot();

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          const idx = pendingSnapshotCallbacks.indexOf(wrappedCallback);
          if (idx > -1) pendingSnapshotCallbacks.splice(idx, 1);
          sendResponse({ success: false, error: "Timeout taking snapshot" });
        }
      }, 5000);

      return true;

    } else if (request.type === "CLEAR_HISTORY") {
      requestClearHistory(request.cellPath);
      sendResponse({ success: true });
    }

  } catch (error) {
    console.error("PromptPack: Error processing message", error);
    sendResponse({ error: error.message });
  }
  return true;
});

function handleQuickCopy(cells) {
  if (!cells || cells.length === 0) {
    showToast("PromptPack: No cells found to copy.", true);
    return;
  }

  const prompt = generatePromptString(cells);
  copyTextToClipboard(prompt, true);
}

function generatePromptString(cells) {
  console.log("PromptPack: generatePromptString called, quickCopyIncludesOutput =", quickCopyIncludesOutput);
  let output = "### PROJECT STRUCTURE ###\n";
  
  // Simple flat list structure
  cells.forEach(cell => {
    output += `├─ ${cell.relative_path} (${formatSize(cell.size)}, ${cell.line_count || 0} lines)\n`;
  });
  output += "\n\n";

  output += "### FILE CONTENTS ###\n\n";

  cells.forEach(cell => {
    output += `##### File: ${cell.relative_path} (FULL) #####\n`;
    output += "```python\n"; // Assume python for Colab primarily
    output += cell.content + "\n";
    output += "```\n";

    if (quickCopyIncludesOutput && cell.output && cell.output.trim().length > 0) {
        output += "\n# Output:\n";
        output += "```text\n";
        output += cell.output;
        output += "\n```\n";
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
    // Try Async API first (but don't log error yet if it fails)
    await navigator.clipboard.writeText(text);
    console.log("PromptPack: Copied to clipboard (Async)");
    if (showToastMsg) showToast("Notebook Copied to Clipboard!");
  } catch (err) {
    // Fallback: textarea hack (Older but more reliable for background tasks)
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      
      if (successful) {
         console.log("PromptPack: Copied to clipboard (Fallback)");
         if (showToastMsg) showToast("Notebook Copied to Clipboard!");
      } else {
         throw new Error("Fallback copy command returned false");
      }
    } catch (fallbackErr) {
      console.error("PromptPack: All copy methods failed", fallbackErr);
      if (showToastMsg) showToast("Failed to Copy: Focus Document & Try Again", true);
    }
  }
}

function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.innerText = message;
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    backgroundColor: isError ? "#ef4444" : "#0069C3",
    color: "white",
    padding: "12px 24px",
    borderRadius: "8px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    zIndex: "2147483647",
    fontFamily: "sans-serif",
    fontSize: "14px",
    fontWeight: "bold",
    opacity: "0",
    transition: "opacity 0.3s ease, transform 0.3s ease",
    transform: "translateY(10px)"
  });

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  // Animate out
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function toggleOverlay() {
  if (overlayContainer) {
    closeOverlay();
  } else {
    openOverlay();
  }
}

function openOverlay() {
  if (overlayContainer) return;

  overlayContainer = document.createElement('div');
  overlayContainer.id = "promptpack-overlay-container";
  Object.assign(overlayContainer.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    zIndex: '2147483647',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(2px)'
  });

  overlayContainer.onclick = (e) => {
    if (e.target === overlayContainer) closeOverlay();
  };

  // Store iframe reference for security validation
  overlayIframe = document.createElement('iframe');
  overlayIframe.src = chrome.runtime.getURL("index.html");
  Object.assign(overlayIframe.style, {
    width: '90%',
    maxWidth: '1200px',
    height: '85%',
    maxHeight: '900px',
    border: 'none',
    borderRadius: '12px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    backgroundColor: 'white'
  });

  overlayContainer.appendChild(overlayIframe);
  document.body.appendChild(overlayContainer);
}

function closeOverlay() {
  if (overlayContainer) {
    overlayContainer.remove();
    overlayContainer = null;
    overlayIframe = null;
  }
}}
