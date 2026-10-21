/**
 * C6 — Express wallet button customization.
 * See ../test-cases.md §7. Most assertions verify option pass-through via iframe
 * src; actual wallet invocation (C6-05) is optional and condition-gated.
 */
import { test, expect } from '@playwright/test';
import { openHarness, setup, callHarness, slotIframeSrc, elementStatus, availableWallets, getEvents } from '../support/harness';
import { getHealth } from '../support/env';

test.beforeEach(async ({ page }) => {
    await openHarness(page);
    const health = await getHealth();
    test.skip(!health.hasCredentials, 'requires sandbox credentials (test-e2e/.env.local)');
});

test.afterEach(async ({ page }) => {
    await callHarness(page, 'reset').catch(() => undefined);
});

test('C6-01 applePay=false forces hide @p1 @c6', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            { type: 'expressCheckout', slot: '#slot-express', options: { paymentMethods: { applePay: false } } },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(await slotIframeSrc(page, '#slot-express')).toContain('applePay=false');
});

test('C6-02 per-wallet buttonType pass-through @p1 @c6', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            {
                type: 'expressCheckout',
                slot: '#slot-express',
                options: { paymentMethods: { applePay: { buttonType: 'buy' }, googlePay: { buttonType: 'checkout' } } },
            },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    const src = await slotIframeSrc(page, '#slot-express');
    expect(src).toContain('applePayButtonType=buy');
    expect(src).toContain('googlePayButtonType=checkout');
});

test('C6-03 global buttonHeight pass-through @p2 @c6', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [{ type: 'expressCheckout', slot: '#slot-express', options: { buttonHeight: 50 } }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(await slotIframeSrc(page, '#slot-express')).toContain('buttonHeight=50');
});

test('C6-04 buttonTheme explicit override @p2 @c6', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        appearance: { colorScheme: 'dark' },
        elements: [
            {
                type: 'expressCheckout',
                slot: '#slot-express',
                options: { paymentMethods: { applePay: { buttonTheme: 'white-outline' } } },
            },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    // Theme is applied inside the hosted iframe; here we assert the express element
    // mounts without error (visual theme assertion requires a wallet-capable env).
    expect(await elementStatus(page, '#slot-express')).toBe('ready');
});

test('C6-05 wallet actually invokes @p2 @c6 @optional', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [{ type: 'expressCheckout', slot: '#slot-express' }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    const wallets = await availableWallets(page, '#slot-express');
    // Without Apple/Google Pay capable env, wallets are unavailable → expected skip.
    test.skip(
        !wallets || (!wallets.applePay && !wallets.googlePay),
        'requires apple-pay/google-pay capable environment (real device + certs)'
    );
    // When available: click the first wallet button and expect a paymentStateChange.
    const btn = page.frameLocator('#slot-express iframe').locator('button, apple-pay-button').first();
    await btn.click();
    await expect
        .poll(async () => (await getEvents(page)).some((e) => e.name === 'paymentStateChange'), {
            timeout: 15_000,
        })
        .toBe(true);
});
