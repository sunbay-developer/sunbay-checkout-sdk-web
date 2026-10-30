/**
 * C7 — Payment flow & lifecycle.
 * See ../test-cases.md §8. Card entry goes directly into hosted field iframes
 * (SDK-bypassing); every card-entry test asserts no card leak.
 */
import { test, expect } from '@playwright/test';
import {
    openHarness,
    setup,
    callHarness,
    fillCardAcrossIframes,
    assertNoCardLeak,
    elementStatus,
    slotIframeCount,
    slotFrame,
    getEvents,
} from '../support/harness';
import { getHealth } from '../support/env';
import { SANDBOX_CARD_DEFAULT } from '../fixtures/test-cards';

const SPLIT = [
    { type: 'cardNumber', slot: '#slot-num' },
    { type: 'cardExpiry', slot: '#slot-exp' },
    { type: 'cardCvc', slot: '#slot-cvc' },
];
const SPLIT_SLOTS = { number: '#slot-num', expiry: '#slot-exp', cvc: '#slot-cvc' };

test.beforeEach(async ({ page }) => {
    await openHarness(page);
    const health = await getHealth();
    test.skip(!health.hasCredentials, 'requires sandbox credentials (test-e2e/.env.local)');
});

test.afterEach(async ({ page }) => {
    await callHarness(page, 'reset').catch(() => undefined);
});

test('C7-01 full card payment flow -> paymentResult @p0 @c7', async ({ page }) => {
    test.setTimeout(90_000);
    const r = await setup(page, { session: 'auto', elements: SPLIT });
    expect(r.ok, r.error?.message).toBe(true);

    try {
        await fillCardAcrossIframes(page, SPLIT_SLOTS, SANDBOX_CARD_DEFAULT);
        // confirm() resolves terminal outcomes or, once the watchdog fires, 'pending'.
        const confirm = await callHarness<{
            ok: boolean;
            outcome?: { status: string; operationId: string };
            operationId?: string;
        }>(page, 'confirm', { resultTimeoutMs: 45_000 });
        expect(confirm.ok, JSON.stringify(confirm)).toBe(true);
        expect(confirm.operationId, 'operationId present').toBeTruthy();
        expect(confirm.outcome?.operationId).toBe(confirm.operationId);

        const paymentResultFor = async (): Promise<{ status?: string } | undefined> => {
            const hit = (await getEvents(page)).find(
                (e) =>
                    e.name === 'paymentResult' &&
                    (e.payload as { operationId?: string }).operationId === confirm.operationId
            );
            return (hit?.payload as { outcome?: { status?: string } } | undefined)?.outcome;
        };

        let terminal = confirm.outcome?.status;
        if (terminal === 'pending') {
            // Watchdog fired. The sandbox must still reach a terminal state: wait (bounded)
            // for a later terminal paymentResult with the same operationId; otherwise FAIL.
            await expect
                .poll(
                    async () => {
                        const s = (await paymentResultFor())?.status;
                        return s !== undefined && s !== 'pending' ? s : undefined;
                    },
                    { timeout: 60_000, message: 'stuck payment: no terminal paymentResult after pending' }
                )
                .toBeDefined();
            terminal = (await paymentResultFor())?.status;
        }
        expect(['succeeded', 'failed', 'canceled']).toContain(terminal);

        const matching = (await getEvents(page)).filter(
            (e) =>
                e.name === 'paymentResult' &&
                (e.payload as { operationId?: string }).operationId === confirm.operationId
        );
        expect(matching.length, 'paymentResult event with the same operationId').toBeGreaterThanOrEqual(1);
    } finally {
        // PCI scan always runs, whatever the payment outcome.
        await assertNoCardLeak(page);
    }
});

test('C7-02 card value never leaks (PCI) @p0 @c7', async ({ page }) => {
    test.setTimeout(90_000);
    const r = await setup(page, { session: 'auto', elements: SPLIT });
    expect(r.ok, r.error?.message).toBe(true);
    await fillCardAcrossIframes(page, SPLIT_SLOTS, SANDBOX_CARD_DEFAULT);
    await callHarness(page, 'confirm').catch(() => undefined);
    await assertNoCardLeak(page);
});

