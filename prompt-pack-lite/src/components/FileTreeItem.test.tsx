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
        isCollapsed: false,
        onToggleCollapse: vi.fn(),
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

    it("renders a very long name without truncation", () => {
        const longName = "a_very_long_source_file_name_that_used_to_truncate_" + "x".repeat(70) + ".c";
        const longEntry = {
            path: "/test/" + longName,
            relative_path: longName,
            is_dir: false,
            size: 100,
        };

        render(<FileTreeItem {...defaultProps} entry={longEntry} />);

        const nameSpan = screen.getByText(longName);
        expect(nameSpan.className).toContain("whitespace-nowrap");
        expect(nameSpan.className).not.toContain("truncate");
    });

    it("renders no collapse chevron on a file row", () => {
        render(<FileTreeItem {...defaultProps} />);
        expect(screen.queryByLabelText(/^(Collapse|Expand) /)).toBeNull();
    });

    it("renders a collapse chevron on a directory row and does not select the directory when it is clicked", () => {
        const dirEntry = {
            path: "/test/src",
            relative_path: "src",
            is_dir: true,
            size: 0,
        };
        const onToggle = vi.fn();
        const onToggleCollapse = vi.fn();

        render(
            <FileTreeItem
                {...defaultProps}
                entry={dirEntry}
                onToggle={onToggle}
                onToggleCollapse={onToggleCollapse}
            />
        );

        fireEvent.click(screen.getByLabelText("Collapse src"));
        expect(onToggleCollapse).toHaveBeenCalledWith(dirEntry);
        expect(onToggle).not.toHaveBeenCalled();
    });

    it("shows the expand chevron when the directory is collapsed", () => {
        const dirEntry = {
            path: "/test/src",
            relative_path: "src",
            is_dir: true,
            size: 0,
        };

        render(<FileTreeItem {...defaultProps} entry={dirEntry} isCollapsed={true} />);

        expect(screen.getByLabelText("Expand src")).toBeInTheDocument();
        expect(screen.queryByLabelText("Collapse src")).toBeNull();
    });
});
