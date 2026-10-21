/**
 * Example 3 — Theming & customization (three layers).
 *
 *   A. Global theme (init-time): appearance.variables + colorScheme passed to
 *      createCheckout(); applied on the first paint via the iframe src.
 *   B. Element-level rules & per-element isolation: appearance.rules set both
 *      instance-wide and per Element (each split field gets its own input color).
 *   C. Runtime hot-reload: instance.updateCheckout({ appearance, locale }) to
 *      restyle mounted Elements live (no remount).
 *
 * Only the 7 whitelisted variables and the controlled semantic rule targets take
 * effect; the hosted side validates every value (PCI-safe, no arbitrary CSS).
 */

/* global document */

import {
    fetchHealth,
    renderHealthBanner,
    getCreateCheckout,
    createSession,
    createLogger,
    initLogDock,
} from '/app.js';

const log = createLogger(document.getElementById('log'));
initLogDock();
const health = await fetchHealth();
renderHealthBanner(health, document.getElementById('health'));

const createCheckout = (() => {
    try {
        return getCreateCheckout();
    } catch (err) {
        log('SDK unavailable', err);
        return null;
    }
})();

/** Init-time global-theme presets (7 whitelisted variables + colorScheme). */
const PRESETS = {
    violet: {
        colorScheme: 'light',
        variables: {
            colorPrimary: '#7c3aed',
            colorBackground: '#ffffff',
            colorText: '#1f2430',
            colorBorder: '#d8d8f0',
            colorDanger: '#ef4444',
            borderRadius: '12px',
            fontFamily: 'Georgia, serif',
        },
    },
    midnight: {
        colorScheme: 'dark',
        variables: {
            colorPrimary: '#38bdf8',
            colorBackground: '#0b1020',
            colorText: '#e5e7eb',
            colorBorder: '#334155',
            colorDanger: '#f87171',
            borderRadius: '8px',
            fontFamily: 'system-ui, sans-serif',
        },
    },
    forest: {
        colorScheme: 'light',
        variables: {
            colorPrimary: '#16a34a',
            colorBackground: '#f8fff8',
            colorText: '#0f2417',
            colorBorder: '#bbe3c4',
            colorDanger: '#dc2626',
            borderRadius: '4px',
            fontFamily: 'system-ui, sans-serif',
        },
    },
};

function status(id, text, kind) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = `status ${kind ?? ''}`.trim();
}

/** Shared bootstrap: create a session + instance pointed at the hosted runtime. */
async function boot(appearance) {
    if (!createCheckout) throw new Error('SDK not loaded');
    const sessionId = await createSession({ collectBillingAddress: true });
    const instance = await createCheckout({
        sessionId,
        hostOrigin: health.hostedOrigin,
        appearance,
    });
    return instance;
}

/* ----------------------------- A · Global theme ----------------------------- */

let globalInstance = null;
document.getElementById('initGlobal').addEventListener('click', async () => {
    const btn = document.getElementById('initGlobal');
    btn.disabled = true;
    try {
        if (globalInstance) {
            globalInstance.destroy();
            document.getElementById('slot-global').innerHTML = '';
        }
        const preset = PRESETS[document.getElementById('preset').value];
        status('statusA', 'Creating with theme…');
        log('A · global appearance', preset);
        globalInstance = await boot(preset);
        const card = globalInstance.create('card', { showPostalCode: true });
        await card.mount('#slot-global');
        status('statusA', 'Mounted', 'ok');
    } catch (err) {
        log('A failed', err);
        status('statusA', err?.message || 'failed', 'err');
    } finally {
        btn.disabled = false;
    }
});

/* ---------------- B · Element rules, express buttons & locale --------------- */

let rulesInstance = null;
const localeButtons = ['localeEn', 'localeZh'];

/** Enable/disable the locale switch buttons for section B. */
function setLocaleButtons(enabled) {
    for (const id of localeButtons) document.getElementById(id).disabled = !enabled;
}

