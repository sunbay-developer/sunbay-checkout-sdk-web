import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Checkout Web SDK real-device e2e suite.
 *
 * Environment (all optional, with safe local defaults):
 * - E2E_HARNESS_ORIGIN  Test harness + backend origin (default http://localhost:8090)
 * - E2E_HOSTED_ORIGIN   Hosted runtime origin (default http://localhost:3000)
 * - E2E_STUB_ORIGIN     Optional stub runtime origin for PROTOCOL_UNSUPPORTED (default http://localhost:8099)
 * - E2E_WEBKIT         '1' adds a `webkit` project next to chromium (default: chromium only).
 *                        Requires `npx playwright install webkit`.
 * - E2E_HAVE_CREDENTIALS 'true' when server/.env.local has sandbox merchant credentials;
 *                        when unset/false, session-dependent tests are skipped (see support/env.ts).
 *
 * The test backend (server/server.mjs) is started automatically via webServer below.
 * The hosted runtime must already be running (started manually or auto-detected);
 * see RUNNING.md.
 */
const HARNESS_ORIGIN = process.env.E2E_HARNESS_ORIGIN ?? 'http://localhost:8090';

export default defineConfig({
    testDir: './tests',
    // One test per case; keep them isolated. Full isolation matters because each
    // test creates/destroys real cross-origin iframes.
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['json', { outputFile: 'playwright-report/results.json' }],
    ],
    timeout: 60_000,
    expect: { timeout: 15_000 },
    use: {
        baseURL: HARNESS_ORIGIN,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        // Real-device runs default to a HEADED browser so the effect is observable.
        // Set E2E_HEADLESS=1 (e.g. in CI) to run headless.
        headless: process.env.E2E_HEADLESS === '1',
        launchOptions: {
            // Slow down actions a bit so the mounting/theming/payment flow is visible.
            slowMo: process.env.E2E_HEADLESS === '1' ? 0 : Number(process.env.E2E_SLOWMO ?? 250),
        },
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        ...(process.env.E2E_WEBKIT === '1'
            ? [
                  {
                      name: 'webkit',
                      use: { ...devices['Desktop Safari'] },
                  },
              ]
            : []),
    ],
    // Auto-start the test backend (serves harness.html + SDK dist + /api/create-session).
    // Reuses an already-running instance locally.
    webServer: {
        command: 'node server/server.mjs',
        url: `${HARNESS_ORIGIN}/healthz`,
        reuseExistingServer: !process.env.CI,
        timeout: 20_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
