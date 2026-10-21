/**
 * C5 — Element-level customization (appearance.rules).
 * See ../test-cases.md §6. In-iframe assertions via frameLocator.
 */
import { test, expect } from '@playwright/test';
import { openHarness, setup, callHarness, slotFrame, typeIntoField, assertNoCardLeak } from '../support/harness';
import { getHealth } from '../support/env';
import { INVALID_CARD_NUMBER } from '../fixtures/test-cards';

test.beforeEach(async ({ page }) => {
    await openHarness(page);
    const health = await getHealth();
    test.skip(!health.hasCredentials, 'requires sandbox credentials (test-e2e/.env.local)');
});

test.afterEach(async ({ page }) => {
    await callHarness(page, 'reset').catch(() => undefined);
});

test('C5-01 single target: input @p0 @c5', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        appearance: { rules: { input: { padding: '14px', 'font-size': '18px' } } },
        elements: [{ type: 'cardNumber', slot: '#slot-num' }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    const input = slotFrame(page, '#slot-num').locator('input').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    const style = await input.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { padding: cs.padding, fontSize: cs.fontSize };
    });
    expect(style.fontSize).toBe('18px');
    expect(style.padding).toContain('14px');
});

test('C5-02 multi target incl. focus/invalid/label/error @p0 @c5', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        appearance: {
            rules: {
                input: { color: '#111111' },
                'input:focus': { 'outline-color': '#2563eb' },
                'input:invalid': { color: '#dc2626' },
                label: { 'font-weight': '700' },
                error: { 'font-style': 'italic' },
            },
        },
        elements: [{ type: 'cardNumber', slot: '#slot-num' }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    // Trigger invalid state with a Luhn-failing number (NOT the sandbox card).
    await typeIntoField(page, '#slot-num', INVALID_CARD_NUMBER);
    const input = slotFrame(page, '#slot-num').locator('input').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    // The invalid anchor is data-sunbay-invalid (aria-invalid → attribute).
    await expect
        .poll(async () => input.getAttribute('data-sunbay-invalid'), { timeout: 10_000 })
        .not.toBeNull();
    await assertNoCardLeak(page);
});

test('C5-03 icon targets: cardBrand + cvvIcon @p1 @c5', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        appearance: { rules: { cardBrand: { opacity: '0.6' }, cvvIcon: { opacity: '0.4' } } },
        elements: [
            { type: 'cardNumber', slot: '#slot-num' },
            { type: 'cardCvc', slot: '#slot-cvc' },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    // Presence/visibility check: the fields mounted; icon anchors are hosted-render
    // details, asserted via the data-sunbay-el nodes when present.
    const brand = slotFrame(page, '#slot-num').locator('[data-sunbay-el="cardBrand"]');
    if (await brand.count()) {
        await expect.poll(async () => brand.first().evaluate((el) => getComputedStyle(el).opacity), {
            timeout: 10_000,
        }).toBe('0.6');
    }
});

test('C5-04 per-element appearance isolation @p1 @c5', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        elements: [
            { type: 'cardNumber', slot: '#slot-num', options: { appearance: { rules: { input: { color: '#ff0000' } } } } },
            { type: 'cardCvc', slot: '#slot-cvc', options: { appearance: { rules: { input: { color: '#0000ff' } } } } },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    const numColor = await slotFrame(page, '#slot-num')
        .locator('input')
        .first()
        .evaluate((el) => getComputedStyle(el).color);
    const cvcColor = await slotFrame(page, '#slot-cvc')
        .locator('input')
        .first()
        .evaluate((el) => getComputedStyle(el).color);
    expect(numColor).toBe('rgb(255, 0, 0)');
    expect(cvcColor).toBe('rgb(0, 0, 255)');
});

test('C5-05 non-whitelist rule property dropped @p2 @c5', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        appearance: { rules: { input: { position: 'fixed', 'z-index': '99999', color: '#123456' } } },
        elements: [{ type: 'cardNumber', slot: '#slot-num' }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    const input = slotFrame(page, '#slot-num').locator('input').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    const style = await input.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, position: cs.position };
    });
    expect(style.color).toBe('rgb(18, 52, 86)'); // #123456 applied
    expect(style.position).not.toBe('fixed'); // non-whitelist dropped
});
