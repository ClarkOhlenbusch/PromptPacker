// Content script for PromptPack Colab
console.log("PromptPack Colab: Content script loaded");

let overlayContainer = null;
let cachedCells = [];
let pendingQuickCopy = false;

// 1. Inject the Page Script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() {
    this.remove(); // Clean up script tag
};
(document.head || document.documentElement).appendChild(script);

// 2. Listen for Data from Page Script
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  
  if (event.data.type === "PROMPTPACK_RESPONSE_CELLS") {
    const cells = event.data.cells;
    cachedCells = cells;

    if (pendingQuickCopy) {
      handleQuickCopy(cells);
      pendingQuickCopy = false;
    }
  } else if (event.data.type === 'CLOSE_PROMPTPACK') {
    closeOverlay();
  } else if (event.data.type === 'COPY_TO_CLIPBOARD') {
    copyTextToClipboard(event.data.text);
  }
});

// 3. Listen for Messages from Background/App
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.type === "GET_CELLS") {
      // Ask page for data
      window.postMessage({ type: "PROMPTPACK_REQUEST_CELLS" }, "*");
      
      // Async wait for response logic is tricky here without Promises.
      // For now, return cached if available, or just acknowledge.
      // The App typically polls or waits, but in our architecture, 
      // the App.tsx scans using FileSystem.ts which calls window.parent.postMessage...
      // wait, the App is inside an IFrame. It communicates with content.js differently?
      // Actually, ColabFileSystem.ts uses window.parent.postMessage to ask content.js?
      // No, ColabFileSystem.ts mocks filesystem.
      
      // If the UI is open, it might trigger a scan itself.
      if (cachedCells.length > 0) {
        sendResponse({ cells: cachedCells });
      } else {
        setTimeout(() => sendResponse({ cells: cachedCells }), 500);
        return true; 
      }

    } else if (request.type === "TOGGLE_OVERLAY") {
      toggleOverlay();
      window.postMessage({ type: "PROMPTPACK_REQUEST_CELLS" }, "*");
      sendResponse({ success: true });

    } else if (request.type === "TRIGGER_QUICK_COPY") {
      pendingQuickCopy = true;
      window.postMessage({ type: "PROMPTPACK_REQUEST_CELLS" }, "*");
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
    output += "```\n\n";
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
    console.log("PromptPack: Copied to clipboard");
    if (showToastMsg) showToast("Notebook Copied to Clipboard!");
  } catch (err) {
    console.error("PromptPack: Failed to copy", err);
    if (showToastMsg) showToast("Failed to Copy", true);
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

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL("index.html");
  Object.assign(iframe.style, {
    width: '90%',
    maxWidth: '1200px',
    height: '85%',
    maxHeight: '900px',
    border: 'none',
    borderRadius: '12px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    backgroundColor: 'white'
  });

  overlayContainer.appendChild(iframe);
  document.body.appendChild(overlayContainer);
}

function closeOverlay() {
  if (overlayContainer) {
    overlayContainer.remove();
    overlayContainer = null;
  }
}