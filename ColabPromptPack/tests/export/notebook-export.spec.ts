import { test as base, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { cpSync, mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { exportNotebook, pixel } from "./fixture";

const test = base.extend<{ exportPage: Page }, { extensionContext: BrowserContext; extensionId: string }>({
  extensionContext: [async ({}, use) => {
    const extensionPath = mkdtempSync(join(tmpdir(), "promptpack-export-test-"));
    cpSync(resolve("dist"), extensionPath, { recursive: true });
    buildSync({ entryPoints: ["tests/export/harness.tsx"], bundle: true, format: "esm", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, outfile: join(extensionPath, "export-test.js") });
    const css = readdirSync(join(extensionPath, "assets")).find(file => file.endsWith(".css"));
    writeFileSync(join(extensionPath, "export-test.html"), `<!doctype html><html><head><link rel="stylesheet" href="assets/${css}"></head><body><div id="root"></div><script type="module" src="export-test.js"></script></body></html>`);
    const context = await chromium.launchPersistentContext("", { channel: "chromium", executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
    await use(context);
    await context.close();
    rmSync(extensionPath, { recursive: true, force: true });
  }, { scope: "worker" }],
  extensionId: [async ({ extensionContext }, use) => {
    const worker = extensionContext.serviceWorkers()[0] || await extensionContext.waitForEvent("serviceworker");
    await use(new URL(worker.url()).host);
  }, { scope: "worker" }],
  exportPage: async ({ extensionContext, extensionId }, use) => {
    const page = await extensionContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/export-test.html`);
    await page.getByRole("button", { name: "Export notebook" }).waitFor();
    await use(page);
    await page.close();
  },
});

async function openPreview(page: Page) {
  await page.getByRole("button", { name: "Export notebook" }).click();
  const preview = page.frameLocator('iframe[title="Notebook preview"]');
  await expect(preview.getByRole("heading", { name: "Assignment" })).toBeVisible();
  return preview;
}

test("MV3 preview preserves tables, CSS-only pipeline controls, SVG styles, math and image dimensions", async ({ exportPage: page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", message => { if (/content security|inline event|script-src/i.test(message.text())) errors.push(message.text()); });
  const preview = await openPreview(page);
  await expect(preview.getByRole("table")).toBeVisible();
  await expect(preview.locator("td").first()).toHaveCSS("color", "rgb(22, 101, 52)");
  await expect(preview.getByRole("button", { name: /Convert/ })).toHaveCount(0);
  await expect(preview.getByText("Please trust this notebook")).toBeHidden();
  await expect(preview.getByText("Pipeline", { exact: true })).toBeVisible();
  await expect(preview.getByText("StandardScaler(with_mean=True)")).toBeHidden();
  const diagramToggle = preview.locator('input[type="checkbox"]');
  await diagramToggle.focus();
  await diagramToggle.press("Space");
  await expect(diagramToggle).toBeChecked();
  await expect(preview.getByText("StandardScaler(with_mean=True)")).toBeVisible();
  await expect(preview.locator("svg .bar")).toHaveCSS("fill", "rgb(26, 115, 232)");
  await expect(preview.locator("math")).toHaveCount(3);
  await expect(preview.locator(".output-image")).toHaveAttribute("width", "80");
  await expect(page.getByText("Preview details")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).violations)).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("preview.png"), fullPage: true });
});

test("notebook download preserves all data; switches filter every format without mutating it", async ({ exportPage: page }) => {
  await openPreview(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Notebook (.ipynb)" }).click();
  const download = await downloadPromise;
  const { readFileSync } = await import("node:fs");
  expect(JSON.parse(readFileSync((await download.path())!, "utf8"))).toEqual(exportNotebook);
  await page.getByRole("switch", { name: "Outputs", exact: true }).click();
  await page.getByRole("switch", { name: "Markdown cells" }).click();
  const preview = page.frameLocator('iframe[title="Notebook preview"]');
  await expect(preview.locator("table, svg, math, img")).toHaveCount(0);
  const filteredDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Notebook (.ipynb)" }).click();
  const filteredDownload = await filteredDownloadPromise;
  const filtered = JSON.parse(readFileSync((await filteredDownload.path())!, "utf8"));
  expect(filtered.cells).toHaveLength(4);
  expect(filtered.cells.every((cell: any) => cell.outputs.length === 0 && cell.execution_count === null)).toBe(true);
  expect(await page.evaluate(() => (window as any).exportNotebook)).toEqual(exportNotebook);
});

test("downloaded HTML keeps output styles separate from the notebook and strips active content", async ({ exportPage: page, extensionContext }, testInfo) => {
  await page.evaluate(() => {
    const notebook = (window as any).exportNotebook;
    notebook.cells.push({ cell_type: "code", source: "unsafe_html()", outputs: [{ data: { "text/html": '<style>*{color:rgb(255,0,0)}body{display:none}</style><img src="data:image/png;base64,invalid" onerror="window.compromised=true"><svg onload="window.compromised=true"></svg><a href="javascript:alert(1)">Unsafe</a><button onclick="window.compromised=true">Run</button><script>window.compromised=true</script>' } }] });
  });
  await openPreview(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  const download = await downloadPromise;
  const output = await extensionContext.newPage();
  const errors: string[] = [];
  output.on("console", message => { if (/inline event|script-src/i.test(message.text())) errors.push(message.text()); });
  const downloadedHtml = testInfo.outputPath("assignment.html");
  await download.saveAs(downloadedHtml);
  await output.goto(`file://${downloadedHtml}`);
  await expect(output.getByRole("table")).toBeVisible();
  await expect(output.locator("td").first()).toHaveCSS("color", "rgb(22, 101, 52)");
  await expect(output.locator("body")).toHaveCSS("color", "rgb(32, 33, 36)");
  await expect(output.getByRole("button", { name: "Run", exact: true })).toHaveCount(0);
  expect(await output.evaluate(() => (window as any).compromised)).toBeUndefined();
  expect(errors).toEqual([]);
  await output.close();
});

test("Markdown download contains a real table, saved images and a readable pipeline representation", async ({ exportPage: page }) => {
  await openPreview(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const download = await downloadPromise;
  const { readFileSync } = await import("node:fs");
  const markdown = readFileSync((await download.path())!, "utf8");
  expect(markdown).toContain("|  | age | income | city | education | spending\\_score |");
  expect(markdown).toContain("| 0 | 25 | 50000 | Boston | Bachelors | 60 |");
  expect(markdown).toContain("![Cell output](data:image/png;base64,");
  expect(markdown).toContain("Pipeline(StandardScaler())");
  expect(markdown).not.toContain("onclick");
});

test("PDF waits for delayed images before printing and renders the styled outputs", async ({ exportPage: page }, testInfo) => {
  const server = createServer((_request, response) => {
    setTimeout(() => { response.writeHead(200, { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" }); response.end(Buffer.from(pixel, "base64")); }, 350);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    const url = `http://127.0.0.1:${address.port}/delayed.png`;
    const delayedPopupPromise = page.waitForEvent("popup");
    await page.evaluate(url => {
      const utils = (window as any).exportUtils;
      (window as any).printResult = utils.printNotebookHtml(utils.notebookToHtml({ nbformat: 4, cells: [{ cell_type: "markdown", source: `![Delayed](${url})` }] }, "Print").html).catch((error: Error) => { (window as any).printError = error.message; });
    }, url);
    const popup = await delayedPopupPromise;
    await popup.evaluate(() => { window.print = () => { (window as any).printedImages = [...document.querySelectorAll("*")].flatMap(element => element.shadowRoot ? [...element.shadowRoot.querySelectorAll("img")].map(img => img.complete && img.naturalWidth > 0) : []); }; });
    await expect.poll(() => popup.evaluate(() => (window as any).printedImages)).toEqual([true]);
    await popup.close();
    await openPreview(page);
    const printPopupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "PDF (print)" }).click();
    const printPopup = await printPopupPromise;
    await expect(printPopup.getByText("Pipeline", { exact: true })).toBeVisible();
    const pdf = await printPopup.pdf({ path: testInfo.outputPath("assignment.pdf"), printBackground: true });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    await testInfo.attach("PDF preview", { path: testInfo.outputPath("assignment.pdf"), contentType: "application/pdf" });
    await printPopup.close();
  } finally { server.closeAllConnections(); server.close(); }
});

test("reachable external images are embedded; an unavailable image keeps its URL and gets a specific detail", async ({ exportPage: page }) => {
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/good.png" ? 200 : 404, { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" });
    response.end(Buffer.from(pixel, "base64"));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const result = await page.evaluate(async base => {
      const utils = (window as any).exportUtils;
      const notebook = { nbformat: 4, cells: [{ cell_type: "markdown", source: `![good](${base}/good.png) ![missing](${base}/missing.png)` }] };
      const images = await utils.prepareNotebookImages(notebook, "Images");
      return { images, ...utils.notebookToHtml(notebook, "Images", images) };
    }, `http://127.0.0.1:${address.port}`);
    expect(Object.values(result.images)).toHaveLength(1);
    expect(Object.values(result.images)[0]).toMatch(/^data:image\/png;base64,/);
    expect(result.imageUrls).toHaveLength(1);
    expect(result.warnings).toEqual(["Cell 1: an image requires an internet connection."]);
  } finally { server.closeAllConnections(); server.close(); }
});

test("PDF reports a failed image instead of printing missing content", async ({ exportPage: page }) => {
  await page.evaluate(() => {
    (window as any).exportNotebook.cells.push({ cell_type: "code", source: "broken_image()", outputs: [{ data: { "image/png": "invalid" } }] });
  });
  await openPreview(page);
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "PDF (print)" }).click();
  const popup = await popupPromise;
  await expect(page.getByRole("alert")).toHaveText("An image could not load for printing. Check the HTML preview and try again.");
  expect(popup.isClosed()).toBe(true);
});