test('C7-03 change event (empty/complete/brand, no card value) @p1 @c7', async ({ page }) => {
    const r = await setup(page, { session: 'auto', elements: [{ type: 'cardNumber', slot: '#slot-num' }] });
    expect(r.ok, r.error?.message).toBe(true);
    const input = page.frameLocator('#slot-num iframe').locator('input').first();
    await input.click();
    await input.fill(SANDBOX_CARD_DEFAULT.cardNumber);
    await expect
        .poll(async () => (await getEvents(page)).some((e) => e.source === '#slot-num' && e.name === 'change'), {
            timeout: 15_000,
        })
        .toBe(true);
    const changes = (await getEvents(page)).filter((e) => e.name === 'change');
    const last = changes[changes.length - 1]?.payload as { complete?: boolean; brand?: string };
    expect(last?.complete).toBe(true);
    await assertNoCardLeak(page);
});

test('C7-04 CHECKOUT_BUSY when confirm already in progress @p1 @c7', async ({ page }) => {
    test.setTimeout(90_000);
    const r = await setup(page, { session: 'auto', elements: SPLIT });
    expect(r.ok, r.error?.message).toBe(true);
    await fillCardAcrossIframes(page, SPLIT_SLOTS, SANDBOX_CARD_DEFAULT);
    // Fire two confirms without awaiting the first; the second must reject CHECKOUT_BUSY.
    const both = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const h = (window as any).__sunbayHarness;
        const p1 = h.confirm();
        const p2 = h.confirm();
        return Promise.all([p1, p2]);
    });
    const codes = both.map((b: { ok: boolean; error?: { code: string } }) => (b.ok ? 'ok' : b.error?.code));
    expect(codes).toContain('CHECKOUT_BUSY');
});

test('C7-05 focus/blur/clear actions are callable @p1 @c7', async ({ page }) => {
    const r = await setup(page, { session: 'auto', elements: [{ type: 'cardNumber', slot: '#slot-num' }] });
    expect(r.ok, r.error?.message).toBe(true);
    const methods = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const el = (window as any).__sunbayHarness.elements['#slot-num'];
        return { focus: typeof el.focus, blur: typeof el.blur, clear: typeof el.clear };
    });
    expect(methods).toEqual({ focus: 'function', blur: 'function', clear: 'function' });
    // Commands are accepted (resolve, no error event).
    await callHarness(page, 'action', '#slot-num', 'focus');
    await callHarness(page, 'action', '#slot-num', 'clear');
    await callHarness(page, 'action', '#slot-num', 'blur');
    const errs = (await getEvents(page)).filter((e) => e.name === 'error');
    expect(errs.length).toBe(0);
    // NOTE: hosted runtime does not yet implement focus/blur/clear handlers;
    // UI clear + focus/blur events are not asserted here (see test-cases.md C7-05).
});

test('C7-06 getSession / refresh / getPaymentStatus @p1 @c7', async ({ page }) => {
    const r = await setup(page, { session: 'auto', elements: [] });
    expect(r.ok, r.error?.message).toBe(true);
    const out = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inst = (window as any).__sunbayHarness.instance;
        const session = await inst.getSession();
        const refreshed = await inst.refresh();
        const status = await inst.getPaymentStatus();
        return { session, refreshed, status };
    });
    expect(out.session).toHaveProperty('sessionId');
    expect(out.session).not.toHaveProperty('rsaPublicKey');
    expect(out.refreshed).toHaveProperty('sessionId');
    expect(['I', 'S', 'F', 'R']).toContain(out.status.txnStatus);
});

