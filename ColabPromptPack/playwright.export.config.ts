import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/export",
  testMatch: "**/*.spec.ts",
  workers: 1,
  outputDir: "export-test-results",
  reporter: "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
