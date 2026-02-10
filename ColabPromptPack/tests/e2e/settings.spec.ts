import { test, expect } from '@playwright/test';

test.describe('Settings Flow', () => {
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

    test('should open settings and toggle options', async ({ page }) => {
        const frame = page.frameLocator('#extension-frame');

        // 1. Open Settings
        console.log('Opening settings...');
        await frame.getByRole('button', { name: /Settings/i }).click();

        // 2. Verify Settings Modal Visible
        const modal = frame.locator('.fixed'); // Modal container
        await expect(modal).toBeVisible();
        await expect(modal.getByText('Settings')).toBeVisible();

        // 3. Toggle "Include Markdown"
        // Use getByText instead of getByLabel if label association is tricky
        const markdownToggle = frame.getByText('Include Markdown');
        await expect(markdownToggle).toBeVisible();
        await markdownToggle.click();

        // 4. Toggle "Include Cell Output"
        const outputToggle = frame.getByText('Include Outputs');
        await expect(outputToggle).toBeVisible();
        await outputToggle.click();

        // 5. Close specific settings modal
        // There is a Done button inside the modal
        await frame.getByRole('button', { name: /Done/i }).click();

        // 6. Verify Modal Closed
        // Ensure modal container is gone
        await expect(frame.locator('.fixed')).not.toBeVisible();
    });

    // Optional: Test shortcuts recording
});
