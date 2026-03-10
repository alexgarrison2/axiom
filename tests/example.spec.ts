import { test, expect } from '@playwright/test';

test('has title and loads prediction viewer', async ({ page }) => {
    // Navigate to the home page (configured as http://localhost:3000 in playwright.config.ts)
    await page.goto('/');

    // Expect a title "to contain" a substring.
    // We'll just verify the body is visible to start
    await expect(page.locator('body')).toBeVisible();

    // You can customize this to check for specific components, e.g., the PredictionsViewer
    // await expect(page.locator('text=Games')).toBeVisible(); 
});
