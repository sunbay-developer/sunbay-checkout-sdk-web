/**
 * Example 1 — Full checkout (express + combined card + billing address).
 *
 * Demonstrates a complete single-page flow:
 *   create session → createCheckout → create('expressCheckout') +
 *   create('card') + create('address', { mode:'billing' }) → mount each →
 *   instance.confirm → read the PaymentOutcome.
 *
 * All SDK event payloads are surfaced in the on-page log. Card values live only
 * inside the hosted iframes (PCI isolation); this page never sees them.
 */

/* global window, document */

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
    clearBtn: document.getElementById('clearBtn'),
    destroy: document.getElementById('destroy'),
    status: document.getElementById('status'),
    summary: document.getElementById('summary'),
    expressNote: document.getElementById('express-note'),
    log: document.getElementById('log'),
};
const log = createLogger(els.log);
initLogDock();

const health = await fetchHealth();
renderHealthBanner(health, document.getElementById('health'));

/** @type {import('@sunbay/checkout-sdk-js').CheckoutInstance | null} */
let checkout = null;
/** @type {import('@sunbay/checkout-sdk-js').CheckoutElement | null} */
let cardElement = null;

function setStatus(text, kind) {
    els.status.textContent = text;
    els.status.className = `status ${kind ?? ''}`.trim();
}

els.init.addEventListener('click', async () => {
    els.init.disabled = true;
    setStatus('Creating session…');
    try {
        // 1) The merchant backend creates a session with the sandbox key.
        const sessionId = await createSession({ collectBillingAddress: true });
        log('session created', { sessionId });

        // 2) Boot the SDK against the hosted runtime.
        const createCheckout = getCreateCheckout();
        setStatus('Handshaking with hosted runtime…');
        checkout = await createCheckout({
            sessionId,
            hostOrigin: health.hostedOrigin,
        });
        log('checkout ready', { checkoutId: checkout.checkoutId, capabilities: checkout.capabilities });

        // Show the amount from the public session view.
        const session = await checkout.getSession();
        els.summary.textContent = `Amount due: ${formatAmount(session)} · ${session.description ?? ''}`;

        // 3) Instance-level events.
        checkout.on('paymentStateChange', (p) => log('paymentStateChange', p));
        checkout.on('error', (p) => log('instance error', p));

        // 4a) Express checkout wallet row (Apple Pay / Google Pay). Only the
        //     wallets available in the current environment render; the SDK emits
        //     expressAvailabilityChange and exposes getAvailableWallets().
        const express = checkout.create('expressCheckout', {
            buttonHeight: 44,
            layout: { maxColumns: 2 },
        });
        express.on('expressAvailabilityChange', (p) => {
            log('express availability', p);
            renderExpressNote(express.getAvailableWallets());
        });
        express.on('loadError', (p) => log('express loadError', p));
        setStatus('Mounting express…');
        await express.mount('#slot-express');
        renderExpressNote(express.getAvailableWallets());

        // 4b) Combined card Element.
        cardElement = checkout.create('card', { showPostalCode: true });
        cardElement.on('change', (p) => log('card change', p));
        cardElement.on('ready', () => log('card ready'));
        cardElement.on('loadError', (p) => log('card loadError', p));
        setStatus('Mounting card Element…');
        await cardElement.mount('#slot-card');

        // 4c) Billing address Element.
        const billing = checkout.create('address', { mode: 'billing' });
        billing.on('ready', () => log('billing address ready'));
        billing.on('loadError', (p) => log('billing address loadError', p));
        setStatus('Mounting billing address…');
        await billing.mount('#slot-bill');

        setStatus('Ready to pay', 'ok');
        els.pay.disabled = false;
        els.clearBtn.disabled = false;
        els.destroy.disabled = false;
    } catch (err) {
        log('init failed', err);
        setStatus(err?.message || 'Initialization failed', 'err');
        els.init.disabled = false;
    }
});

/** Describe which wallets are currently available (environment-dependent). */
function renderExpressNote(wallets) {
    if (!wallets) {
        els.expressNote.textContent = 'Express wallets: availability pending…';
        return;
    }
    const available = Object.entries(wallets)
        .filter(([, v]) => v)
        .map(([k]) => k);
    els.expressNote.textContent = available.length
        ? `Available wallets: ${available.join(', ')}`
        : 'No express wallets available in this environment (needs Apple/Google Pay setup).';
}

els.pay.addEventListener('click', async () => {
    if (!checkout) return;
    els.pay.disabled = true;
    setStatus('Confirming payment…');
    try {
        const outcome = await checkout.confirm();
        log('payment outcome', outcome);
        if (outcome.status === 'succeeded') {
            setStatus(`Succeeded (txn ${outcome.txnId})`, 'ok');
        } else if (outcome.status === 'failed') {
            setStatus(`Failed: ${outcome.error?.message ?? ''}`, 'err');
            els.pay.disabled = false;
        } else {
            setStatus(`Outcome: ${outcome.status}`);
            els.pay.disabled = false;
        }
    } catch (err) {
        log('confirm rejected', err);
        setStatus(err?.message || 'Confirm failed', 'err');
        els.pay.disabled = false;
    }
});

els.clearBtn.addEventListener('click', async () => {
    if (cardElement?.clear) {
        await cardElement.clear();
        log('card cleared');
    }
});

els.destroy.addEventListener('click', () => {
    if (checkout) {
        checkout.destroy();
        log('instance destroyed');
        checkout = null;
        cardElement = null;
        setStatus('Destroyed');
        els.pay.disabled = true;
        els.clearBtn.disabled = true;
        els.destroy.disabled = true;
        els.init.disabled = false;
        for (const id of ['slot-express', 'slot-card', 'slot-bill']) {
            document.getElementById(id).innerHTML = '';
        }
        els.expressNote.textContent = '';
    }
});
