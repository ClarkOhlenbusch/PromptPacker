import { describe, it, expect, vi } from "vitest";
import { generateAutoPreamble } from "./autoPreamble";
import { FileEntry } from "../services/FileSystem";

// Mock the FileSystem service
vi.mock("../services/FileSystem", () => ({
    getFileSystem: vi.fn(() => ({
        readFileContent: vi.fn(() => Promise.resolve("")),
    })),
}));

describe("generateAutoPreamble", () => {
    // ─── Markdown Extraction ────────────────────────────────────

    it("should extract notebook title from first markdown heading", async () => {
        const files: FileEntry[] = [
            {
                path: "cell_0", relative_path: "Cell 1", is_dir: false, size: 50,
                content: "# Fine-tuning BERT for Sentiment Analysis\n\nThis notebook demonstrates...",
                cellType: "markdown"
            },
            {
                path: "cell_1", relative_path: "Cell 2", is_dir: false, size: 20,
                content: "import torch",
                cellType: "code"
            }
        ];

        const preamble = await generateAutoPreamble(files);
        expect(preamble).toContain("Notebook: Fine-tuning BERT for Sentiment Analysis");
    });

    it("should build an outline from markdown section headings", async () => {
        const files: FileEntry[] = [
            {
                path: "cell_0", relative_path: "Cell 1", is_dir: false, size: 20,
                content: "# My Notebook",
                cellType: "markdown"
            },
            {
                path: "cell_1", relative_path: "Cell 2", is_dir: false, size: 30,
                content: "## Setup & Installation",
                cellType: "markdown"
            },
            {
                path: "cell_2", relative_path: "Cell 3", is_dir: false, size: 10,
                content: "!pip install transformers",
                cellType: "code"
            },
            {
                path: "cell_3", relative_path: "Cell 4", is_dir: false, size: 30,
                content: "## Load Dataset",
                cellType: "markdown"
            },
            {
                path: "cell_4", relative_path: "Cell 5", is_dir: false, size: 30,
                content: "## Training",
                cellType: "markdown"
            },
        ];

        const preamble = await generateAutoPreamble(files);
        expect(preamble).toContain("Outline:");
        expect(preamble).toContain("Setup & Installation");
        expect(preamble).toContain("Load Dataset");
        expect(preamble).toContain("Training");
    });

    // ─── Code Cell Extraction ───────────────────────────────────

    it("should extract third-party libraries (filtering builtins)", async () => {
        const files: FileEntry[] = [
            {
                path: "cell_0", relative_path: "Cell 1", is_dir: false, size: 100,
                content: "import pandas as pd\nimport numpy\nfrom torch import nn\nimport os\nimport sys",
                cellType: "code"
            }
        ];

        const preamble = await generateAutoPreamble(files);
        expect(preamble).toContain("Libraries:");
        expect(preamble).toContain("pandas");
        expect(preamble).toContain("numpy");
        expect(preamble).toContain("torch");
        // Builtins should be filtered
        expect(preamble).not.toContain("os");
        expect(preamble).not.toContain("sys");
    });

    it("should detect key definitions", async () => {
        const files: FileEntry[] = [
            {
                path: "cell_0", relative_path: "Cell 1", is_dir: false, size: 100,
                content: "class MyModel(nn.Module):\n    pass\n\ndef train_step(batch):\n    pass",
                cellType: "code"
            }
        ];

        const preamble = await generateAutoPreamble(files);
        expect(preamble).toContain("class MyModel");
        expect(preamble).toContain("def train_step");
    });

    it("should detect data sources", async () => {
        const files: FileEntry[] = [
            {
                path: "cell_0", relative_path: "Cell 1", is_dir: false, size: 100,
                content: "df = pd.read_csv('data.csv')\ndataset = load_dataset('mnist')",
                cellType: "code"
            }
        ];

        const preamble = await generateAutoPreamble(files);
        expect(preamble).toContain("CSV File");
        expect(preamble).toContain("HuggingFace Dataset");
    });

    it("should detect GPU environment", async () => {
        const files: FileEntry[] = [
            {
                path: "cell_0", relative_path: "Cell 1", is_dir: false, size: 20,
                content: "model.to('cuda')",
                cellType: "code"
            }
        ];

        const preamble = await generateAutoPreamble(files);
        expect(preamble).toContain("GPU/CUDA detected");
    });

    it("should calculate cell stats", async () => {
        const files: FileEntry[] = [
            { path: "c1", relative_path: "c1", is_dir: false, content: "", cellType: "code", size: 0 },
            { path: "m1", relative_path: "m1", is_dir: false, content: "", cellType: "markdown", size: 0 },
            { path: "c2", relative_path: "c2", is_dir: false, content: "", cellType: "code", size: 0 },
        ];

        const preamble = await generateAutoPreamble(files);
        expect(preamble).toContain("3 cells");
        expect(preamble).toContain("2 code");
        expect(preamble).toContain("1 markdown");
    });

    // ─── Full notebook simulation ───────────────────────────────

    it("should produce comprehensive preamble from a realistic notebook", async () => {
        const files: FileEntry[] = [
            {
                path: "c0", relative_path: "Cell 1", is_dir: false, size: 60,
                content: "# Fine-tuning DistilBERT\n\nUsing HuggingFace Transformers", cellType: "markdown"
            },
            {
                path: "c1", relative_path: "Cell 2", is_dir: false, size: 30,
                content: "## Environment Setup", cellType: "markdown"
            },
            {
                path: "c2", relative_path: "Cell 3", is_dir: false, size: 80,
                content: "!pip install transformers datasets\nimport torch\nimport transformers\nfrom datasets import load_dataset", cellType: "code"
            },
            {
                path: "c3", relative_path: "Cell 4", is_dir: false, size: 20,
                content: "## Data Preparation", cellType: "markdown"
            },
            {
                path: "c4", relative_path: "Cell 5", is_dir: false, size: 50,
                content: "dataset = load_dataset('imdb')\ndf = dataset['train'].to_pandas()", cellType: "code"
            },
            {
                path: "c5", relative_path: "Cell 6", is_dir: false, size: 20,
                content: "## Training", cellType: "markdown"
            },
            {
                path: "c6", relative_path: "Cell 7", is_dir: false, size: 60,
                content: "model = model.to('cuda')\ndef train_loop(model, dataloader):\n    pass", cellType: "code"
            },
        ];

        const preamble = await generateAutoPreamble(files);
        // Title
        expect(preamble).toContain("Notebook: Fine-tuning DistilBERT");
        // Outline
        expect(preamble).toContain("Environment Setup");
        expect(preamble).toContain("Data Preparation");
        expect(preamble).toContain("Training");
        // Libraries (no builtins)
        expect(preamble).toContain("torch");
        expect(preamble).toContain("transformers");
        expect(preamble).toContain("datasets");
        // Definitions
        expect(preamble).toContain("def train_loop");
        // Data sources
        expect(preamble).toContain("HuggingFace Dataset");
        // Hardware
        expect(preamble).toContain("GPU/CUDA detected");
    });
});
