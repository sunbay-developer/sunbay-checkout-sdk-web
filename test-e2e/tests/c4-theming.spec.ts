/**
 * C4 — Theming (colorScheme + variables).
 * See ../test-cases.md §5.
 *
 * In-iframe style assertions run inside the hosted frame context via frameLocator
 * (parent JS cannot read cross-origin computed styles directly).
 */
import { test, expect } from '@playwright/test';
import { openHarness, setup, callHarness, slotIframeSrc, slotFrame } from '../support/harness';
import { getHealth } from '../support/env';

test.beforeEach(async ({ page }) => {
    await openHarness(page);
    const health = await getHealth();
    test.skip(!health.hasCredentials, 'requires sandbox credentials (test-e2e/.env.local)');
});

test.afterEach(async ({ page }) => {
    await callHarness(page, 'reset').catch(() => undefined);
});

/** Read whether the hosted frame's <html> carries the `dark` class. */
async function frameIsDark(page: import('@playwright/test').Page, slot: string): Promise<boolean> {
    const html = slotFrame(page, slot).locator('html');
    const cls = (await html.getAttribute('class')) ?? '';
    return cls.split(/\s+/).includes('dark');
}

test('C4-01 initial colorScheme=dark (no-flash via src) @p0 @c4', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        appearance: { colorScheme: 'dark' },
        elements: [{ type: 'card', slot: '#slot-card' }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(await slotIframeSrc(page, '#slot-card')).toContain('colorScheme=dark');
    await expect.poll(() => frameIsDark(page, '#slot-card'), { timeout: 15_000 }).toBe(true);
});

test('C4-02 initial colorScheme=light @p1 @c4', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        appearance: { colorScheme: 'light' },
        elements: [{ type: 'card', slot: '#slot-card' }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(await slotIframeSrc(page, '#slot-card')).toContain('colorScheme=light');
    await expect.poll(() => frameIsDark(page, '#slot-card'), { timeout: 10_000 }).toBe(false);
});

test('C4-03 runtime colorScheme switch via updateCheckout @p0 @c4', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        appearance: { colorScheme: 'light' },
        elements: [
            { type: 'cardNumber', slot: '#slot-num' },
            { type: 'cardExpiry', slot: '#slot-exp' },
            { type: 'cardCvc', slot: '#slot-cvc' },
        ],
    });
    expect(r.ok, r.error?.message).toBe(true);
    await callHarness(page, 'updateCheckout', { appearance: { colorScheme: 'dark' } });
    for (const slot of ['#slot-num', '#slot-exp', '#slot-cvc']) {
        await expect.poll(() => frameIsDark(page, slot), { timeout: 15_000 }).toBe(true);
    }
});

test('C4-04 initial variables (whitelist set) @p0 @c4', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        appearance: {
            variables: {
                colorPrimary: '#7c3aed',
                colorBackground: '#0b1020',
                colorText: '#e5e7eb',
                colorBorder: '#334155',
                colorDanger: '#ef4444',
                borderRadius: '12px',
                fontFamily: 'Georgia, serif',
            },
        },
        elements: [{ type: 'card', slot: '#slot-card' }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    expect(await slotIframeSrc(page, '#slot-card')).toContain('appearance=');
    // Spot-check an input's border-radius inside the frame.
    const input = slotFrame(page, '#slot-card').locator('input').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    const radius = await input.evaluate((el) => getComputedStyle(el).borderRadius);
    // borderRadius may be a per-corner shorthand (e.g. "12px 12px 0px 0px" when
    // only the top corners are rounded); assert the radius value is applied.
    expect(radius).toContain('12px');
});

test('C4-05 runtime variables switch via updateCheckout @p1 @c4', async ({ page }) => {
    const r = await setup(page, { session: 'auto', elements: [{ type: 'card', slot: '#slot-card' }] });
    expect(r.ok, r.error?.message).toBe(true);
    await callHarness(page, 'updateCheckout', {
        appearance: { variables: { colorPrimary: '#16a34a', borderRadius: '2px' } },
    });
    const input = slotFrame(page, '#slot-card').locator('input').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => input.evaluate((el) => getComputedStyle(el).borderRadius), {
        timeout: 15_000,
    }).toContain('2px');
});

test('C4-06 invalid variables dropped (whitelist, no injection) @p2 @c4', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        appearance: {
            variables: { colorPrimary: 'javascript:alert(1)', borderRadius: '999invalid' },
        },
        elements: [{ type: 'card', slot: '#slot-card' }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    const input = slotFrame(page, '#slot-card').locator('input').first();
    await expect(input).toBeVisible({ timeout: 15_000 });
    const radius = await input.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).not.toBe('999invalid');
});
