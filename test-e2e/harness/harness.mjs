/**
 * Test harness driver — defines `window.__sunbayHarness`.
 *
 * Simulates a merchant page that drives the real SDK (window.SunbayCheckout, loaded
 * from the IIFE build) declaratively. Test cases call setup(config) + assertions;
 * all SDK call details live here so Playwright specs stay declarative.
 *
 * Contract: see ../harness-design.md §2. Security: this harness NEVER touches card
 * values; card entry is done directly into hosted field iframes by the test layer.
 */

/* global window, document */

const DEFAULT_KEY = '__default__';
const HOSTED_ORIGIN_META = 'E2E_HOSTED_ORIGIN';

/** Resolve the hosted runtime origin: config override → injected global → default. */
function resolveHostOrigin(configHostOrigin) {
    if (configHostOrigin) return configHostOrigin;
    if (window[HOSTED_ORIGIN_META]) return window[HOSTED_ORIGIN_META];
    return 'http://localhost:3000';
}

/** Instance-level events we subscribe to. */
const INSTANCE_EVENTS = ['paymentResult', 'paymentStateChange', 'error'];
/** Element-level events we subscribe to (filtered per element by the SDK). */
const ELEMENT_EVENTS = [
    'elementReady',
    'loadError',
    'ready',
    'change',
    'focus',
    'blur',
    'expressAvailabilityChange',
];

class Harness {
    constructor() {
        this.instance = null;
        this.instances = {};
        this.elements = {};
        this.events = [];
        this.parentMessages = [];
        // slot → operationId map is not needed; confirm records operationId directly.
        this._instanceHandlers = new Map(); // instanceKey → [{event,handler}]
        this._installParentSniffer();
    }

    /** Record every message the parent window receives (PCI + resize assertions). */
    _installParentSniffer() {
        this._sniffer = (event) => {
            let sameSource = false;
            try {
                for (const slot of Object.keys(this.elements)) {
                    const iframe = document.querySelector(`${slot} iframe`);
                    if (iframe && event.source === iframe.contentWindow) {
                        sameSource = true;
                        break;
                    }
                }
            } catch {
                /* cross-origin access to contentWindow identity is allowed; ignore errors */
            }
            this.parentMessages.push({
                t: performance.now(),
                origin: event.origin,
                sameSourceAsIframe: sameSource,
                data: event.data,
            });
        };
        window.addEventListener('message', this._sniffer);
    }

    _pushEvent(source, name, payload) {
        this.events.push({ t: performance.now(), source, name, payload });
    }

    /**
     * Subscribe an element's events, recorded under its slot. Events are filtered
     * by this element's elementId: because sibling elements share one transport,
     * element.on(name) receives ALL elements' events of that name, so we only
     * record the ones whose payload.elementId matches this element. Events that
     * carry no elementId (e.g. expressAvailabilityChange — express is a singleton)
     * are recorded unfiltered.
     */
    _subscribeElementEvents(slot, element) {
        const id = element.elementId;
        for (const name of ELEMENT_EVENTS) {
            element.on(name, (payload) => {
                const pid = payload && typeof payload === 'object' ? payload.elementId : undefined;
                if (pid !== undefined && pid !== id) {
                    return; // belongs to a sibling element on the shared transport
                }
                this._pushEvent(slot, name, payload);
            });
        }
    }

    _createApi() {
        const w = window.SunbayCheckout;
        if (!w || typeof w.createCheckout !== 'function') {
            throw new Error('window.SunbayCheckout.createCheckout not available');
        }
        return w.createCheckout;
    }