/** Describe the express wallets available in section B. */
function renderExpressNoteB(wallets) {
    const el = document.getElementById('express-note');
    if (!wallets) {
        el.textContent = 'Express wallets: availability pending…';
        return;
    }
    const available = Object.entries(wallets)
        .filter(([, v]) => v)
        .map(([k]) => k);
    el.textContent = available.length
        ? `Available wallets: ${available.join(', ')}`
        : 'No express wallets available in this environment (needs Apple/Google Pay setup).';
}

document.getElementById('initRules').addEventListener('click', async () => {
    const btn = document.getElementById('initRules');
    btn.disabled = true;
    try {
        if (rulesInstance) {
            rulesInstance.destroy();
            for (const id of ['slot-num', 'slot-cvc', 'slot-express']) {
                document.getElementById(id).innerHTML = '';
            }
        }
        status('statusB', 'Creating…');
        // Instance-wide rules: bolder, larger inputs + italic error text.
        rulesInstance = await boot({
            rules: {
                input: { 'font-size': '16px', padding: '12px' },
                'input:focus': { 'outline-color': '#2563eb' },
                error: { 'font-style': 'italic' },
            },
        });
        // Per-element appearance overrides the input color independently.
        const num = rulesInstance.create('cardNumber', {
            appearance: { rules: { input: { color: '#dc2626' } } },
        });
        const cvc = rulesInstance.create('cardCvc', {
            appearance: { rules: { input: { color: '#2563eb' } } },
        });
        await num.mount('#slot-num');
        await cvc.mount('#slot-cvc');
        log('B · instance rules + per-element colors (red / blue)');

        // Express button customization: per-wallet buttonType/buttonTheme + global height.
        const express = rulesInstance.create('expressCheckout', {
            paymentMethods: {
                applePay: { buttonType: 'buy', buttonTheme: 'black' },
                googlePay: { buttonType: 'pay', buttonTheme: 'white' },
            },
            buttonHeight: 48,
            layout: { maxColumns: 2 },
        });
        express.on('expressAvailabilityChange', () =>
            renderExpressNoteB(express.getAvailableWallets())
        );
        express.on('loadError', (p) => log('B express loadError', p));
        await express.mount('#slot-express');
        renderExpressNoteB(express.getAvailableWallets());
        log('B · express buttons (applePay=buy/black, googlePay=pay/white, h48)');

        status('statusB', 'Mounted', 'ok');
        setLocaleButtons(true);
        document.getElementById('localeCur').textContent = '(current: en)';
    } catch (err) {
        log('B failed', err);
        status('statusB', err?.message || 'failed', 'err');
    } finally {
        btn.disabled = false;
    }
});

/** Switch the locale of every mounted Element in section B at runtime. */
async function switchLocale(locale) {
    if (!rulesInstance) return;
    try {
        await rulesInstance.updateCheckout({ locale });
        document.getElementById('localeCur').textContent = `(current: ${locale})`;
        log('B · updateCheckout locale', { locale });
    } catch (err) {
        log('B · locale switch failed', err);
    }
}

document.getElementById('localeEn').addEventListener('click', () => switchLocale('en'));
document.getElementById('localeZh').addEventListener('click', () => switchLocale('zh'));

/* ------------------------- C · Runtime hot-reload --------------------------- */

let hotInstance = null;
const hotButtons = ['toLight', 'toDark', 'varA', 'varB', 'locale'];

function setHotButtons(enabled) {
    for (const id of hotButtons) document.getElementById(id).disabled = !enabled;
}

document.getElementById('initHot').addEventListener('click', async () => {
    const btn = document.getElementById('initHot');
    btn.disabled = true;
    try {
        if (hotInstance) {
            hotInstance.destroy();
            document.getElementById('slot-hot').innerHTML = '';
        }
        status('statusC', 'Creating…');
        // Start from a plain light theme so the runtime changes are visible.
        hotInstance = await boot({ colorScheme: 'light' });
        const card = hotInstance.create('card', { showPostalCode: true });
        await card.mount('#slot-hot');
        status('statusC', 'Mounted — try the buttons', 'ok');
        setHotButtons(true);
    } catch (err) {
        log('C failed', err);
        status('statusC', err?.message || 'failed', 'err');
    } finally {
        btn.disabled = false;
    }
});

