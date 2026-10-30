/**
 * C8 — Wallet (Apple Pay) error propagation.
 *
 * Verifies that failures/cancellations inside the hosted Express wallet flow reach the
 * MERCHANT page as typed events: an `error` event (method / stage / backendCode /
 * traceId) plus a `paymentResult` sharing the same operationId, and that no wallet
 * token ever appears in events or parent messages (PCI).
 *
 * How it works: `context.addInitScript` installs a stub `window.ApplePaySession` in
 * EVERY frame (including the cross-origin hosted iframes). The stub reports
 * canMakePayments() === true and `begin()` plays a scripted scenario:
 *   - validationFail : fires onvalidatemerchant with a bogus validationURL, so the
 *                      sandbox backend rejects merchant validation.
 *   - cancel         : fires oncancel (user dismissed the sheet).
 *   - authorizeFail : fires onpaymentauthorized with a fake token and makes
 *                      completePayment() throw, so the failure truly originates in the
 *                      authorization stage (applePayClient: stage 'authorization').
 *
 * How to run (needs sandbox credentials in test-e2e/.env.local and the hosted runtime
 * running, see ../RUNNING.md). The specs are skipped without credentials, or when the
 * sandbox session does not offer Apple Pay:
 *
 *   cd test-e2e && npx playwright test tests/c8-wallet-errors.spec.ts
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { openHarness, setup, callHarness, getEvents, getParentMessages, availableWallets } from '../support/harness';
import type { HarnessEvent } from '../support/harness';
import { getHealth } from '../support/env';

type Scenario = 'validationFail' | 'cancel' | 'authorizeFail';

/** Fake wallet token string; it must never be observable by the merchant page. */
const STUB_TOKEN = 'STUB_APPLE_PAY_TOKEN_DO_NOT_LEAK_7f3a9c';

/**
 * Install the ApplePaySession stub into every frame of the context. Must run before
 * the harness page navigates.
 */
