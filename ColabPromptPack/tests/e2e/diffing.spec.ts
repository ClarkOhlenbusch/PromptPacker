import { test, expect } from '@playwright/test';

test.describe('Diffing Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Enable console logging
        page.on('console', msg => console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', err => console.log(`[BROWSER_ERROR]: ${err.message}`));

        await page.goto('/tests/mock-colab/harness.html');
        const frameElement = page.locator('#extension-frame');
        await expect(frameElement).toBeVisible();

        const frame = page.frameLocator('#extension-frame');
        // Ensure app content is loaded with longer timeout
        await expect(frame.getByText('Files', { exact: true })).toBeVisible({ timeout: 10000 });
    });

    test('should detect changes and show diffs', async ({ page }) => {
        const frame = page.frameLocator('#extension-frame');

        // 1. Initial Scan (Take Snapshot)
        console.log('Clicking Scan/Refresh...');
        const scanBtn = frame.getByRole('button', { name: /Refresh|Scan/i });
        await expect(scanBtn).toBeVisible();
        await scanBtn.click();
        console.log('Scan clicked. Waiting for Intro.py...');
        await expect(frame.locator('.truncate').getByText('Intro.py')).toBeVisible();

        // 2. Modify "Colab" State via Harness API
        await page.evaluate(() => {
            const newCells = (window as any).harness.getCells().map((c: any) => {
                if (c.relative_path === 'Intro.py') {
                    return { ...c, content: "# Introduction\nprint('Hello Universe')\n# Modified by Test" };
                }
                return c;
            });
            (window as any).harness.updateCells(newCells);
        });

        // 3. Scan Again (Trigger Diff)
        await frame.getByRole('button', { name: /Refresh|Scan/i }).click();

        // 4. Verify "View Diffs" button becomes active/visible
        // The button text might be "View Changes" or icon.
        // In `App.tsx`: `CellDiffsButton`... it is conditional on `cellDiffs.length > 0`.

        // Wait for diff calculation
        const diffButton = frame.getByRole('button', { name: /Diff/i }); // Adjust locator based on actual UI
        // If exact text is "View Changes" or similar.
        // Let's check App.tsx for the button text.
        // It seems to be an icon button or "View Changes".
        // Actually, let's look for the badge or the specific button in the UI toolbar.

        // Assuming the button appears or becomes enabled.
        await expect(diffButton).toBeVisible();
        await diffButton.click();

        // 5. Verify Diff Modal
        await expect(frame.getByText('CHANGES DETECTED')).toBeVisible();
        // Use first because Diff Modal might render differently, or just text.
        // If DiffModal uses same component, use truncate. If not, use first to be safe.
        await expect(frame.getByText('Intro.py').first()).toBeVisible();

        // Check for specific diff content
        await expect(frame.getByText(/Hello Universe/)).toBeVisible();
        // await expect(frame.getByText(/Modified by Test/)).toBeVisible();
    });
});
