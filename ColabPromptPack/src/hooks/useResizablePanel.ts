import { useState, useEffect, useCallback } from "react";

export interface UseResizablePanelReturn {
    leftPanelWidth: number;
    isResizing: boolean;
    handleMouseDown: (e: React.MouseEvent) => void;
}

export function useResizablePanel(
    initialWidth = 320,
    minWidth = 200,
    maxWidth = 600
): UseResizablePanelReturn {
    const [leftPanelWidth, setLeftPanelWidth] = useState(initialWidth);
    const [isResizing, setIsResizing] = useState(false);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            const newWidth = Math.min(Math.max(minWidth, e.clientX), maxWidth);
            setLeftPanelWidth(newWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };
    }, [isResizing, minWidth, maxWidth]);

    return { leftPanelWidth, isResizing, handleMouseDown };
}
