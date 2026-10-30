/**
 * Shared front-end helpers for the SDK examples.
 *
 * These are intentionally thin, framework-free utilities so each example page
 * stays focused on the SDK usage it demonstrates. None of this touches card
 * values — card entry happens entirely inside the hosted iframes rendered by the
 * SDK (PCI isolation).
 */

/* global window, document, fetch */

/**
 * Fetch the example backend health/config (hosted origin, credential presence,
 * whether the SDK build is on disk).
 *
 * @returns {Promise<{ok:boolean, hasCredentials:boolean, sdkBuildPresent:boolean, hostedOrigin:string}>}
 */
export async function fetchHealth() {
    try {
        const res = await fetch('/healthz');
        return await res.json();
    } catch (err) {
        return {
            ok: false,
            hasCredentials: false,
            sdkBuildPresent: false,
            hostedOrigin: 'http://localhost:3000',
            error: String(err),
        };
    }
}

/**
 * Render a status banner into `el` describing any missing prerequisites. When
 * everything is ready the banner stays hidden.
 *
 * @param {object} health - The result of {@link fetchHealth}.
 * @param {HTMLElement|null} el - The banner container.
 */
export function renderHealthBanner(health, el) {
    if (!el) return;
    const problems = [];
    if (!health.ok) {
        problems.push('The example backend is not reachable (is the server running?).');
    }
    if (health.ok && !health.sdkBuildPresent) {
        problems.push(
            'SDK build missing: run `pnpm --filter @sunbay/checkout-sdk-js run build` to produce dist/index.global.js.'
        );
    }
    if (health.ok && !health.hasCredentials) {
        problems.push(
            'Sandbox credentials missing: copy example/.env.example to example/.env.local and fill API_KEY / APP_ID / MERCHANT_ID. You can view the UI but cannot create a session.'
        );
    }
    if (problems.length === 0) {
        el.hidden = true;
        return;
    }
    el.hidden = false;
    el.classList.add('banner-warn');
    el.innerHTML =
        '<strong>Heads up:</strong><ul>' +
        problems.map((p) => `<li>${p}</li>`).join('') +
        `</ul><p class="muted">Hosted runtime expected at <code>${health.hostedOrigin}</code>.</p>`;
}

/**
 * Resolve the SDK entry from the IIFE global, throwing a readable error if the
 * build script tag failed to load.
 *
 * @returns {(opts: object) => Promise<object>} the createCheckout function
 */
export function getCreateCheckout() {
    const w = window.SunbayCheckout;
    if (!w || typeof w.createCheckout !== 'function') {
        throw new Error(
            'window.SunbayCheckout.createCheckout is unavailable — the SDK IIFE build failed to load. ' +
                'Build it with `pnpm --filter @sunbay/checkout-sdk-js run build`.'
        );
    }
    return w.createCheckout;
}

/**
 * Ask the backend to create a checkout session with the sandbox merchant key.
 *
 * @param {{ collectBillingAddress?: boolean, collectShippingAddress?: boolean,
 *           items?: object[], currency?: string }} [variant] - Session variant.
 * @returns {Promise<{ sessionId: string, checkoutClientSecret: string }>} the created session
 *          id and its client secret (never log the secret).
 * @throws {Error} with a readable message when the backend returns non-2xx.
 */
export async function createSession(variant = {}) {
    const res = await fetch('/api/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variant),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.sessionId || !body.checkoutClientSecret) {
        throw new Error(body.error || `create-session failed (HTTP ${res.status})`);
    }
    return { sessionId: body.sessionId, checkoutClientSecret: body.checkoutClientSecret };
}

/**
 * Create a tiny append-only log sink bound to a <pre> element, returning a
 * `log(label, data?)` function. Useful for surfacing SDK events/outcomes on the
 * page without a framework.
 *
 * @param {HTMLElement} preEl - The target <pre>.
 * @returns {(label: string, data?: unknown) => void}
 */
export function createLogger(preEl) {
    return (label, data) => {
        const time = new Date().toLocaleTimeString();
        const line =
            data === undefined
                ? `[${time}] ${label}`
                : `[${time}] ${label} ${safeStringify(data)}`;
        preEl.textContent += (preEl.textContent ? '\n' : '') + line;
        preEl.scrollTop = preEl.scrollHeight;
    };
}

/**
 * Wire up the floating log dock's collapse/expand toggle.
 *
 * The dock (`#logdock`) starts collapsed (header bar only). Clicking the toggle
 * (`#logToggle`) switches to expanded (log body grows to half the viewport), and
 * the first log entry auto-expands it so activity is visible. Safe to call once
 * per page; a no-op if the dock markup is absent.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.autoExpandOnFirstLog=true] - Expand on the first log line.
 */
export function initLogDock(opts = {}) {
    const dock = document.getElementById('logdock');
    const toggle = document.getElementById('logToggle');
    const pre = document.getElementById('log');
    if (!dock || !toggle || !pre) return;

    const autoExpand = opts.autoExpandOnFirstLog !== false;

    const setExpanded = (expanded) => {
        dock.classList.toggle('expanded', expanded);
        dock.classList.toggle('collapsed', !expanded);
        toggle.textContent = expanded ? 'Collapse' : 'Expand';
        toggle.setAttribute('aria-expanded', String(expanded));
    };

    toggle.addEventListener('click', () => {
        setExpanded(!dock.classList.contains('expanded'));
    });

    if (autoExpand) {
        // Expand the first time the log receives content, then stop observing.
        const observer = new MutationObserver(() => {
            if (pre.textContent.trim()) {
                setExpanded(true);
                observer.disconnect();
            }
        });
        observer.observe(pre, { childList: true, characterData: true, subtree: true });
    }
}

/** JSON.stringify that tolerates circular refs / errors. */
function safeStringify(data) {    if (data instanceof Error) {
        return data.message;
    }
    try {
        return JSON.stringify(data);
    } catch {
        return String(data);
    }
}

/**
 * Format a PublicSessionView's amount for display (minor units → major units).
 *
 * @param {{ totalAmount:number, currency:string }} session
 * @returns {string}
 */
export function formatAmount(session) {
    if (!session || typeof session.totalAmount !== 'number') return '';
    const major = (session.totalAmount / 100).toFixed(2);
    return `${major} ${session.currency ?? ''}`.trim();
}