/** Apply an updateCheckout patch and log it. */
async function hotUpdate(patch) {
    if (!hotInstance) return;
    try {
        await hotInstance.updateCheckout(patch);
        log('C · updateCheckout', patch);
    } catch (err) {
        log('C · updateCheckout failed', err);
    }
}

document.getElementById('toLight').addEventListener('click', () =>
    hotUpdate({ appearance: { colorScheme: 'light' } })
);
document.getElementById('toDark').addEventListener('click', () =>
    hotUpdate({ appearance: { colorScheme: 'dark' } })
);
document.getElementById('varA').addEventListener('click', () =>
    hotUpdate({ appearance: { variables: { colorPrimary: '#16a34a', borderRadius: '2px' } } })
);
document.getElementById('varB').addEventListener('click', () =>
    hotUpdate({ appearance: { variables: { colorPrimary: '#f97316', borderRadius: '16px' } } })
);
document.getElementById('locale').addEventListener('click', () => hotUpdate({ locale: 'zh' }));

/* -------- D · Fine-grained single-element & express button customization ---- */

/** Shared instance for section D (both sub-demos mount into it). */
let detailInstance = null;
/** Currently mounted single-field / express handles (destroyed before re-mount). */
let detailField = null;
let detailExpress = null;

/** Lazily create the section-D instance (plain light theme so rules read clean). */
async function ensureDetailInstance() {
    if (detailInstance) return detailInstance;
    detailInstance = await boot({ colorScheme: 'light' });
    return detailInstance;
}

/** Read the single-field controls into an appearance.rules object. */
function readFieldRules() {
    return {
        rules: {
            input: {
                color: document.getElementById('d-color').value.trim(),
                'font-size': document.getElementById('d-fontsize').value,
            },
            'input:focus': {
                'outline-color': document.getElementById('d-focus').value.trim(),
            },
            'input:invalid': {
                color: document.getElementById('d-invalid').value.trim(),
            },
            label: {
                'font-weight': document.getElementById('d-labelweight').value,
            },
            cardBrand: {
                opacity: document.getElementById('d-brand').value,
            },
        },
    };
}

document.getElementById('applyField').addEventListener('click', async () => {
    const btn = document.getElementById('applyField');
    btn.disabled = true;
    try {
        status('statusD1', 'Applying…');
        await ensureDetailInstance();
        // Re-mount with the latest per-element rules. Destroy the old handle first
        // so the mutually-exclusive cardNumber slot frees up.
        if (detailField) {
            detailField.destroy();
            document.getElementById('slot-d-field').innerHTML = '';
        }
        const appearance = readFieldRules();
        detailField = detailInstance.create('cardNumber', { appearance });
        await detailField.mount('#slot-d-field');
        log('D · cardNumber rules applied', appearance.rules);
        status('statusD1', 'Mounted', 'ok');
        document.getElementById('hotField').disabled = false;
    } catch (err) {
        log('D · field failed', err);
        status('statusD1', err?.message || 'failed', 'err');
    } finally {
        btn.disabled = false;
    }
});

/**
 * Hot-update the single field's styles WITHOUT remount. Uses the instance-level
 * updateCheckout({ appearance: { rules } }), which the hosted runtime applies to
 * all mounted Elements live (same path section C uses for colorScheme/variables).
 * No new iframe, no flash — contrast with "Apply & mount" which recreates it.
 */
document.getElementById('hotField').addEventListener('click', async () => {
    if (!detailInstance || !detailField) return;
    const btn = document.getElementById('hotField');
    btn.disabled = true;
    try {
        status('statusD1', 'Hot-updating…');
        const appearance = readFieldRules();
        await detailInstance.updateCheckout({ appearance });
        log('D · cardNumber rules hot-updated (no remount)', appearance.rules);
        status('statusD1', 'Hot-updated', 'ok');
    } catch (err) {
        log('D · field hot-update failed', err);
        status('statusD1', err?.message || 'hot-update failed', 'err');
    } finally {
        btn.disabled = false;
    }
});

