/**
 * C3 — Element combinations & mutual exclusion.
 * See ../test-cases.md §4.
 */
import { test, expect } from '@playwright/test';
import {
    openHarness,
    setup,
    callHarness,
    elementStatus,
    slotIframeCount,
    getEvents,
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

test('C3-01 split fields + billing address + express @p0 @c3', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            { type: 'cardNumber', slot: '#slot-num' },
            { type: 'cardExpiry', slot: '#slot-exp' },
            { type: 'cardCvc', slot: '#slot-cvc' },
            { type: 'address', slot: '#slot-bill', options: { mode: 'billing' } },
            { type: 'expressCheckout', slot: '#slot-express' },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    for (const slot of ['#slot-num', '#slot-exp', '#slot-cvc', '#slot-bill', '#slot-express']) {
        expect(r.mountStatus?.[slot], slot).toBe('ready');
        expect(await elementStatus(page, slot)).toBe('ready');
    }
    const events = await getEvents(page);
    expect(events.filter((e) => e.name === 'elementReady').length).toBeGreaterThanOrEqual(5);
});

test('C3-02 combined card + express @p0 @c3', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            { type: 'card', slot: '#slot-card' },
            { type: 'expressCheckout', slot: '#slot-express' },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(r.creationErrors && Object.keys(r.creationErrors).length).toBeFalsy();
    expect(await elementStatus(page, '#slot-card')).toBe('ready');
    expect(await elementStatus(page, '#slot-express')).toBe('ready');
});

test('C3-03 card then split field -> ELEMENT_CONFLICT @p0 @c3', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            { type: 'card', slot: '#slot-card' },
            { type: 'cardNumber', slot: '#slot-num', expectConflict: true },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(r.creationErrors?.['#slot-num']?.code).toBe('ELEMENT_CONFLICT');
    expect(await slotIframeCount(page, '#slot-num')).toBe(0);
    expect(await elementStatus(page, '#slot-card')).toBe('ready');
});

test('C3-04 split field then card -> ELEMENT_CONFLICT @p1 @c3', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            { type: 'cardNumber', slot: '#slot-num' },
            { type: 'card', slot: '#slot-card', expectConflict: true },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(r.creationErrors?.['#slot-card']?.code).toBe('ELEMENT_CONFLICT');
    expect(await slotIframeCount(page, '#slot-card')).toBe(0);
    expect(await elementStatus(page, '#slot-num')).toBe('ready');
});

test('C3-05 duplicate split field -> ELEMENT_CONFLICT @p1 @c3', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            { type: 'cardNumber', slot: '#slot-num1' },
            { type: 'cardNumber', slot: '#slot-num2', expectConflict: true },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(r.creationErrors?.['#slot-num2']?.code).toBe('ELEMENT_CONFLICT');
    expect(await elementStatus(page, '#slot-num1')).toBe('ready');
});

test('C3-06 duplicate same-mode address -> ELEMENT_CONFLICT @p1 @c3', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            { type: 'address', slot: '#slot-b1', options: { mode: 'billing' } },
            { type: 'address', slot: '#slot-b2', options: { mode: 'billing' }, expectConflict: true },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(r.creationErrors?.['#slot-b2']?.code).toBe('ELEMENT_CONFLICT');
    expect(await elementStatus(page, '#slot-b1')).toBe('ready');
});

test('C3-07 expressCheckout singleton -> ELEMENT_CONFLICT @p1 @c3', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            { type: 'expressCheckout', slot: '#slot-e1' },
            { type: 'expressCheckout', slot: '#slot-e2', expectConflict: true },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(r.creationErrors?.['#slot-e2']?.code).toBe('ELEMENT_CONFLICT');
    expect(await elementStatus(page, '#slot-e1')).toBe('ready');
});

test('C3-08 rebuild mutually-exclusive element after destroy @p1 @c3', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [{ type: 'expressCheckout', slot: '#slot-express' }],
    });
    expect(r.ok, r.error?.message).toBe(true);

    // Destroy the express element to free the singleton slot.
    await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__sunbayHarness.elements['#slot-express'].destroy();
    });

    const rebuilt = await callHarness<{ ok: boolean }>(page, 'createElement', {
        type: 'expressCheckout',
        slot: '#slot-express',
        options: { paymentMethods: { applePay: { buttonType: 'buy' } } },
    });
    expect(rebuilt.ok).toBe(true);
    expect(await elementStatus(page, '#slot-express')).toBe('ready');
    expect(await slotIframeCount(page, '#slot-express')).toBe(1);
});

test('C3-09 session collectShippingAddress variant @p1 @c3', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        collectShippingAddress: true,
        elements: [{ type: 'address', slot: '#slot-ship', options: { mode: 'shipping' } }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    const session = await page.evaluate(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__sunbayHarness.instance.getSession()
    );
    // Degraded assertion per spec note: verify the collect flags are transmitted
    // as booleans; strict true depends on whether the sandbox honors the variant.
    expect(typeof session.collectShippingAddress).toBe('boolean');
    expect(typeof session.collectBillingAddress).toBe('boolean');
    expect(await elementStatus(page, '#slot-ship')).toBe('ready');
});
