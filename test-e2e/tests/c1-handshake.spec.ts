/**
 * C1 — Handshake & initialization.
 * See ../test-cases.md §2. One test per case; tags encode priority/category.
 */
import { test, expect } from '@playwright/test';
import { openHarness, setup, callHarness, slotIframeCount } from '../support/harness';
import { getHealth, hasStubRuntime, HOSTED_ORIGIN, STUB_ORIGIN, BLACKHOLE_ORIGIN } from '../support/env';

test.beforeEach(async ({ page }) => {
    await openHarness(page);
});

test.afterEach(async ({ page }) => {
    await callHarness(page, 'reset').catch(() => undefined);
});

test('C1-01 createCheckout handshake + initialize succeeds @p0 @c1', async ({ page }) => {
    const health = await getHealth();
    test.skip(!health.hasCredentials, 'requires sandbox credentials (test-e2e/.env.local)');

    const result = await setup(page, { session: 'auto', elements: [] });
    expect(result.ok, result.error?.message).toBe(true);
    expect(result.checkoutId).toBeTruthy();

    // Hidden 0x0 main iframe pointing at /sdk/main.
    const mainInfo = await page.evaluate((hosted) => {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const main = iframes.find((f) => f.src.includes('/sdk/main'));
        if (!main) return null;
        return { w: main.offsetWidth, h: main.offsetHeight, src: main.src, hosted };
    }, HOSTED_ORIGIN);
    expect(mainInfo, 'main iframe exists').not.toBeNull();
    expect(mainInfo!.src).toContain('/sdk/main');
    expect(mainInfo!.w).toBe(0);
    expect(mainInfo!.h).toBe(0);

    // getSession view has no rsaPublicKey.
    const session = await page.evaluate(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__sunbayHarness.instance.getSession()
    );
    expect(session).toBeTruthy();
    expect(session).not.toHaveProperty('rsaPublicKey');
    expect(session).toHaveProperty('sessionId');
});

test('C1-02 IIFE exposes window.SunbayCheckout @p0 @c1', async ({ page }) => {
    const ok = await page.evaluate(
        () => typeof (window as unknown as { SunbayCheckout?: { createCheckout?: unknown } }).SunbayCheckout?.createCheckout === 'function'
    );
    expect(ok).toBe(true);
});

test('C1-03 protocol major mismatch -> PROTOCOL_UNSUPPORTED @p1 @c1 @optional', async ({ page }) => {
    const stub = await hasStubRuntime();
    test.skip(!stub, `requires stub runtime at ${STUB_ORIGIN} (pnpm stub)`);

    // Error path: handshake fails before initialize, so a real session is not
    // required — use a fixed fake sessionId to keep this credential-independent.
    const result = await setup(page, { session: 'e2e-fake-session', hostOrigin: STUB_ORIGIN, elements: [] });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('PROTOCOL_UNSUPPORTED');
    // No lingering main iframe.
    const mains = await page.evaluate(
        () => Array.from(document.querySelectorAll('iframe')).filter((f) => f.src.includes('/sdk/main')).length
    );
    expect(mains).toBe(0);
});

test('C1-04 unreachable runtime -> RUNTIME_LOAD_FAILED @p1 @c1 @optional', async ({ page }) => {
    test.setTimeout(30_000);

    // Error path: the handshake times out before initialize, so no real session
    // is needed — use a fixed fake sessionId (credential-independent).
    const result = await setup(page, { session: 'e2e-fake-session', hostOrigin: BLACKHOLE_ORIGIN, elements: [] });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('RUNTIME_LOAD_FAILED');
});

test('C1-05 paymentMethods filter (subtract/sort only) @p2 @c1', async ({ page }) => {
    const health = await getHealth();
    test.skip(!health.hasCredentials, 'requires sandbox credentials');

    // First, discover the methods this session actually offers (no filter).
    const base = await setup(page, { session: 'auto', elements: [] });
    expect(base.ok, base.error?.message).toBe(true);
    const original: string[] = await page.evaluate(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).__sunbayHarness.instance.getSession().paymentMethods ?? []).map(
            (m: { method: string }) => m.method
        )
    );
    await callHarness(page, 'reset');
    test.skip(original.length < 1, 'session offers no payment methods to filter');

    // Hide the first real method; the result must drop it and never add anything.
    const toHide = original[0];
    const result = await setup(page, {
        session: 'auto',
        paymentMethods: { hide: [toHide] },
        elements: [],
    });
    expect(result.ok, result.error?.message).toBe(true);
    const methods: string[] = await page.evaluate(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).__sunbayHarness.instance.getSession().paymentMethods ?? []).map(
            (m: { method: string }) => m.method
        )
    );
    // Subtract-only: hidden method is gone, and the result is a subset of the original.
    expect(methods).not.toContain(toHide);
    for (const m of methods) {
        expect(original).toContain(m);
    }
});
