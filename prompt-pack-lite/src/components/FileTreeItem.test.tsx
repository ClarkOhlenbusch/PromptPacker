import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FileTreeItem } from "./FileTreeItem";

describe("FileTreeItem (Lite)", () => {
    const mockEntry = {
        path: "/test/file.py",
        relative_path: "file.py",
        is_dir: false,
        size: 100,
    };

    const defaultProps = {
        entry: mockEntry,
        depth: 0,
        selectedPaths: new Set<string>(),
        tier1Paths: new Set<string>(),
        onToggle: vi.fn(),
        onSetFull: vi.fn(),
        onToggleTier1: vi.fn(),
    };

    it("renders the filename correctly", () => {
        render(<FileTreeItem {...defaultProps} />);
        expect(screen.getByText("file.py")).toBeInTheDocument();
    });

    it("calls onToggle when clicked", () => {
        render(<FileTreeItem {...defaultProps} />);
        fireEvent.click(screen.getByText("file.py"));
        expect(defaultProps.onToggle).toHaveBeenCalledWith(mockEntry);
    });

    it("calls onSetFull when double clicked", () => {
        render(<FileTreeItem {...defaultProps} />);
        fireEvent.doubleClick(screen.getByText("file.py"));
        expect(defaultProps.onSetFull).toHaveBeenCalledWith(mockEntry);
    });

    it("shows SKEL badge when selected but not tier1", () => {
        render(
            <FileTreeItem
                {...defaultProps}
                selectedPaths={new Set([mockEntry.path])}
            />
        );
        expect(screen.getByText("SKEL")).toBeInTheDocument();
    });

    it("shows FULL badge when selected and tier1", () => {
        render(
            <FileTreeItem
                {...defaultProps}
                selectedPaths={new Set([mockEntry.path])}
                tier1Paths={new Set([mockEntry.path])}
            />
        );
        expect(screen.getByText("FULL")).toBeInTheDocument();
    });

    it("calls onToggleTier1 when badge is clicked", () => {
        render(
            <FileTreeItem
                {...defaultProps}
                selectedPaths={new Set([mockEntry.path])}
            />
        );
        fireEvent.click(screen.getByText("SKEL"));
        expect(defaultProps.onToggleTier1).toHaveBeenCalledWith(mockEntry);
    });
});
