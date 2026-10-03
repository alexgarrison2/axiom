import { expect, test, type Page } from '@playwright/test';

/** The rail mounts in the browser after hydration: wait for it (or an empty slate) before counting rows. */
async function railItems(page: Page) {
    const rail = page.getByRole('navigation', { name: /^Games,/ });
    await expect(rail.or(page.getByText(/^(No games|Schedule unavailable)$/))).toBeVisible();
    return rail.locator('[data-rail-item]');
}

/** Wide desktop (≥1280px): a rail of every game, the selected game open in the pane beside it. */
test.describe('slate rail + pane', () => {
    test('selecting a game opens it in the pane, updates the hash, and the arrow keys move through games', async ({ page }) => {
        await page.goto('/');
        const items = await railItems(page);
        test.skip((await items.count()) < 2, 'needs two games on the slate');
        const pane = page.getByRole('region', { name: /game$/ });
        await expect(pane.getByRole('radio', { name: 'Form' })).toBeVisible();

        await items.nth(1).click();
        await expect(items.nth(1)).toHaveAttribute('aria-current', 'true');
        await expect(page).toHaveURL(/#[a-z]{3}-[a-z]{3}$/);

        await items.nth(1).focus();
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(2)).toHaveAttribute('aria-current', 'true');
    });

    test('the pane keeps the chosen tab across games and never scrolls sideways', async ({ page }) => {
        await page.goto('/');
        const items = await railItems(page);
        test.skip((await items.count()) < 2, 'needs two games on the slate');
        const pane = page.getByRole('region', { name: /game$/ });
        await pane.getByRole('radio', { name: 'Odds' }).click();
        await items.nth(1).click();
        await expect(pane.getByRole('radio', { name: 'Odds' })).toBeChecked();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
    });
});
