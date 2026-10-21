/**
 * Environment resolution and skip conditions for the e2e suite.
 *
 * Reads origins from env (with local defaults) and probes the test backend's
 * /healthz to learn whether sandbox credentials are present. Tests that depend on
 * a real session skip cleanly when credentials are missing (so a credential-free
 * checkout still runs the credential-free cases).
 */

export const HARNESS_ORIGIN = process.env.E2E_HARNESS_ORIGIN ?? 'http://localhost:8090';
export const HOSTED_ORIGIN = process.env.E2E_HOSTED_ORIGIN ?? 'http://localhost:3000';
export const STUB_ORIGIN = process.env.E2E_STUB_ORIGIN ?? 'http://localhost:8099';

/** Blackhole origin for RUNTIME_LOAD_FAILED (C1-04): a port that never replies. */
export const BLACKHOLE_ORIGIN = process.env.E2E_BLACKHOLE_ORIGIN ?? 'http://127.0.0.1:59999';

/** Harness page URL (served by the test backend). */
export const HARNESS_URL = `${HARNESS_ORIGIN}/harness/harness.html`;

interface HealthInfo {
    ok: boolean;
    hasCredentials: boolean;
    hostedOrigin?: string;
}

let cachedHealth: HealthInfo | null = null;

/** Probe the test backend readiness + credential availability (cached). */
export async function getHealth(): Promise<HealthInfo> {
    if (cachedHealth) return cachedHealth;
    try {
        const res = await fetch(`${HARNESS_ORIGIN}/healthz`);
        cachedHealth = (await res.json()) as HealthInfo;
    } catch {
        cachedHealth = { ok: false, hasCredentials: false };
    }
    return cachedHealth;
}

/** Whether a stub runtime is reachable (for C1-03). */
export async function hasStubRuntime(): Promise<boolean> {
    try {
        const res = await fetch(`${STUB_ORIGIN}/healthz`);
        return res.ok;
    } catch {
        return false;
    }
}

/** Whether the hosted runtime is reachable. */
export async function hasHostedRuntime(): Promise<boolean> {
    try {
        const res = await fetch(`${HOSTED_ORIGIN}/healthz`);
        return res.ok;
    } catch {
        return false;
    }
}
