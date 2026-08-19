import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import App from "./App";

// A small fixture tree. 'src-notes.txt' sorts between 'src' and 'src/main.c',
// which is the non-contiguity case the collapse filter must survive.
const FIXTURE_TREE = [
    { path: "/proj/README.md", relative_path: "README.md", is_dir: false, size: 10 },
    { path: "/proj/src", relative_path: "src", is_dir: true, size: 0 },
    { path: "/proj/src-notes.txt", relative_path: "src-notes.txt", is_dir: false, size: 10 },
    { path: "/proj/src/main.c", relative_path: "src/main.c", is_dir: false, size: 20 },
];

// Mock Tauri APIs. The mock is command-aware: 'scan_project' gives the fixture
// tree, every other command answers as it did before, with an empty array.
vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn((command: string) => {
        if (command === "scan_project") {
            return Promise.resolve([
                { path: "/proj/README.md", relative_path: "README.md", is_dir: false, size: 10 },
                { path: "/proj/src", relative_path: "src", is_dir: true, size: 0 },
                { path: "/proj/src-notes.txt", relative_path: "src-notes.txt", is_dir: false, size: 10 },
                { path: "/proj/src/main.c", relative_path: "src/main.c", is_dir: false, size: 20 },
            ]);
        }
        return Promise.resolve([]);
    }),
}));

vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(() => Promise.resolve(() => { })),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
    open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
    writeText: vi.fn(),
}));

describe("App Component", () => {
    it("renders the main application heading", () => {
        render(<App />);
        // Use a more specific matcher to avoid ambiguity
        expect(screen.getByText("FILES")).toBeInTheDocument();
    });

    it("shows 'No project loaded' initially", () => {
        render(<App />);
        expect(screen.getByText(/No project loaded/i)).toBeInTheDocument();
    });

    it("has a 'Generate Prompt' button", () => {
        render(<App />);
        expect(screen.getByText(/GENERATE PROMPT/i)).toBeInTheDocument();
    });
    describe("collapse and expand the FILES tree", () => {
        beforeEach(() => {
            vi.mocked(open).mockResolvedValue("/proj" as never);
        });

        const openTheFixtureProject = async () => {
            render(<App />);
            fireEvent.click(screen.getByText("Open"));
            await waitFor(() => expect(screen.getByText("main.c")).toBeInTheDocument());
        };

        it("hides and restores the tree with the collapse-all and expand-all buttons", async () => {
            await openTheFixtureProject();

            fireEvent.click(screen.getByLabelText("Collapse all directories"));
            await waitFor(() => expect(screen.queryByText("main.c")).toBeNull());
            expect(screen.getByText("src")).toBeInTheDocument();
            // A row that only SORTS inside the collapsed directory stays visible.
            expect(screen.getByText("src-notes.txt")).toBeInTheDocument();
            expect(screen.getByText("README.md")).toBeInTheDocument();

            fireEvent.click(screen.getByLabelText("Expand all directories"));
            await waitFor(() => expect(screen.getByText("main.c")).toBeInTheDocument());
        });

        it("hides and restores one directory with its chevron", async () => {
            await openTheFixtureProject();

            fireEvent.click(screen.getByLabelText("Collapse src"));
            await waitFor(() => expect(screen.queryByText("main.c")).toBeNull());
            expect(screen.getByText("src-notes.txt")).toBeInTheDocument();

            fireEvent.click(screen.getByLabelText("Expand src"));
            await waitFor(() => expect(screen.getByText("main.c")).toBeInTheDocument());
        });

        it("keeps the file count at the full tree size while rows are hidden", async () => {
            await openTheFixtureProject();

            fireEvent.click(screen.getByLabelText("Collapse all directories"));
            await waitFor(() => expect(screen.queryByText("main.c")).toBeNull());
            expect(screen.getByText(String(FIXTURE_TREE.length))).toBeInTheDocument();
        });
    });
});
