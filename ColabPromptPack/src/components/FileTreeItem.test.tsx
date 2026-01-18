import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FileTreeItem } from "./FileTreeItem";

describe("FileTreeItem (Colab)", () => {
    const mockEntry = {
        path: "cell_1",
        relative_path: "Cell 1",
        is_dir: false,
        size: 100,
    };

    const defaultProps = {
        entry: mockEntry,
        depth: 0,
        selectedPaths: new Set<string>(),
        tier1Paths: new Set<string>(),
        includeOutputPaths: new Set<string>(),
        onToggle: vi.fn(),
        onSetFull: vi.fn(),
        onToggleTier1: vi.fn(),
        onToggleOutput: vi.fn(),
    };

    it("renders the filename correctly", () => {
        render(<FileTreeItem {...defaultProps} />);
        expect(screen.getByText("Cell 1")).toBeInTheDocument();
    });

    it("shows SUM badge when selected but not tier1", () => {
        render(
            <FileTreeItem
                {...defaultProps}
                selectedPaths={new Set([mockEntry.path])}
            />
        );
        expect(screen.getByText("SUM")).toBeInTheDocument();
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

    it("calls onToggleOutput when output button is clicked", () => {
        render(
            <FileTreeItem
                {...defaultProps}
                selectedPaths={new Set([mockEntry.path])}
            />
        );
        // The button has a title "Include Cell Output"
        const outputBtn = screen.getByTitle("Include Cell Output");
        fireEvent.click(outputBtn);
        expect(defaultProps.onToggleOutput).toHaveBeenCalledWith(mockEntry);
    });

    it("calls onToggleTier1 when badge is clicked", () => {
        render(
            <FileTreeItem
                {...defaultProps}
                selectedPaths={new Set([mockEntry.path])}
            />
        );
        fireEvent.click(screen.getByText("SUM"));
        expect(defaultProps.onToggleTier1).toHaveBeenCalledWith(mockEntry);
    });
});
