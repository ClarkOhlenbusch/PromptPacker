/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],

  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    globals: true,
  },

  build: {
    // Output to dist/ for extension packaging
    outDir: "dist",
    emptyOutDir: true,
    // Don't hash filenames for predictable extension loading
    rollupOptions: {
      input: {
        index: "index.html",
        background: "src/background.ts",
        content: "src/content.ts",
        injected: "src/injected.ts",
      },
      output: {
        // The provided change `chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => { ... })`
        // is not a valid property assignment within the `output` object.
        // It appears to be a piece of runtime code rather than a Rollup output option.
        // To maintain syntactic correctness, this change cannot be applied directly as a replacement for `entryFileNames`.
        // If the intention was to add this code elsewhere, please provide a more specific instruction.
        // For now, the `entryFileNames` property is kept as it is to ensure the file remains valid.
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background" || chunkInfo.name === "content" || chunkInfo.name === "injected") {
            return "[name].js";
          }
          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});
