/**
 * C9 — Card on file (saved cards) in the `card` Element.
 * See ../../../checkout-hosted/docs/superpowers/specs/2026-11-23-sdk-cof-design.md.
 * The sandbox test card is typed directly into the hosted card iframe (PCI: the SDK and the
 * merchant page never see it); the saved-card list and ids stay inside the hosted domain.
 */
import { test, expect } from '@playwright/test';
import { openHarness, setup, callHarness, slotFrame, getEvents } from '../support/harness';
import { getHealth } from '../support/env';
import { SANDBOX_CARD_DEFAULT } from '../fixtures/test-cards';

const CARD_SLOT = '#slot-card';
const WRONG_SECRET = `cas_${'0'.repeat(32)}`;
const SAVE_LABEL = 'Save this card for future payments';

test.beforeEach(async ({ page }) => {
    await openHarness(page);
    const health = await getHealth();
    test.skip(!health.hasCredentials, 'requires sandbox credentials (test-e2e/.env.local)');
});

test.afterEach(async ({ page }) => {
    await callHarness(page, 'reset').catch(() => undefined);
});

/** Type the sandbox card straight into the card Element iframe. */
async function fillCardElement(page: import('@playwright/test').Page): Promise<void> {
    // Inputs in order: number, expiry, CVC. Placeholders change with the detected brand,
    // so locate by position.
    const inputs = slotFrame(page, CARD_SLOT).locator('input:not([type="checkbox"]):not([type="hidden"])');
    await inputs.nth(0).fill(SANDBOX_CARD_DEFAULT.cardNumber);
    await inputs
        .nth(1)
        .fill(`${SANDBOX_CARD_DEFAULT.expiryMonth}${SANDBOX_CARD_DEFAULT.expiryYear.slice(2)}`);
    await inputs.nth(2).fill(SANDBOX_CARD_DEFAULT.cvv);
}

async function confirmSucceeds(page: import('@playwright/test').Page): Promise<void> {
    const confirm = await callHarness<{ ok: boolean; outcome?: { status: string } }>(
        page,
        'confirm',
        { resultTimeoutMs: 45_000 }
    );
    expect(confirm.ok, JSON.stringify(confirm)).toBe(true);
    expect(confirm.outcome?.status, JSON.stringify(confirm)).toBe('succeeded');
}

test('C9-01 without customerAccessSecret the card Element is unchanged (no list, no save checkbox) @p0 @c9', async ({
    page,
}) => {
    test.setTimeout(90_000);
    const r = await setup(page, {
        session: 'auto',
        locale: 'en-US',
        collectBillingAddress: false,
        elements: [{ type: 'card', slot: CARD_SLOT }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    const frame = slotFrame(page, CARD_SLOT);
    await expect(frame.getByPlaceholder('1234 5678 9012 3456')).toBeVisible();
    await expect(frame.getByText(SAVE_LABEL)).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Change' })).toHaveCount(0);
});

test('C9-02 a wrong customerAccessSecret degrades to the new-card form and payment still works @p0 @c9', async ({
    page,
}) => {
    test.setTimeout(120_000);
    const r = await setup(page, {
        session: 'auto',
        locale: 'en-US',
        collectBillingAddress: false,
        customerId: `e2e-cof-bad-${Date.now()}`,
        supportStoreCard: true,
        customerAccessSecret: WRONG_SECRET,
        elements: [{ type: 'card', slot: CARD_SLOT }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    const frame = slotFrame(page, CARD_SLOT);
    await expect(frame.getByPlaceholder('1234 5678 9012 3456')).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Change' })).toHaveCount(0);
    await fillCardElement(page);
    await confirmSucceeds(page);
});

test('C9-03 save a new card, then pay with it on a new session @p0 @c9', async ({ page }) => {
    test.setTimeout(240_000);
    const customerId = `e2e-cof-${Date.now()}`;

    // Session 1: pay with a new card and tick "save this card".
    let r = await setup(page, {
        session: 'auto',
        locale: 'en-US',
        collectBillingAddress: false,
        customerId,
        supportStoreCard: true,
        elements: [{ type: 'card', slot: CARD_SLOT }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    let frame = slotFrame(page, CARD_SLOT);
    await expect(frame.getByText(SAVE_LABEL)).toBeVisible();
    await fillCardElement(page);
    await frame.getByText(SAVE_LABEL).click();
    await confirmSucceeds(page);
    await callHarness(page, 'reset');

    // Session 2: same customer; the saved card is listed and selected by default.
    r = await setup(page, {
        session: 'auto',
        locale: 'en-US',
        collectBillingAddress: false,
        customerId,
        supportStoreCard: true,
        elements: [{ type: 'card', slot: CARD_SLOT }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    frame = slotFrame(page, CARD_SLOT);
    const last4 = SANDBOX_CARD_DEFAULT.cardNumber.slice(-4);
    await expect(frame.getByText(`•••• ${last4}`).first()).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Change' })).toBeVisible();

    // The merchant page learns only the selection source, never which card.
    await expect
        .poll(async () =>
            (await getEvents(page)).some(
                (e) => e.name === 'change' && (e.payload as { cardSource?: string }).cardSource === 'saved'
            )
        )
        .toBe(true);
    const eventsText = JSON.stringify(await getEvents(page));
    expect(eventsText).not.toContain('sc_');
    expect(eventsText).not.toContain('cas_');

    await confirmSucceeds(page);
});
