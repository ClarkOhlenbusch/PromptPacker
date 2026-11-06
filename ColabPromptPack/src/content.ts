// Content script for PromptPack Colab

interface Shortcut {
    modifiers: string[];
    key: string;
}

interface Cell {
    path: string;
    relative_path: string;
    content: string;
    output: string;
    size: number;
    line_count: number;
    cellType?: 'code' | 'markdown';
    cellId?: string;
}

export { };

declare global {
    interface Window {
        hasRunPromptPack?: boolean;
    }
}

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

    let overlayContainer: HTMLDivElement | null = null;
    let overlayIframe: HTMLIFrameElement | null = null;
    let overlayVisible = false;
    let panelMode: "prompt" | "agent" = "prompt";
    let reopenButton: HTMLButtonElement | null = null;
    let cachedCells: Cell[] = [];
    let pendingQuickCopy = false;
    let pendingCopyAbove = false;
    let pendingCopyBelow = false;
    let injectedScriptReady = false;
    let pendingCellRequests: boolean[] = [];
    let pendingInjectedMessages: any[] = [];
    let pendingGetCellsCallbacks: ((response: { cells: Cell[] }) => void)[] = [];
    let snapshotCells: Partial<Cell>[] | null = null; // Persisted snapshot data (survives iframe destroy/recreate)
    let snapshotTimestamp: number | null = null;

    function postToInjected(message: any) {
        if (injectedScriptReady) {
            window.postMessage(message, COLAB_ORIGIN);
            return;
        }
        pendingInjectedMessages.push(message);
    }

    function requestCells() {
        if (!injectedScriptReady) {
            pendingCellRequests.push(true);
        }
        postToInjected({ type: "PROMPTPACK_REQUEST_CELLS" });
    }

    function requestCellsWithActive() {
        if (!injectedScriptReady) {
            pendingCellRequests.push(true);
        }
        postToInjected({ type: "PROMPTPACK_REQUEST_CELLS_WITH_ACTIVE" });
    }

    function pingInjectedScript() {
        try {
            window.postMessage({ type: "PROMPTPACK_PING" }, COLAB_ORIGIN);
        } catch (e) {
            console.warn("PromptPack: Failed to ping injected script", e);
        }
    }

    const INJECTED_SCRIPT_ID = "promptpack-injected-script";
    function injectPageScript(forceReplace = false) {
        let script = document.getElementById(INJECTED_SCRIPT_ID) as HTMLScriptElement | null;

        if (forceReplace && script) {
            script.remove();
            script = null;
        }

        if (!script) {
            const nextScript = document.createElement('script');
            nextScript.id = INJECTED_SCRIPT_ID;
            nextScript.src = chrome.runtime.getURL('injected.js') + `?v=${Date.now()}`;
            nextScript.onload = () => {
                setTimeout(() => pingInjectedScript(), 0);
            };
            (document.head || document.documentElement).appendChild(nextScript);
            return;
        }

        // Script already present (e.g. extension hot-reload); request ready handshake.
        pingInjectedScript();
    }

    injectPageScript(false);
    setTimeout(() => {
        if (!injectedScriptReady) {
            // One forced reinjection if prior injected script instance is stale/broken.
            injectPageScript(true);
        }
    }, 1200);

    // Hotkey State
    let quickCopyShortcut: Shortcut = { modifiers: ["Alt", "Shift"], key: "C" };
    let openAppShortcut: Shortcut = { modifiers: ["Alt", "Shift"], key: "P" };
    let copyAboveShortcut: Shortcut = { modifiers: ["Alt", "Shift"], key: "A" };
    let copyBelowShortcut: Shortcut = { modifiers: ["Alt", "Shift"], key: "B" };
    let quickCopyIncludesOutput = false;
    let quickCopyIncludesMarkdown = false;

    chrome.storage.local.get(['quickCopyShortcut', 'openAppShortcut', 'copyAboveShortcut', 'copyBelowShortcut', 'quickCopyIncludesOutput', 'quickCopyIncludesMarkdown'], (result) => {
        if (result.quickCopyShortcut) quickCopyShortcut = result.quickCopyShortcut;
        if (result.openAppShortcut) openAppShortcut = result.openAppShortcut;
        if (result.copyAboveShortcut) copyAboveShortcut = result.copyAboveShortcut;
        if (result.copyBelowShortcut) copyBelowShortcut = result.copyBelowShortcut;
        if (result.quickCopyIncludesOutput !== undefined) quickCopyIncludesOutput = result.quickCopyIncludesOutput;
        if (result.quickCopyIncludesMarkdown !== undefined) quickCopyIncludesMarkdown = result.quickCopyIncludesMarkdown;
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.quickCopyShortcut) quickCopyShortcut = changes.quickCopyShortcut.newValue;
        if (changes.openAppShortcut) openAppShortcut = changes.openAppShortcut.newValue;
        if (changes.copyAboveShortcut) copyAboveShortcut = changes.copyAboveShortcut.newValue;
        if (changes.copyBelowShortcut) copyBelowShortcut = changes.copyBelowShortcut.newValue;
        if (changes.quickCopyIncludesOutput) quickCopyIncludesOutput = changes.quickCopyIncludesOutput.newValue;
        if (changes.quickCopyIncludesMarkdown) quickCopyIncludesMarkdown = changes.quickCopyIncludesMarkdown.newValue;
    });

    // Use capture phase on document so our handler fires before Colab's own
    // keyboard handlers can stopPropagation and swallow the event.
    document.addEventListener("keydown", (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        const tag = target.tagName.toLowerCase();
        // Allow shortcuts through for Monaco editor textareas (code cells)
        // Monaco uses hidden textareas for input — our modifier shortcuts won't conflict with typing
        const isMonacoEditor = target.closest('.monaco-editor') !== null;
        if ((tag === 'input' || tag === 'textarea' || target.isContentEditable) && !isMonacoEditor) return;

        // Helper to check if a shortcut matches the event
        const matchesShortcut = (shortcut: Shortcut, event: KeyboardEvent) => {
            if (!shortcut) return false;
            const pressedKey = event.key.toUpperCase();
            const requiredKey = shortcut.key.toUpperCase();
            const alt = shortcut.modifiers.includes("Alt");
            const shift = shortcut.modifiers.includes("Shift");
            const modMeta = shortcut.modifiers.includes("Meta") || shortcut.modifiers.includes("Command");
            const modCtrl = shortcut.modifiers.includes("Control") || shortcut.modifiers.includes("Ctrl");

            return modMeta === event.metaKey &&
                modCtrl === event.ctrlKey &&
                alt === event.altKey &&
                shift === event.shiftKey &&
                pressedKey === requiredKey;
        };

        if (matchesShortcut(quickCopyShortcut, e)) {
            e.preventDefault();
            e.stopPropagation();
            pendingQuickCopy = true;
            requestCells();
        } else if (matchesShortcut(copyAboveShortcut, e)) {
            e.preventDefault();
            e.stopPropagation();
            pendingCopyAbove = true;
            requestCellsWithActive();
        } else if (matchesShortcut(copyBelowShortcut, e)) {
            e.preventDefault();
            e.stopPropagation();
            pendingCopyBelow = true;
            requestCellsWithActive();
        } else if (matchesShortcut(openAppShortcut, e)) {
            e.preventDefault();
            e.stopPropagation();
            toggleOverlay();
        } else if (e.key === "Escape" && overlayIframe) {
            // Forward ESC to iframe if it's open
            overlayIframe.contentWindow?.postMessage({ type: "EXTERNAL_ESCAPE" }, "*");
        }
    }, true); // capture phase

    window.addEventListener("message", (event) => {
        if (event.data.type === "PROMPTPACK_INJECTED_READY") {
            if (event.source !== window || event.origin !== COLAB_ORIGIN) return;
            injectedScriptReady = true;
            if (pendingInjectedMessages.length > 0) {
                const queued = [...pendingInjectedMessages];
                pendingInjectedMessages = [];
                pendingCellRequests = [];
                queued.forEach((message) => {
                    try {
                        window.postMessage(message, COLAB_ORIGIN);
                    } catch (e) {
                        console.warn("PromptPack content: failed forwarding queued message", e);
                    }
                });
            } else if (pendingCellRequests.length > 0) {
                pendingCellRequests = [];
                window.postMessage({ type: "PROMPTPACK_REQUEST_CELLS" }, COLAB_ORIGIN);
            }
        } else if (event.data.type === "PROMPTPACK_RESPONSE_CELLS") {
            if (event.source !== window || event.origin !== COLAB_ORIGIN) return;
            cachedCells = event.data.cells || [];
            while (pendingGetCellsCallbacks.length > 0) {
                const callback = pendingGetCellsCallbacks.shift();
                try { callback?.({ cells: cachedCells }); } catch (e) { }
            }
            if (pendingQuickCopy) {
                handleQuickCopy(cachedCells);
                pendingQuickCopy = false;
            }
        } else if (event.data.type === "PROMPTPACK_RESPONSE_CELLS_WITH_ACTIVE") {
            if (event.source !== window || event.origin !== COLAB_ORIGIN) return;
            const cells: Cell[] = event.data.cells || [];
            const activeCellIndex: number | null = event.data.activeCellIndex;

            if (activeCellIndex === null) {
                showToast("No focused cell detected. Click into a cell first.", true);
                pendingCopyAbove = false;
                pendingCopyBelow = false;
                return;
            }

            if (pendingCopyAbove) {
                const aboveCells = cells.slice(0, activeCellIndex + 1); // include active cell
                if (aboveCells.length === 0) {
                    showToast("No cells above cursor.", true);
                } else {
                    copyTextToClipboard(generatePromptString(aboveCells), false);
                    showToast(`Copied ${aboveCells.length} cell${aboveCells.length > 1 ? 's' : ''} (above + current)`);
                }
                pendingCopyAbove = false;
            }

            if (pendingCopyBelow) {
                const belowCells = cells.slice(activeCellIndex); // include active cell
                if (belowCells.length === 0) {
                    showToast("No cells below cursor.", true);
                } else {
                    copyTextToClipboard(generatePromptString(belowCells), false);
                    showToast(`Copied ${belowCells.length} cell${belowCells.length > 1 ? 's' : ''} (current + below)`);
                }
                pendingCopyBelow = false;
            }
        } else if (event.data.type === "PROMPTPACK_APPLY_RESULT") {
            if (event.source !== window || event.origin !== COLAB_ORIGIN) return;
            if (overlayIframe && overlayIframe.contentWindow) {
                overlayIframe.contentWindow.postMessage({
                    type: "PROMPTPACK_APPLY_RESULT",
                    requestId: event.data.requestId,
                    payload: event.data.payload
                }, "*");
            }
        } else if (event.data.type === "PROMPTPACK_EXECUTION_RESULT") {
            if (event.source !== window || event.origin !== COLAB_ORIGIN) return;
            if (overlayIframe && overlayIframe.contentWindow) {
                overlayIframe.contentWindow.postMessage({
                    type: "PROMPTPACK_EXECUTION_RESULT",
                    requestId: event.data.requestId,
                    payload: event.data.payload
                }, "*");
            }
        } else if (event.data.type === "PROMPTPACK_NOTEBOOK_METADATA_RESULT") {
            if (event.source !== window || event.origin !== COLAB_ORIGIN) return;
            if (overlayIframe && overlayIframe.contentWindow) {
                overlayIframe.contentWindow.postMessage({
                    type: "PROMPTPACK_NOTEBOOK_METADATA_RESULT",
                    requestId: event.data.requestId,
                    payload: event.data.payload
                }, "*");
            }
        } else if (event.data.type === 'PROMPTPACK_PANEL_MODE') {
            if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
            if (!overlayIframe || event.source !== overlayIframe.contentWindow) return;
            panelMode = event.data.mode === "agent" ? "agent" : "prompt";
            updateOverlayLayout();
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

            const onCells = (response: { cells: Cell[] }) => {
                const cells = response.cells || [];
                snapshotCells = cells.map(c => ({
                    path: c.path,
                    relative_path: c.relative_path,
                    content: c.content || "",
                    output: c.output || ""
                }));
                snapshotTimestamp = Date.now();
                console.log("PromptPack content: Snapshot taken,", snapshotCells.length, "cells stored at", snapshotTimestamp);
                if (overlayIframe && overlayIframe.contentWindow) {
                    overlayIframe.contentWindow.postMessage({
                        type: "PROMPTPACK_SNAPSHOT_RESPONSE",
                        requestId: requestId,
                        payload: { success: true, cellCount: snapshotCells.length }
                    }, "*");
                }
            };

            let resolved = false;
            const wrappedCallback = (response: { cells: Cell[] }) => { if (!resolved) { resolved = true; onCells(response); } };
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
                    payload: {
                        cells: snapshotCells || [],
                        timestamp: snapshotTimestamp
                    }
                }, "*");
            }
        } else if (event.data.type === 'PROMPTPACK_CLEAR_SNAPSHOT') {
            // Clear the persisted snapshot
            if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
            snapshotCells = null;
            snapshotTimestamp = null;
            console.log("PromptPack content: Snapshot cleared");
        } else if (event.data.type === 'SHOW_TOAST') {
            // Show a toast notification
            if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
            showToast(event.data.text || "Action successful", event.data.isError || false);
        } else if (event.data.type === 'PROMPTPACK_GET_CELLS') {
            // Handle cell requests from the extension iframe
            if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;

            const requestId = event.data.requestId;

            const sendCellsToIframe = (cells: Cell[]) => {
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
            const wrappedCallback = (response: { cells: Cell[] }) => {
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
        } else if (event.data.type === "PROMPTPACK_APPLY_CELL_UPDATES") {
            if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
            postToInjected({
                type: "PROMPTPACK_APPLY_CELL_UPDATES",
                requestId: event.data.requestId,
                payload: event.data.payload,
            });
        } else if (event.data.type === "PROMPTPACK_EXECUTE_CELLS") {
            if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
            postToInjected({
                type: "PROMPTPACK_EXECUTE_CELLS",
                requestId: event.data.requestId,
                payload: event.data.payload,
            });
        } else if (event.data.type === "PROMPTPACK_GET_NOTEBOOK_METADATA") {
            if (!event.origin.startsWith(EXTENSION_ORIGIN_PREFIX)) return;
            postToInjected({
                type: "PROMPTPACK_GET_NOTEBOOK_METADATA",
                requestId: event.data.requestId,
            });
        }
    });

    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        try {
            if (request.type === "GET_CELLS") {
                if (cachedCells.length > 0) {
                    sendResponse({ cells: cachedCells });
                    return false;
                }
                let resolved = false;
                const wrappedCallback = (response: { cells: Cell[] }) => { if (!resolved) { resolved = true; sendResponse(response); } };
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
        } catch (error: any) {
            sendResponse({ error: error.message });
        }
        return true;
    });

    function handleQuickCopy(cells: Cell[]) {
        if (!cells || cells.length === 0) {
            showToast("PromptPack: No cells found to copy.", true);
            return;
        }
        copyTextToClipboard(generatePromptString(cells), true);
    }

    function generatePromptString(cells: Cell[]) {
        // Filter out markdown cells if not included
        const filteredCells = cells.filter(cell => {
            if (cell.cellType === 'markdown' && !quickCopyIncludesMarkdown) return false;
            return true;
        });

        let output = "### PROJECT STRUCTURE ###\n";
        filteredCells.forEach(cell => {
            const typeLabel = cell.cellType === 'markdown' ? ' [Markdown]' : '';
            output += `├─ ${cell.relative_path}${typeLabel} (${formatSize(cell.size)}, ${cell.line_count || 0} lines)\n`;
        });
        output += "\n\n### FILE CONTENTS ###\n\n";
        filteredCells.forEach(cell => {
            const lang = cell.cellType === 'markdown' ? 'markdown' : 'python';
            output += `##### File: ${cell.relative_path} (FULL) #####\n\`\`\`${lang}\n${cell.content}\n\`\`\`\n`;
            if (quickCopyIncludesOutput && cell.output && cell.output.trim().length > 0) {
                output += `\n# Output:\n\`\`\`text\n${cell.output}\n\`\`\`\n`;
            }
            output += "\n";
        });
        return output;
    }

    function formatSize(bytes: number) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    async function copyTextToClipboard(text: string, showToastMsg = false) {
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

    function showToast(message: string, isError = false) {
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
        if (overlayVisible) closeOverlay();
        else openOverlay();
    }

    function openOverlay() {
        overlayVisible = true;
        if (reopenButton) reopenButton.hidden = true;
        if (overlayContainer) {
            updateOverlayLayout();
            return;
        }
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
        updateOverlayLayout();
    }

    function updateOverlayLayout() {
        if (!overlayContainer || !overlayIframe) return;
        const docked = panelMode === "agent";
        Object.assign(overlayContainer.style, {
            display: overlayVisible ? "flex" : "none",
            left: docked ? "auto" : "0",
            right: "0",
            width: docked ? "620px" : "100vw",
            maxWidth: docked ? "100vw" : "none",
            backgroundColor: docked ? "transparent" : "rgba(0, 0, 0, 0.5)",
            backdropFilter: docked ? "none" : "blur(2px)",
        });
        Object.assign(overlayIframe.style, {
            width: docked ? "100%" : "90%",
            maxWidth: docked ? "none" : "1200px",
            height: docked ? "100%" : "85%",
            maxHeight: docked ? "none" : "900px",
            borderRadius: docked ? "0" : "12px",
        });
    }

    function closeOverlay() {
        // Keep the iframe and its socket alive while the user works in Colab.
        overlayVisible = false;
        updateOverlayLayout();
        if (!reopenButton) {
            reopenButton = document.createElement("button");
            reopenButton.id = "promptpack-reopen";
            reopenButton.textContent = "Open PromptPack";
            reopenButton.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#0069c3;color:white;border:0;border-radius:24px;padding:12px 20px;font:600 14px sans-serif;cursor:pointer;box-shadow:0 4px 16px #0003";
            reopenButton.onclick = openOverlay;
            document.body.appendChild(reopenButton);
        }
        reopenButton.hidden = false;
    }
}