async function installApplePayStub(context: BrowserContext, scenario: Scenario, token: string): Promise<void> {
    await context.addInitScript(
        ({ scenarioName, tokenValue }) => {
            const w = window as unknown as Record<string, unknown>;

            class StubApplePaySession {
                static STATUS_SUCCESS = 0;
                static STATUS_FAILURE = 1;
                static canMakePayments(): boolean {
                    return true;
                }
                static supportsVersion(): boolean {
                    return true;
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onvalidatemerchant: ((e: any) => void) | null = null;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onpaymentauthorized: ((e: any) => void) | null = null;
                oncancel: (() => void) | null = null;

                completeMerchantValidation(): void {}
                completePayment(): void {
                    if (scenarioName === 'authorizeFail') {
                        throw new Error('stub completePayment failure');
                    }
                }
                abort(): void {}

                begin(): void {
                    setTimeout(() => {
                        if (scenarioName === 'cancel') {
                            this.oncancel?.();
                        } else if (scenarioName === 'authorizeFail') {
                            this.onpaymentauthorized?.({
                                payment: { token: { paymentData: { data: tokenValue } } },
                            });
                        } else {
                            this.onvalidatemerchant?.({
                                validationURL: 'https://apple-pay-gateway.invalid/paymentservices/startSession',
                            });
                        }
                    }, 50);
                }
            }
            w.ApplePaySession = StubApplePaySession;
        },
        { scenarioName: scenario, tokenValue: token }
    );
}

interface OperationPayload {
    operationId?: string;
    method?: string;
    stage?: string;
    outcome?: { status?: string };
    error?: { code?: string; backendCode?: string; traceId?: string };
}

/** Start an Express wallet session with the stub installed; skip if applePay is unavailable. */
async function startExpress(page: Page, context: BrowserContext, scenario: Scenario): Promise<void> {
    const health = await getHealth();
    test.skip(!health.hasCredentials, 'requires sandbox credentials (test-e2e/.env.local)');
    await installApplePayStub(context, scenario, STUB_TOKEN);
    await openHarness(page);
    const r = await setup(page, {
        session: 'auto',
        elements: [{ type: 'expressCheckout', slot: '#slot-express' }],
    });
    expect(r.ok, r.error?.message).toBe(true);
    // Give the wallet availability probe a moment to report.
    await expect
        .poll(async () => (await availableWallets(page, '#slot-express'))?.applePay ?? false, { timeout: 15_000 })
        .toBe(true)
        .catch(() => undefined);
    const wallets = await availableWallets(page, '#slot-express');
    test.skip(!wallets?.applePay, 'sandbox session does not offer Apple Pay');
}

/** Click the hosted Apple Pay button (a custom element; dispatch click to bypass sizing). */
async function clickApplePay(page: Page): Promise<void> {
    const button = page.frameLocator('#slot-express iframe').locator('apple-pay-button').first();
    await button.dispatchEvent('click');
}

function opEvents(events: HarnessEvent[], name: string): OperationPayload[] {
    return events.filter((e) => e.name === name).map((e) => e.payload as OperationPayload);
}

async function assertNoToken(page: Page): Promise<void> {
    const [events, messages] = await Promise.all([getEvents(page), getParentMessages(page)]);
    expect(JSON.stringify({ events, messages }), 'wallet token must never reach the merchant page').not.toContain(
        STUB_TOKEN
    );
}

test.afterEach(async ({ page }) => {
    await callHarness(page, 'reset').catch(() => undefined);
});

test('C8-01 merchant validation failure -> error + failed paymentResult @p1 @c8', async ({ page, context }) => {
    test.setTimeout(90_000);
    await startExpress(page, context, 'validationFail');
    await clickApplePay(page);

    await expect
        .poll(async () => opEvents(await getEvents(page), 'paymentResult').length, { timeout: 30_000 })
        .toBeGreaterThan(0);

    const events = await getEvents(page);
    const errors = opEvents(events, 'error');
    const results = opEvents(events, 'paymentResult');
    const err = errors.find((e) => e.method === 'applePay' && e.stage === 'merchantValidation');
    expect(err, `error event with method=applePay stage=merchantValidation: ${JSON.stringify(errors)}`).toBeTruthy();
    // Decision: this scenario is backend-rejection-driven (bogus validationURL rejected by
    // the sandbox merchant-validation API, which responds with { code, traceId }), so
    // backendCode and traceId MUST be present. Asserted strictly; if the backend stops
    // supplying them that is a regression to investigate, not a silent pass.
    expect(typeof err!.error?.backendCode, 'backendCode must be a string').toBe('string');
    expect(err!.error?.backendCode, 'backendCode must be non-empty').not.toBe('');
    expect(typeof err!.error?.traceId, 'traceId must be a string').toBe('string');
    expect(err!.error?.traceId, 'traceId must be non-empty').not.toBe('');

    const failed = results.find((r) => r.outcome?.status === 'failed');
    expect(failed, `failed paymentResult: ${JSON.stringify(results)}`).toBeTruthy();
    expect(failed!.operationId).toBeTruthy();
    expect(failed!.operationId).toBe(err!.operationId);

    await assertNoToken(page);
});

test('C8-02 user cancel -> canceled paymentResult and no error @p1 @c8', async ({ page, context }) => {
    test.setTimeout(90_000);
    await startExpress(page, context, 'cancel');
    await clickApplePay(page);

    await expect
        .poll(async () => opEvents(await getEvents(page), 'paymentResult').length, { timeout: 30_000 })
        .toBeGreaterThan(0);

    const events = await getEvents(page);
    const results = opEvents(events, 'paymentResult');
    expect(results.some((r) => r.outcome?.status === 'canceled'), JSON.stringify(results)).toBe(true);
    expect(opEvents(events, 'error'), 'cancel must not emit an error event').toHaveLength(0);

    await assertNoToken(page);
});

test('C8-03 authorization failure -> authorization error + failed paymentResult, no token leak (PCI) @p1 @c8', async ({
    page,
    context,
}) => {
    test.setTimeout(90_000);
    await startExpress(page, context, 'authorizeFail');
    await clickApplePay(page);

    await expect
        .poll(async () => opEvents(await getEvents(page), 'paymentResult').length, { timeout: 45_000 })
        .toBeGreaterThan(0);

    const events = await getEvents(page);
    const errors = opEvents(events, 'error');
    const results = opEvents(events, 'paymentResult');
    const err = errors.find((e) => e.method === 'applePay' && e.stage === 'authorization');
    expect(err, `error event with method=applePay stage=authorization: ${JSON.stringify(errors)}`).toBeTruthy();
    const failed = results.find((r) => r.outcome?.status === 'failed');
    expect(failed, `failed paymentResult: ${JSON.stringify(results)}`).toBeTruthy();
    expect(failed!.operationId).toBeTruthy();
    expect(failed!.operationId).toBe(err!.operationId);

    await assertNoToken(page);
});