test('C7-07 destroy idempotent + post-destroy -> INSTANCE_DESTROYED @p1 @c7', async ({ page }) => {
    const r = await setup(page, { session: 'auto', elements: [{ type: 'card', slot: '#slot-card' }] });
    expect(r.ok, r.error?.message).toBe(true);

    const out = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inst = (window as any).__sunbayHarness.instance;
        inst.destroy();
        let secondThrew = false;
        try {
            inst.destroy();
        } catch {
            secondThrew = true;
        }
        let confirmErr: string | undefined;
        try {
            await inst.confirm();
        } catch (e) {
            confirmErr = (e as { code?: string }).code;
        }
        let sessionErr: string | undefined;
        try {
            await inst.getSession();
        } catch (e) {
            sessionErr = (e as { code?: string }).code;
        }
        return { secondThrew, confirmErr, sessionErr };
    });
    expect(out.secondThrew).toBe(false);
    expect(out.confirmErr).toBe('INSTANCE_DESTROYED');
    expect(out.sessionErr).toBe('INSTANCE_DESTROYED');
    const anyIframe = await page.evaluate(() => document.querySelectorAll('iframe').length);
    expect(anyIframe).toBe(0);
});

test('C7-08 element unmount / remount @p2 @c7', async ({ page }) => {
    const r = await setup(page, { session: 'auto', elements: [{ type: 'card', slot: '#slot-card' }] });
    expect(r.ok, r.error?.message).toBe(true);
    await callHarness(page, 'unmount', '#slot-card');
    expect(await slotIframeCount(page, '#slot-card')).toBe(0);
    expect(await elementStatus(page, '#slot-card')).toBe('created');
    const remount = await callHarness<{ ok: boolean }>(page, 'mount', '#slot-card');
    expect(remount.ok).toBe(true);
    expect(await elementStatus(page, '#slot-card')).toBe('ready');
    expect(await slotIframeCount(page, '#slot-card')).toBe(1);
});

test('C7-09 locale runtime switch via updateCheckout @p2 @c7', async ({ page }) => {
    const r = await setup(page, {
        session: 'auto',
        locale: 'en-US',
        elements: [{ type: 'card', slot: '#slot-card' }],
    });
    expect(r.ok, r.error?.message).toBe(true);

    // Initial locale is en-US: the card iframe renders the English card-information title.
    const frame = slotFrame(page, '#slot-card');
    await expect(frame.getByText('Card information')).toBeVisible({ timeout: 15_000 });

    // updateCheckout({ locale }) must be accepted (promise resolves, no error).
    await callHarness(page, 'updateCheckout', { locale: 'zh-CN' });
    const errs = (await getEvents(page)).filter((e) => e.name === 'error');
    expect(errs.length).toBe(0);

    // Runtime hot-switch: the hosted runtime broadcasts a localeChange signal to the
    // mounted element iframe, which loads the zh-CN bundle and re-drives next-intl. The
    // in-iframe text must switch en-US->zh-CN WITHOUT a reload.
    await expect(frame.getByText('银行卡信息')).toBeVisible({ timeout: 15_000 });
    await expect(frame.getByText('Card information')).toHaveCount(0);
});

test('C7-10 multiple instances isolation @p2 @c7', async ({ page }) => {
    const rA = await setup(page, {
        session: 'auto',
        instanceKey: 'A',
        elements: [{ type: 'card', slot: '#slot-card' }],
    });
    const rB = await setup(page, {
        session: 'auto',
        instanceKey: 'B',
        elements: [{ type: 'card', slot: '#slot-card2' }],
    });
    expect(rA.ok && rB.ok, `${rA.error?.message} ${rB.error?.message}`).toBe(true);

    const ids = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const h = (window as any).__sunbayHarness;
        return { a: h.instances.A.checkoutId, b: h.instances.B.checkoutId };
    });
    expect(ids.a).not.toBe(ids.b);

    // Destroy A; B must stay usable.
    await callHarness(page, 'destroy', 'A');
    const bStillWorks = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inst = (window as any).__sunbayHarness.instances.B;
        const s = await inst.getSession();
        return Boolean(s && s.sessionId);
    });
    expect(bStillWorks).toBe(true);
});
