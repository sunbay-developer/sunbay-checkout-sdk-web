/**
 * Example 2 — Split card fields + billing/shipping address.
 *
 * Demonstrates composing the checkout from individual Elements instead of a
 * single combined card:
 *   - cardNumber / cardExpiry / cardCvc mounted into separate slots;
 *   - an address Element in `billing` mode and another in `shipping` mode
 *     (the shipping one needs a session with collectShippingAddress:true).
 *
 * The CheckoutInstance enforces mutual exclusion (combined card vs split fields,
 * one address per mode); this example stays within those rules.
 */

/* global document */

import {
    fetchHealth,
    renderHealthBanner,
    getCreateCheckout,
    createSession,
    createLogger,
    initLogDock,
    formatAmount,
} from '/app.js';

const els = {
    init: document.getElementById('init'),
    pay: document.getElementById('pay'),
    focusNum: document.getElementById('focusNum'),
    destroy: document.getElementById('destroy'),
    status: document.getElementById('status'),
    summary: document.getElementById('summary'),
    shipNote: document.getElementById('ship-note'),
    log: document.getElementById('log'),
};
const log = createLogger(els.log);
initLogDock();

const health = await fetchHealth();
renderHealthBanner(health, document.getElementById('health'));

let checkout = null;
let numberElement = null;

function setStatus(text, kind) {
    els.status.textContent = text;
    els.status.className = `status ${kind ?? ''}`.trim();
}

/** Mount a single element, logging ready/loadError and tolerating failure. */
async function mountElement(type, slot, options) {
    const element = checkout.create(type, options);
    element.on('ready', () => log(`${type} ready`));
    element.on('loadError', (p) => log(`${type} loadError`, p));
    await element.mount(slot);
    return element;
}

els.init.addEventListener('click', async () => {
    els.init.disabled = true;
    setStatus('Creating session…');
    try {
        // Request both billing and shipping collection so both address Elements
        // have a corresponding session field.
        const { sessionId, checkoutClientSecret } = await createSession({
            collectBillingAddress: true,
            collectShippingAddress: true,
        });
        log('session created', { sessionId });

        const createCheckout = getCreateCheckout();
        setStatus('Handshaking…');
        checkout = await createCheckout({
            sessionId,
            checkoutClientSecret,
            hostOrigin: health.hostedOrigin,
        });
        log('checkout ready', { checkoutId: checkout.checkoutId });

        const session = await checkout.getSession();
        els.summary.textContent = `Amount due: ${formatAmount(session)}`;
        checkout.on('paymentStateChange', (p) => log('paymentStateChange', p));
        checkout.on('error', (p) => log('instance error', p));

        // Split card fields — each into its own slot.
        setStatus('Mounting split fields…');
        numberElement = await mountElement('cardNumber', '#slot-num');
        await mountElement('cardExpiry', '#slot-exp');
        await mountElement('cardCvc', '#slot-cvc');

        // Billing address (always available with collectBillingAddress:true).
        await mountElement('address', '#slot-bill', { mode: 'billing' });

        // Shipping address — only meaningful when the session collects it.
        if (session.collectShippingAddress) {
            await mountElement('address', '#slot-ship', { mode: 'shipping' });
        } else {
            els.shipNote.textContent =
                'Session was not created with collectShippingAddress — shipping address skipped.';
        }

        setStatus('Ready to pay', 'ok');
        els.pay.disabled = false;
        els.focusNum.disabled = false;
        els.destroy.disabled = false;
    } catch (err) {
        log('init failed', err);
        setStatus(err?.message || 'Initialization failed', 'err');
        els.init.disabled = false;
    }
});

els.pay.addEventListener('click', async () => {
    if (!checkout) return;
    els.pay.disabled = true;
    setStatus('Confirming payment…');

    // Merchant-owned custom fields (NOT part of the SDK) — the merchant collects
    // these from its own DOM and would submit them via its own backend.
    const deliveryNote = document.getElementById('delivery-note')?.value ?? '';
    const giftWrap = document.getElementById('gift-wrap')?.checked ?? false;
    log('merchant custom fields', { deliveryNote, giftWrap });

    try {
        const outcome = await checkout.confirm();
        log('payment outcome', outcome);
        if (outcome.status === 'succeeded') {
            setStatus(`Succeeded (txn ${outcome.txnId})`, 'ok');
        } else {
            setStatus(`Outcome: ${outcome.status}`, outcome.status === 'failed' ? 'err' : '');
            els.pay.disabled = false;
        }
    } catch (err) {
        log('confirm rejected', err);
        setStatus(err?.message || 'Confirm failed', 'err');
        els.pay.disabled = false;
    }
});

els.focusNum.addEventListener('click', async () => {
    if (numberElement?.focus) {
        await numberElement.focus();
        log('focused cardNumber');
    }
});

els.destroy.addEventListener('click', () => {
    if (checkout) {
        checkout.destroy();
        log('instance destroyed');
        checkout = null;
        numberElement = null;
        setStatus('Destroyed');
        for (const id of ['slot-num', 'slot-exp', 'slot-cvc', 'slot-bill', 'slot-ship']) {
            document.getElementById(id).innerHTML = '';
        }
        els.pay.disabled = true;
        els.focusNum.disabled = true;
        els.destroy.disabled = true;
        els.init.disabled = false;
    }
});
