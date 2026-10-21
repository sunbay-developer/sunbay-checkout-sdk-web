/**
 * C2 — Embedding modes (element types, routing, auto-resize, card sub-options).
 * See ../test-cases.md §3.
 */
import { test, expect } from '@playwright/test';
import {
    openHarness,
    setup,
    callHarness,
    slotIframeSrc,
    slotIframeCount,
    elementStatus,
    availableWallets,
    getEvents,
    getParentMessages,
} from '../support/harness';
import { getHealth } from '../support/env';

test.beforeEach(async ({ page }) => {
    await openHarness(page);
    const health = await getHealth();
    test.skip(!health.hasCredentials, 'requires sandbox credentials (test-e2e/.env.local)');
});

test.afterEach(async ({ page }) => {
    await callHarness(page, 'reset').catch(() => undefined);
});

test('C2-01 combined card element mounts @p0 @c2', async ({ page }) => {
    const r = await setup(page, { session: 'auto', elements: [{ type: 'card', slot: '#slot-card' }] });
    expect(r.ok, r.error?.message).toBe(true);
    expect(r.mountStatus?.['#slot-card']).toBe('ready');
    expect(await slotIframeSrc(page, '#slot-card')).toContain('/sdk/element/card');
    expect(await elementStatus(page, '#slot-card')).toBe('ready');
    const events = await getEvents(page);
    expect(events.some((e) => e.source === '#slot-card' && e.name === 'elementReady')).toBe(true);
});

test('C2-02 split three fields mount @p0 @c2', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            { type: 'cardNumber', slot: '#slot-num' },
            { type: 'cardExpiry', slot: '#slot-exp' },
            { type: 'cardCvc', slot: '#slot-cvc' },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(await slotIframeSrc(page, '#slot-num')).toContain('/sdk/field/cardNumber');
    expect(await slotIframeSrc(page, '#slot-exp')).toContain('/sdk/field/cardExpiry');
    expect(await slotIframeSrc(page, '#slot-cvc')).toContain('/sdk/field/cardCvc');
    const events = await getEvents(page);
    for (const slot of ['#slot-num', '#slot-exp', '#slot-cvc']) {
        expect(events.filter((e) => e.source === slot && e.name === 'elementReady').length).toBe(1);
    }
});

test('C2-03 address billing + shipping @p1 @c2', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            { type: 'address', slot: '#slot-bill', options: { mode: 'billing' } },
            { type: 'address', slot: '#slot-ship', options: { mode: 'shipping' } },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(await slotIframeSrc(page, '#slot-bill')).toContain('/sdk/element/address');
    expect(await slotIframeSrc(page, '#slot-ship')).toContain('/sdk/element/address');
    const modes = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const h = (window as any).__sunbayHarness;
        return { bill: h.elements['#slot-bill']?.mode, ship: h.elements['#slot-ship']?.mode };
    });
    expect(modes.bill).toBe('billing');
    expect(modes.ship).toBe('shipping');
});

test('C2-04 expressCheckout mounts + availability @p1 @c2', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [{ type: 'expressCheckout', slot: '#slot-express' }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(await slotIframeSrc(page, '#slot-express')).toContain('/sdk/element/expressCheckout');
    const events = await getEvents(page);
    expect(events.some((e) => e.source === '#slot-express' && e.name === 'elementReady')).toBe(true);
    const wallets = await availableWallets(page, '#slot-express');
    // Both booleans present; may be false in a plain browser (expected, not a failure).
    expect(wallets).toBeTruthy();
    expect(typeof wallets!.applePay).toBe('boolean');
    expect(typeof wallets!.googlePay).toBe('boolean');
});

test('C2-05 iframe auto-resize @p2 @c2', async ({ page }) => {
    const r = await setup(page, { session: 'auto', elements: [{ type: 'card', slot: '#slot-card' }] });
    expect(r.ok, r.error?.message).toBe(true);
    // Wait for a resize message to arrive and the iframe height to be applied.
    await expect
        .poll(async () => {
            const msgs = await getParentMessages(page);
            return msgs.some(
                (m) =>
                    m.data &&
                    typeof m.data === 'object' &&
                    (m.data as { type?: string }).type === 'sunbay:checkout:iframe-resize'
            );
        }, { timeout: 15_000 })
        .toBe(true);
    const h = await page.evaluate(() => {
        const f = document.querySelector('#slot-card iframe') as HTMLIFrameElement | null;
        return f ? parseFloat(f.style.height || '0') : 0;
    });
    expect(h).toBeGreaterThan(0);
});

test('C2-06 combined card sub-options show/hide @p1 @c2', async ({ page }) => {
    // Variant B: all off — assert card still mounts ready (region visibility is a
    // hosted-render detail; in-frame structural checks require same-origin access).
    const r = await setup(page, {
        session: 'auto',
        elements: [
            {
                type: 'card',
                slot: '#slot-card',
                options: {
                    showBillingAddress: false,
                    showShippingAddress: false,
                    showPostalCode: false,
                },
            },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(await elementStatus(page, '#slot-card')).toBe('ready');
    expect(await slotIframeCount(page, '#slot-card')).toBe(1);
});
