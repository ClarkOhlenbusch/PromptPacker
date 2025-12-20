// Content script for PromptPack Colab
console.log("PromptPack Colab: Content script loaded");

let overlayContainer = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_CELLS") {
    // ... existing scraping logic ...
    const cells = Array.from(document.querySelectorAll(".codecell-input-output")).map((cell, index) => {
      const editor = cell.querySelector(".monaco-editor");
      const text = editor ? editor.innerText : "Could not extract text";
      
      return {
        path: `cell_${index}`,
        relative_path: `Cell ${index + 1}`,
        is_dir: false,
        size: text.length,
        line_count: text.split('\n').length,
        content: text
      };
    });
    sendResponse({ cells });
  } else if (request.type === "TOGGLE_OVERLAY") {
    toggleOverlay();
  } else if (request.type === "CLOSE_OVERLAY") {
    closeOverlay();
  }
  return true;
});

function toggleOverlay() {
  if (overlayContainer) {
    closeOverlay();
  } else {
    openOverlay();
  }
}

function openOverlay() {
  overlayContainer = document.createElement('div');
  overlayContainer.id = "promptpack-overlay-container";
  Object.assign(overlayContainer.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    zIndex: '2147483647', // Max z-index
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(2px)'
  });

  // Close on click outside
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

// Listen for messages from the iframe (App) to close itself
window.addEventListener('message', (event) => {
  if (event.data.type === 'CLOSE_PROMPTPACK') {
    closeOverlay();
  }
});