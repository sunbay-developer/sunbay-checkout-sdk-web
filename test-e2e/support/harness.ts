/**
 * Playwright-side driver for the test harness.
 *
 * Wraps window.__sunbayHarness calls, event/message retrieval, cross-frame style
 * sampling, the PCI card-leak scan, and direct (SDK-bypassing) card entry into
 * hosted field iframes.
 */

import { type Page, type FrameLocator, expect } from '@playwright/test';
import { HARNESS_URL, HOSTED_ORIGIN } from './env';
import { SANDBOX_CARD_DEFAULT, type SandboxCard } from '../fixtures/test-cards';

/** Declarative config mirrors HarnessConfig in harness-design.md. */
export interface ElementSpec {
    type: string;
    slot: string;
    options?: Record<string, unknown>;
    mount?: boolean;
    expectConflict?: boolean;
}
export interface HarnessConfig {
    session: 'auto' | string;
    instanceKey?: string;
    env?: 'dev' | 'test' | 'prod';
    hostOrigin?: string;
    locale?: string;
    appearance?: Record<string, unknown>;
    paymentMethods?: Record<string, unknown>;
    collectBillingAddress?: boolean;
    collectShippingAddress?: boolean;
    elements?: ElementSpec[];
}
export interface SetupResult {
    ok: boolean;
    error?: { code: string; message: string };
    checkoutId?: string;
    creationErrors?: Record<string, { code: string }>;
    mountStatus?: Record<string, 'ready' | 'loadError' | 'skipped'>;
}
export interface HarnessEvent {
    t: number;
    source: string;
    name: string;
    payload: unknown;
}
export interface ParentMessage {
    t: number;
    origin: string;
    sameSourceAsIframe: boolean;
    data: unknown;
}

/**
 * Navigate to the harness page, inject the hosted origin override, and wait until
 * the SDK + harness are ready.
 */
export async function openHarness(page: Page, hostedOrigin: string = HOSTED_ORIGIN): Promise<void> {
    await page.addInitScript((origin) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).E2E_HOSTED_ORIGIN = origin;
    }, hostedOrigin);
    await page.goto(HARNESS_URL);
    await page.waitForFunction(() => (window as unknown as { __sunbayHarnessReady?: boolean }).__sunbayHarnessReady === true, {
        timeout: 15_000,
    });
}

/** Call __sunbayHarness.setup(config). */
export async function setup(page: Page, config: HarnessConfig): Promise<SetupResult> {
    return page.evaluate(
        (cfg) => (window as unknown as { __sunbayHarness: { setup: (c: unknown) => Promise<SetupResult> } }).__sunbayHarness.setup(cfg),
        config
    ) as Promise<SetupResult>;
}

/** Generic hook invoker for methods that return JSON-serializable values. */
export async function callHarness<T = unknown>(
    page: Page,
    method: string,
    ...args: unknown[]
): Promise<T> {
    return page.evaluate(
        ({ m, a }) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const h = (window as any).__sunbayHarness;
            return h[m](...a);
        },
        { m: method, a: args }
    ) as Promise<T>;
}

export async function getEvents(page: Page): Promise<HarnessEvent[]> {
    return page.evaluate(() => (window as unknown as { __sunbayHarness: { events: HarnessEvent[] } }).__sunbayHarness.events);
}

export async function getParentMessages(page: Page): Promise<ParentMessage[]> {
    return page.evaluate(() => (window as unknown as { __sunbayHarness: { parentMessages: ParentMessage[] } }).__sunbayHarness.parentMessages);
}

/** Read an element handle status via the harness (getStatus). */
export async function elementStatus(page: Page, slot: string): Promise<string | null> {
    return page.evaluate((s) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const el = (window as any).__sunbayHarness.elements[s];
        return el ? el.getStatus() : null;
    }, slot);
}

/** Read getAvailableWallets for an express element. */
export async function availableWallets(
    page: Page,
    slot: string
): Promise<{ applePay: boolean; googlePay: boolean } | undefined> {
    return page.evaluate((s) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const el = (window as any).__sunbayHarness.elements[s];
        return el ? el.getAvailableWallets() : undefined;
    }, slot);
}

/** Read the iframe src inside a slot (outer attribute; parent can read it). */
export async function slotIframeSrc(page: Page, slot: string): Promise<string | null> {
    const iframe = page.locator(`${slot} iframe`);
    const count = await iframe.count();
    if (count === 0) return null;
    return iframe.first().getAttribute('src');
}

/** Count iframes inside a slot. */
export async function slotIframeCount(page: Page, slot: string): Promise<number> {
    return page.locator(`${slot} iframe`).count();
}

/** FrameLocator into the hosted iframe mounted in a slot (for in-frame assertions). */
export function slotFrame(page: Page, slot: string): FrameLocator {
    return page.frameLocator(`${slot} iframe`);
}

/**
 * PCI invariant scan: assert that neither parentMessages nor events contain any
 * card number / CVV. Serializes both and searches for the forbidden substrings.
 */
export async function assertNoCardLeak(page: Page, card: SandboxCard = SANDBOX_CARD_DEFAULT): Promise<void> {
    const [events, messages] = await Promise.all([getEvents(page), getParentMessages(page)]);
    const haystack = JSON.stringify({ events, messages });
    expect(haystack, 'card number must never appear in parent messages/events').not.toContain(
        card.cardNumber
    );
    // Also check contiguous 8+ digit substrings of the PAN to catch partial leaks.
    for (let i = 0; i + 8 <= card.cardNumber.length; i++) {
        const chunk = card.cardNumber.slice(i, i + 8);
        expect(haystack, `PAN chunk ${chunk} must not leak`).not.toContain(chunk);
    }
}

/**
 * Enter a sandbox card DIRECTLY into the hosted split-field iframes, bypassing the
 * SDK entirely (PCI). Each field iframe hosts a single <input>.
 *
 * slots: { number, expiry, cvc } → slot selectors containing the hosted field iframes.
 * The expiry field expects MM/YY-style typing; we type month then year digits.
 */
export async function fillCardAcrossIframes(
    page: Page,
    slots: { number: string; expiry: string; cvc: string },
    card: SandboxCard = SANDBOX_CARD_DEFAULT
): Promise<void> {
    const numberInput = slotFrame(page, slots.number).locator('input');
    await numberInput.click();
    await numberInput.fill(card.cardNumber);

    const expiryInput = slotFrame(page, slots.expiry).locator('input');
    await expiryInput.click();
    // Expiry input formats MMYY → MM/YY; type raw digits.
    await expiryInput.fill(`${card.expiryMonth}${card.expiryYear.slice(2)}`);

    const cvcInput = slotFrame(page, slots.cvc).locator('input');
    await cvcInput.click();
    await cvcInput.fill(card.cvv);
}

/** Type a raw value into a single hosted field iframe's input (e.g. invalid number). */
export async function typeIntoField(page: Page, slot: string, value: string): Promise<void> {
    const input = slotFrame(page, slot).locator('input');
    await input.click();
    await input.fill(value);
}
