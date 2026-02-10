import { useState, useEffect, useCallback } from "react";

export interface ShortcutConfig {
    modifiers: string[];
    key: string;
}

export interface UseSettingsReturn {
    showSettings: boolean;
    setShowSettings: (show: boolean) => void;
    currentShortcut: ShortcutConfig | null;
    isRecording: boolean;
    setIsRecording: (recording: boolean) => void;
    quickCopyIncludesOutput: boolean;
    handleKeyDown: (e: React.KeyboardEvent) => void;
    handleToggleQuickCopyOutput: () => void;
}

export function useSettings(): UseSettingsReturn {
    const [showSettings, setShowSettings] = useState(false);
    const [currentShortcut, setCurrentShortcut] = useState<ShortcutConfig | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [quickCopyIncludesOutput, setQuickCopyIncludesOutput] = useState(false);

    // Load settings from chrome.storage on mount
    useEffect(() => {
        if (typeof chrome !== "undefined" && chrome.storage) {
            chrome.storage.local.get(
                ["quickCopyShortcut", "quickCopyIncludesOutput"],
                (result) => {
                    if (result.quickCopyShortcut) {
                        setCurrentShortcut(result.quickCopyShortcut);
                    } else {
                        setCurrentShortcut({ modifiers: ["Alt", "Shift"], key: "C" });
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
            if (!isRecording) return;
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
            setCurrentShortcut(newShortcut);
            setIsRecording(false);

            // Persist to chrome.storage
            if (typeof chrome !== "undefined" && chrome.storage) {
                chrome.storage.local.set({ quickCopyShortcut: newShortcut });
            }
        },
        [isRecording]
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
        currentShortcut,
        isRecording,
        setIsRecording,
        quickCopyIncludesOutput,
        handleKeyDown,
        handleToggleQuickCopyOutput,
    };
}
