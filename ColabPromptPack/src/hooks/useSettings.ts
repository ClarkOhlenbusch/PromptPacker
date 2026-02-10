import { useState, useEffect, useCallback } from "react";

export interface ShortcutConfig {
    modifiers: string[];
    key: string;
}

export interface UseSettingsReturn {
    showSettings: boolean;
    setShowSettings: (show: boolean) => void;
    quickCopyShortcut: ShortcutConfig | null;
    openAppShortcut: ShortcutConfig | null;
    recordingShortcutType: 'quickCopy' | 'openApp' | null;
    setRecordingShortcutType: (type: 'quickCopy' | 'openApp' | null) => void;
    quickCopyIncludesOutput: boolean;
    handleKeyDown: (e: React.KeyboardEvent) => void;
    handleToggleQuickCopyOutput: () => void;
}

export function useSettings(): UseSettingsReturn {
    const [showSettings, setShowSettings] = useState(false);
    const [quickCopyShortcut, setQuickCopyShortcut] = useState<ShortcutConfig | null>(null);
    const [openAppShortcut, setOpenAppShortcut] = useState<ShortcutConfig | null>(null);
    const [recordingShortcutType, setRecordingShortcutType] = useState<'quickCopy' | 'openApp' | null>(null);
    const [quickCopyIncludesOutput, setQuickCopyIncludesOutput] = useState(false);

    // Load settings from chrome.storage on mount
    useEffect(() => {
        if (typeof chrome !== "undefined" && chrome.storage) {
            chrome.storage.local.get(
                ["quickCopyShortcut", "openAppShortcut", "quickCopyIncludesOutput"],
                (result) => {
                    if (result.quickCopyShortcut) {
                        setQuickCopyShortcut(result.quickCopyShortcut);
                    } else {
                        setQuickCopyShortcut({ modifiers: ["Alt", "Shift"], key: "C" });
                    }

                    if (result.openAppShortcut) {
                        setOpenAppShortcut(result.openAppShortcut);
                    } else {
                        setOpenAppShortcut({ modifiers: ["Alt", "Shift"], key: "P" });
                    }

                    if (result.quickCopyIncludesOutput !== undefined) {
                        setQuickCopyIncludesOutput(result.quickCopyIncludesOutput);
                    }
                }
            );
        }
    }, []);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (!recordingShortcutType) return;
            e.preventDefault();
            e.stopPropagation();

            const modifiers: string[] = [];
            if (e.ctrlKey) modifiers.push("Ctrl");
            if (e.altKey) modifiers.push("Alt");
            if (e.shiftKey) modifiers.push("Shift");
            if (e.metaKey) modifiers.push("Meta");

            // Ignore modifier-only presses
            if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;

            const newShortcut: ShortcutConfig = {
                modifiers,
                key: e.key.toUpperCase(),
            };

            if (recordingShortcutType === 'quickCopy') {
                setQuickCopyShortcut(newShortcut);
                if (typeof chrome !== "undefined" && chrome.storage) {
                    chrome.storage.local.set({ quickCopyShortcut: newShortcut });
                }
            } else if (recordingShortcutType === 'openApp') {
                setOpenAppShortcut(newShortcut);
                if (typeof chrome !== "undefined" && chrome.storage) {
                    chrome.storage.local.set({ openAppShortcut: newShortcut });
                }
            }

            setRecordingShortcutType(null);
        },
        [recordingShortcutType]
    );

    const handleToggleQuickCopyOutput = useCallback(() => {
        const newValue = !quickCopyIncludesOutput;
        setQuickCopyIncludesOutput(newValue);
        if (typeof chrome !== "undefined" && chrome.storage) {
            chrome.storage.local.set({ quickCopyIncludesOutput: newValue }, () => {
                console.log("PromptPack UI: Saved quickCopyIncludesOutput =", newValue);
            });
        }
    }, [quickCopyIncludesOutput]);

    return {
        showSettings,
        setShowSettings,
        quickCopyShortcut,
        openAppShortcut,
        recordingShortcutType,
        setRecordingShortcutType,
        quickCopyIncludesOutput,
        handleKeyDown,
        handleToggleQuickCopyOutput,
    };
}
