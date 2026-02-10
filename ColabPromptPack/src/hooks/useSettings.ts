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
    copyAboveShortcut: ShortcutConfig | null;
    copyBelowShortcut: ShortcutConfig | null;
    recordingShortcutType: 'quickCopy' | 'openApp' | 'copyAbove' | 'copyBelow' | null;
    setRecordingShortcutType: (type: 'quickCopy' | 'openApp' | 'copyAbove' | 'copyBelow' | null) => void;
    quickCopyIncludesOutput: boolean;
    quickCopyIncludesMarkdown: boolean;
    handleKeyDown: (e: React.KeyboardEvent) => void;
    handleToggleQuickCopyOutput: () => void;
    handleToggleQuickCopyMarkdown: () => void;
}

export function useSettings(): UseSettingsReturn {
    const [showSettings, setShowSettings] = useState(false);
    const [quickCopyShortcut, setQuickCopyShortcut] = useState<ShortcutConfig | null>(null);
    const [openAppShortcut, setOpenAppShortcut] = useState<ShortcutConfig | null>(null);
    const [copyAboveShortcut, setCopyAboveShortcut] = useState<ShortcutConfig | null>(null);
    const [copyBelowShortcut, setCopyBelowShortcut] = useState<ShortcutConfig | null>(null);
    const [recordingShortcutType, setRecordingShortcutType] = useState<'quickCopy' | 'openApp' | 'copyAbove' | 'copyBelow' | null>(null);
    const [quickCopyIncludesOutput, setQuickCopyIncludesOutput] = useState(false);
    const [quickCopyIncludesMarkdown, setQuickCopyIncludesMarkdown] = useState(false);

    // Load settings from chrome.storage on mount
    useEffect(() => {
        if (typeof chrome !== "undefined" && chrome.storage) {
            chrome.storage.local.get(
                ["quickCopyShortcut", "openAppShortcut", "copyAboveShortcut", "copyBelowShortcut", "quickCopyIncludesOutput", "quickCopyIncludesMarkdown"],
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

                    if (result.copyAboveShortcut) {
                        setCopyAboveShortcut(result.copyAboveShortcut);
                    } else {
                        setCopyAboveShortcut({ modifiers: ["Alt", "Shift"], key: "A" });
                    }

                    if (result.copyBelowShortcut) {
                        setCopyBelowShortcut(result.copyBelowShortcut);
                    } else {
                        setCopyBelowShortcut({ modifiers: ["Alt", "Shift"], key: "B" });
                    }

                    if (result.quickCopyIncludesOutput !== undefined) {
                        setQuickCopyIncludesOutput(result.quickCopyIncludesOutput);
                    }

                    if (result.quickCopyIncludesMarkdown !== undefined) {
                        setQuickCopyIncludesMarkdown(result.quickCopyIncludesMarkdown);
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

            const storageKey = recordingShortcutType === 'quickCopy' ? 'quickCopyShortcut'
                : recordingShortcutType === 'openApp' ? 'openAppShortcut'
                    : recordingShortcutType === 'copyAbove' ? 'copyAboveShortcut'
                        : 'copyBelowShortcut';

            const setter = recordingShortcutType === 'quickCopy' ? setQuickCopyShortcut
                : recordingShortcutType === 'openApp' ? setOpenAppShortcut
                    : recordingShortcutType === 'copyAbove' ? setCopyAboveShortcut
                        : setCopyBelowShortcut;

            setter(newShortcut);
            if (typeof chrome !== "undefined" && chrome.storage) {
                chrome.storage.local.set({ [storageKey]: newShortcut });
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

    const handleToggleQuickCopyMarkdown = useCallback(() => {
        const newValue = !quickCopyIncludesMarkdown;
        setQuickCopyIncludesMarkdown(newValue);
        if (typeof chrome !== "undefined" && chrome.storage) {
            chrome.storage.local.set({ quickCopyIncludesMarkdown: newValue }, () => {
                console.log("PromptPack UI: Saved quickCopyIncludesMarkdown =", newValue);
            });
        }
    }, [quickCopyIncludesMarkdown]);

    return {
        showSettings,
        setShowSettings,
        quickCopyShortcut,
        openAppShortcut,
        copyAboveShortcut,
        copyBelowShortcut,
        recordingShortcutType,
        setRecordingShortcutType,
        quickCopyIncludesOutput,
        quickCopyIncludesMarkdown,
        handleKeyDown,
        handleToggleQuickCopyOutput,
        handleToggleQuickCopyMarkdown,
    };
}
