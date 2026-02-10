import { test, expect } from '@playwright/test';

test.describe('Basic Extension Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Enable console logging
        page.on('console', msg => console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.log(`[BROWSER_ERROR]: ${err.message}`));

        // Navigate to the mock harness
        console.log('Navigating to harness...');
        await page.goto('/tests/mock-colab/harness.html');
        console.log('Navigation complete.');

        // Wait for the iframe to load
        console.log('Waiting for iframe...');
        const frameElement = page.locator('#extension-frame');
        await expect(frameElement).toBeVisible();
        console.log('Iframe visible.');

        // Check if iframe has content
        const frame = page.frameLocator('#extension-frame');
        // Wait for some content inside the frame to ensure it loaded
        // App.tsx renders "Files" header.
        // Wait for some content inside the frame to ensure it loaded
        // App.tsx renders "Files" header.
        await expect(frame.getByText('Files', { exact: true })).toBeVisible({ timeout: 5000 });
        console.log('Iframe content loaded (Files header visible).');
    });

    test('should scan and list files', async ({ page }) => {
        const frame = page.frameLocator('#extension-frame');

        // LOCATE and CLICK Scan button
        const scanButton = frame.getByRole('button', { name: /Refresh|Scan/i });
        await expect(scanButton).toBeVisible();
        await scanButton.click();

        // VERIFY files are listed
        await expect(frame.locator('.truncate').getByText('Intro.py')).toBeVisible();
        await expect(frame.locator('.truncate').getByText('Data.py')).toBeVisible();

        // VERIFY cell count in summary
        await expect(frame.locator('.bg-blue-50.font-mono').getByText(/3/)).toBeVisible();
    });

    test('should select file and generate prompt', async ({ page }) => {
        const frame = page.frameLocator('#extension-frame');

        // SCAN
        await frame.getByRole('button', { name: /Refresh|Scan/i }).click();

        // SELECT a file (e.g., Intro.py)
        // By default, they might be selected or not. The mock has logic to auto-select?
        // Let's assume default state or click to select.
        // In `useFileSelection.ts`, `scanProject` auto-selects all files.
        // So "Intro.py" should already be selected.

        // CLICK Generate
        const generateButton = frame.getByRole('button', { name: /generate prompt/i });
        await generateButton.click();

        // VERIFY Output Modal appears
        await expect(frame.getByText(/Prompt Generated/i)).toBeVisible();

        // VERIFY Content in textarea
        const textarea = frame.locator('.fixed textarea');
        const content = await textarea.inputValue();
        expect(content).toContain("Intro.py");
        expect(content).toContain("print('Hello World')");
    });

    test('should filtering logic work (include output)', async ({ page }) => {
        const frame = page.frameLocator('#extension-frame');
        await frame.getByRole('button', { name: /Refresh|Scan/i }).click();

        // Toggle output for Plot.py (which has output <plot>)
        // Find the file item for Plot.py
        const plotItem = frame.locator('.group', { hasText: 'Plot.py' });

        // Provide a way to click specifically on the "Include Cell Output" button if visible
        // It is only visible if the item is selected. It should be selected by default.
        await expect(plotItem).toBeVisible();

        // Hover to reveal buttons if necessary (CSS opacity?) or just click
        // The button has title "Include Cell Output"
        const outputBtn = plotItem.getByTitle("Include Cell Output");
        await outputBtn.click(); // Enable output

        // Generate
        await frame.getByRole('button', { name: /generate prompt/i }).click();

        // Verify output contains the cell output
        const textarea = frame.locator('.fixed textarea');
        const content = await textarea.inputValue();
        expect(content).toContain("<plot>");
    });
});
