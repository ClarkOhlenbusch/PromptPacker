import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import App from "./App";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(() => Promise.resolve([])),
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
});