/** Read the express controls into ExpressCheckoutElementOptions. */
function readExpressOptions() {
    return {
        paymentMethods: {
            applePay: {
                buttonType: document.getElementById('d-ap-type').value,
                buttonTheme: document.getElementById('d-ap-theme').value,
            },
            googlePay: {
                buttonType: document.getElementById('d-gp-type').value,
                buttonTheme: document.getElementById('d-gp-theme').value,
            },
        },
        buttonHeight: Number(document.getElementById('d-height').value),
        layout: { maxColumns: Number(document.getElementById('d-cols').value) },
    };
}

/** Live-update the height readout next to the slider. */
document.getElementById('d-height').addEventListener('input', (e) => {
    document.getElementById('d-height-val').textContent = e.target.value;
});

/** Describe the express wallets available in section D. */
function renderExpressNoteD(wallets) {
    const el = document.getElementById('d-express-note');
    if (!wallets) {
        el.textContent = 'Express wallets: availability pending…';
        return;
    }
    const available = Object.entries(wallets)
        .filter(([, v]) => v)
        .map(([k]) => k);
    el.textContent = available.length
        ? `Available wallets: ${available.join(', ')} (unavailable wallets render nothing regardless of options)`
        : 'No express wallets available in this environment (needs Apple/Google Pay setup).';
}

document.getElementById('applyExpress').addEventListener('click', async () => {
    const btn = document.getElementById('applyExpress');
    btn.disabled = true;
    try {
        status('statusD2', 'Applying…');
        await ensureDetailInstance();
        // expressCheckout is a singleton; destroy the old one before re-creating
        // so the new buttonType/theme/height take effect on a fresh iframe.
        if (detailExpress) {
            detailExpress.destroy();
            document.getElementById('slot-d-express').innerHTML = '';
        }
        const options = readExpressOptions();
        detailExpress = detailInstance.create('expressCheckout', options);
        detailExpress.on('expressAvailabilityChange', () =>
            renderExpressNoteD(detailExpress.getAvailableWallets())
        );
        detailExpress.on('loadError', (p) => log('D express loadError', p));
        await detailExpress.mount('#slot-d-express');
        renderExpressNoteD(detailExpress.getAvailableWallets());
        log('D · express options applied', options);
        status('statusD2', 'Mounted', 'ok');
        document.getElementById('hotExpress').disabled = false;
    } catch (err) {
        log('D · express failed', err);
        status('statusD2', err?.message || 'failed', 'err');
    } finally {
        btn.disabled = false;
    }
});

/**
 * Update the express button with the latest options. The express button's
 * buttonType/buttonTheme/buttonHeight are Element options baked into the iframe
 * src at creation, so changing them needs a fresh iframe: we try element.update()
 * first (works for options the hosted side can patch live) and, since express
 * button type/height require recreation, fall back to a full remount — logging
 * which path was taken so the limitation is explicit.
 */
document.getElementById('hotExpress').addEventListener('click', async () => {
    if (!detailInstance || !detailExpress) return;
    const btn = document.getElementById('hotExpress');
    btn.disabled = true;
    try {
        status('statusD2', 'Updating…');
        const options = readExpressOptions();
        let hotOk = false;
        try {
            await detailExpress.update(options);
            hotOk = true;
            log('D · express hot-updated via element.update()', options);
        } catch (updErr) {
            log('D · express update() not supported, rebuilding iframe', updErr);
        }
        if (!hotOk) {
            // Fall back to recreate (express is a singleton: destroy then recreate).
            detailExpress.destroy();
            document.getElementById('slot-d-express').innerHTML = '';
            detailExpress = detailInstance.create('expressCheckout', options);
            detailExpress.on('expressAvailabilityChange', () =>
                renderExpressNoteD(detailExpress.getAvailableWallets())
            );
            detailExpress.on('loadError', (p) => log('D express loadError', p));
            await detailExpress.mount('#slot-d-express');
            log('D · express rebuilt with new options', options);
        }
        renderExpressNoteD(detailExpress.getAvailableWallets());
        status('statusD2', hotOk ? 'Hot-updated' : 'Rebuilt', 'ok');
    } catch (err) {
        log('D · express update failed', err);
        status('statusD2', err?.message || 'update failed', 'err');
    } finally {
        btn.disabled = false;
    }
});
