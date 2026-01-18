import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import App from "./App";

// Mock the FileSystem service
vi.mock("./services/FileSystem", () => ({
    getFileSystem: vi.fn(() => ({
        openFolder: vi.fn(() => Promise.resolve("test-project")),
        scanProject: vi.fn(() => Promise.resolve([])),
    })),
}));

// Mock prompt generator
vi.mock("./utils/promptGenerator", () => ({
    generatePrompt: vi.fn(() => Promise.resolve("Mocked Prompt")),
}));

describe("ColabPromptPack App", () => {
    it("renders the sidebar header", () => {
        render(<App />);
        expect(screen.getByText("Files")).toBeInTheDocument();
    });

    it("shows scan button initially", () => {
        render(<App />);
        expect(screen.getByText(/Scan/i)).toBeInTheDocument();
    });

    it("renders the action button", () => {
        render(<App />);
        expect(screen.getByText(/GENERATE PROMPT/i)).toBeInTheDocument();
    });
});
