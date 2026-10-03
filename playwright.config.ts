import { defineConfig, devices } from '@playwright/test';

/*
 * E2E quality gate. Chromium only.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test
 *
 * Without PLAYWRIGHT_BASE_URL, Playwright starts `next start` on port 3100
 * itself (run `npm run build` first). CI builds once, starts the server and
 * passes the URL in (see .github/workflows/ci.yml).
 */
const PORT = Number(process.env.PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: isCI,
    // One retry absorbs a cold-start hiccup; a real regression still fails twice.
    retries: isCI ? 1 : 0,
    workers: isCI ? 2 : undefined,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: isCI
        ? [['github'], ['list'], ['html', { open: 'never' }]]
        : [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            // Synthetic pages that prove the detectors catch regressions.
            // Needs no server.
            name: 'gate-selftest',
            testMatch: /gate-selftest\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
        },
        {
            // Laptop/tablet width, below the rail + pane layout (xl, 1280px): the card grid with inline expansion.
            name: 'desktop',
            testIgnore: /gate-selftest\.spec\.ts|slate-pane\.spec\.ts/,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 900 } },
        },
        {
            // Wide desktop: the rail of games and the pane beside it.
            name: 'desktop-wide',
            testMatch: /slate-pane\.spec\.ts/,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
        },
        {
            name: 'mobile',
            testIgnore: /gate-selftest\.spec\.ts|slate-pane\.spec\.ts/,
            // Pixel 7 runs on Chromium (390-412px class phone, touch, DPR 2.6).
            use: { ...devices['Pixel 7'] },
        },
    ],
    webServer: process.env.PLAYWRIGHT_BASE_URL
        ? undefined
        : {
              command: `npx next start -p ${PORT}`,
              url: baseURL,
              reuseExistingServer: !isCI,
              timeout: 120_000,
          },
});
