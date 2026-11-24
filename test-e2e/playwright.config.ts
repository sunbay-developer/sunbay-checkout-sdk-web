import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Load test-e2e/.env.local (git-ignored) so local options such as E2E_HEADED / E2E_SLOWMO can
// live there. Variables already set in the shell win over the file. A missing file is fine.
try {
    process.loadEnvFile(fileURLToPath(new URL('./.env.local', import.meta.url)));
} catch {
    // No .env.local: use shell variables and defaults only.
}

/**
 * Playwright config for the Checkout Web SDK real-device e2e suite.
 *
 * Environment (all optional, with safe local defaults; may also be set in test-e2e/.env.local,
 * shell values win):
 * - E2E_HARNESS_ORIGIN  Test harness + backend origin (default http://localhost:8090)
 * - E2E_HOSTED_ORIGIN   Hosted runtime origin (default http://localhost:3000)
 * - E2E_STUB_ORIGIN     Optional stub runtime origin for PROTOCOL_UNSUPPORTED (default http://localhost:8099)
 * - E2E_WEBKIT         '1' adds a `webkit` project next to chromium (default: chromium only).
 *                        Requires `npx playwright install webkit`.
 * - E2E_HEADED          '1' shows the browser (default: headless).
 * - E2E_SLOWMO          Milliseconds to slow each action down (default: 0).
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
        // Headless and full speed by default. Opt in separately:
        // E2E_HEADED=1 (or `--headed`) shows the browser; E2E_SLOWMO=<ms> slows each action.
        headless: process.env.E2E_HEADED !== '1',
        launchOptions: {
            slowMo: Number(process.env.E2E_SLOWMO) > 0 ? Number(process.env.E2E_SLOWMO) : 0,
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