    /**
     * Create a sandbox session via the test backend, with a small retry to absorb
     * transient open-platform / network blips (observed as intermittent "fetch
     * failed" / 5xx). Returns { ok, sessionId } or { ok:false, error }.
     */
    async _createSession(config, attempts = 3) {
        let lastError = 'unknown';
        for (let i = 0; i < attempts; i++) {
            try {
                const res = await fetch('/api/create-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        collectBillingAddress: config.collectBillingAddress,
                        collectShippingAddress: config.collectShippingAddress,
                    }),
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    lastError = body.error || `create-session failed (${res.status})`;
                    // 503 (no credentials) is not transient — do not retry.
                    if (res.status === 503) break;
                } else {
                    const body = await res.json();
                    if (body.sessionId) {
                        return { ok: true, sessionId: body.sessionId };
                    }
                    lastError = 'create-session returned no sessionId';
                }
            } catch (err) {
                lastError = String(err);
            }
            // Backoff before the next attempt.
            if (i < attempts - 1) {
                await new Promise((r) => setTimeout(r, 400 * (i + 1)));
            }
        }
        return {
            ok: false,
            error: {
                code: 'SESSION_LOAD_FAILED',
                message: lastError,
                category: 'network',
                errorId: 'e2e-session',
            },
        };
    }

    /**
     * Create an instance from a session, then create + mount declared elements.
     * See harness-design.md §3 for the exact ordering.
     */
    async setup(config) {
        const key = config.instanceKey ?? DEFAULT_KEY;
        const hostOrigin = resolveHostOrigin(config.hostOrigin);

        // 1. Obtain a sessionId.
        let sessionId;
        if (config.session === 'auto') {
            const created = await this._createSession(config);
            if (!created.ok) {
                return { ok: false, error: created.error };
            }
            sessionId = created.sessionId;
        } else {
            sessionId = config.session;
        }

        // 2. createCheckout.
        const createCheckout = this._createApi();
        let instance;
        try {
            instance = await createCheckout({
                sessionId,
                env: config.env,
                hostOrigin,
                locale: config.locale,
                appearance: config.appearance,
                paymentMethods: config.paymentMethods,
            });
        } catch (err) {
            return { ok: false, error: err };
        }

        this.instances[key] = instance;
        this.instance = instance;

        // 3. Subscribe instance-level events.
        const handlers = [];
        for (const name of INSTANCE_EVENTS) {
            const handler = (payload) => this._pushEvent('instance', name, payload);
            instance.on(name, handler);
            handlers.push({ event: name, handler });
        }
        this._instanceHandlers.set(key, handlers);

        // 4. create + mount elements.
        const creationErrors = {};
        const mountStatus = {};
        for (const spec of config.elements ?? []) {
            const willMount = spec.mount !== false;
            if (spec.expectConflict) {
                try {
                    instance.create(spec.type, spec.options);
                    // No throw => contract broken; record for assertion failure.
                    mountStatus[spec.slot] = 'skipped';
                    this._pushEvent(spec.slot, 'createError', {
                        code: 'NO_CONFLICT_THROWN',
                        message: 'expected ELEMENT_CONFLICT but create() did not throw',
                    });
                } catch (err) {
                    creationErrors[spec.slot] = err;
                    this._pushEvent(spec.slot, 'createError', err);
                }
                continue;
            }

            let element;
            try {
                element = instance.create(spec.type, spec.options);
            } catch (err) {
                creationErrors[spec.slot] = err;
                this._pushEvent(spec.slot, 'createError', err);
                continue;
            }
            this.elements[spec.slot] = element;
            // Subscribe element events, filtered by this element's elementId so a
            // shared transport does not cross-record sibling elements' events.
            this._subscribeElementEvents(spec.slot, element);
            if (!willMount) {
                mountStatus[spec.slot] = 'skipped';
                continue;
            }
            try {
                await element.mount(spec.slot);
                mountStatus[spec.slot] = 'ready';
            } catch (err) {
                mountStatus[spec.slot] = 'loadError';
                this._pushEvent(spec.slot, 'mountError', err);
            }
        }

        return {
            ok: true,
            checkoutId: instance.checkoutId,
            creationErrors,
            mountStatus,
        };
    }

    _instanceFor(instanceKey) {
        const key = instanceKey ?? DEFAULT_KEY;
        const inst = this.instances[key];
        if (!inst) throw new Error(`no instance for key ${key}`);
        return inst;
    }

    /** Confirm; resolve a ConfirmRecord capturing outcome/error/operationId. */
    async confirm(opts, instanceKey) {
        const inst = this._instanceFor(instanceKey);
        try {
            const outcome = await inst.confirm(opts);
            return { ok: true, outcome, operationId: outcome.operationId };
        } catch (err) {
            return { ok: false, error: err, operationId: err?.operationId };
        }
    }

    async update(slot, patch) {
        const el = this.elements[slot];
        if (!el) throw new Error(`no element for slot ${slot}`);
        return el.update(patch);
    }

    async updateCheckout(patch, instanceKey) {
        const inst = this._instanceFor(instanceKey);
        return inst.updateCheckout(patch);
    }

    async action(slot, kind) {
        const el = this.elements[slot];
        if (!el) throw new Error(`no element for slot ${slot}`);
        if (typeof el[kind] !== 'function') {
            throw new Error(`element ${slot} has no action ${kind}`);
        }
        return el[kind]();
    }

    async unmount(slot) {
        const el = this.elements[slot];
        if (!el) throw new Error(`no element for slot ${slot}`);
        return el.unmount();
    }

    async mount(slot) {
        const el = this.elements[slot];
        if (!el) return { ok: false, error: { code: 'NO_ELEMENT', message: `no element for slot ${slot}` } };
        try {
            await el.mount(slot);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err };
        }
    }

    /** Late create (+ optional mount) — used by conflict/rebuild cases (C3-08). */
    async createElement(spec, instanceKey) {
        const inst = this._instanceFor(instanceKey);
        let element;
        try {
            element = inst.create(spec.type, spec.options);
        } catch (err) {
            return { ok: false, error: err, slot: spec.slot };
        }
        this.elements[spec.slot] = element;
        this._subscribeElementEvents(spec.slot, element);
        if (spec.mount !== false) {
            try {
                await element.mount(spec.slot);
            } catch (err) {
                return { ok: false, error: err, slot: spec.slot };
            }
        }
        return { ok: true, slot: spec.slot };
    }

    async destroy(instanceKey) {
        const key = instanceKey ?? DEFAULT_KEY;
        const inst = this.instances[key];
        if (inst) {
            inst.destroy();
            delete this.instances[key];
            if (this.instance === inst) {
                const remaining = Object.values(this.instances);
                this.instance = remaining.length ? remaining[remaining.length - 1] : null;
            }
        }
    }

    /** Full teardown + clear records. */
    reset() {
        for (const inst of Object.values(this.instances)) {
            try {
                inst.destroy();
            } catch {
                /* ignore */
            }
        }
        this.instances = {};
        this.instance = null;
        this.elements = {};
        this.events = [];
        this.parentMessages = [];
        this._instanceHandlers.clear();
        // Clear any leftover iframes in slots.
        for (const slot of document.querySelectorAll('.slot')) {
            slot.innerHTML = '';
        }
    }
}

window.__sunbayHarness = new Harness();

// Signal readiness for the Playwright layer to wait on.
const statusEl = document.getElementById('status');
if (window.SunbayCheckout && typeof window.SunbayCheckout.createCheckout === 'function') {
    window.__sunbayHarnessReady = true;
    if (statusEl) statusEl.textContent = 'harness ready';
} else {
    window.__sunbayHarnessReady = false;
    if (statusEl) statusEl.textContent = 'SDK not loaded';
}
