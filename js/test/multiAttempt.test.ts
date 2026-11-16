import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutInstance, type InstanceTransport } from '../src/CheckoutInstance';
import {
    ErrorCode,
    type CommandName,
    type PaymentOutcome,
    type PublicSessionView,
} from '@sunbay/checkout-sdk-protocol';

/**
 * Multi-attempt sessions: a failed payment ends the attempt, not the session. The same session can
 * be confirmed again until it succeeds, and the session status is reported next to `txnStatus`.
 */

interface MockTransport extends InstanceTransport {
    requests: { name: CommandName; payload: unknown }[];
    requestImpl: (name: CommandName, payload: unknown) => Promise<unknown>;
    emit: (event: string, payload: unknown) => void;
}

function createMockTransport(): MockTransport {
    const handlers = new Map<string, Set<(payload: unknown) => void>>();
    return {
        requests: [],
        requestImpl: () => Promise.resolve({ accepted: true }),
        request(name, payload): Promise<unknown> {
            this.requests.push({ name, payload });
            return this.requestImpl(name, payload);
        },
        on(event, handler): void {
            let set = handlers.get(event);
            if (!set) {
                set = new Set();
                handlers.set(event, set);
            }
            set.add(handler);
        },
        off(event, handler): void {
            handlers.get(event)?.delete(handler);
        },
        onHello(): void {},
        setRuntimeId(): void {},
        createHiddenIframe(): void {},
        destroy(): void {},
        emit(event, payload): void {
            for (const h of [...(handlers.get(event) ?? [])]) {
                h(payload);
            }
        },
    };
}

function makeSession(): PublicSessionView {
    return {
        sessionId: 'sess_1',
        sessionType: 'payment',
        currency: 'USD',
        totalAmount: 1000,
        productList: [],
        taxAmount: 0,
        productAmount: 1000,
        description: 'test',
        expiresAt: '2099-01-01T00:00:00Z',
        collectBillingAddress: false,
        collectShippingAddress: false,
        paymentMethods: [],
        merchantName: 'Acme',
        merchantLogoUrl: '',
    };
}

function makeInstance(transport: MockTransport): CheckoutInstance {
    return new CheckoutInstance({
        checkoutId: 'co_1',
        runtimeId: 'rt_1',
        hostOrigin: 'https://checkout.sunbay-dev.com',
        transport,
        capabilities: ['card'],
        session: makeSession(),
    });
}

function confirmOpIds(transport: MockTransport): string[] {
    return transport.requests
        .filter((r) => r.name === 'confirm')
        .map((r) => (r.payload as { operationId: string }).operationId);
}

function emitResult(transport: MockTransport, operationId: string, outcome: PaymentOutcome): void {
    transport.emit('paymentResult', { operationId, method: 'CARD', outcome });
}

describe('multi-attempt session', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('confirm() after a failed attempt starts a new operation and can succeed', async () => {
        const transport = createMockTransport();
        const instance = makeInstance(transport);

        const first = instance.confirm();
        await vi.advanceTimersByTimeAsync(0);
        const [op1] = confirmOpIds(transport);
        const failed: PaymentOutcome = {
            status: 'failed',
            operationId: op1,
            txnId: 'txn_f',
            error: {
                errorId: 'err_1',
                code: ErrorCode.PAYMENT_FLOW_ERROR,
                message: 'No funds',
                category: 'payment',
            },
        };
        emitResult(transport, op1, failed);
        await expect(first).resolves.toEqual(failed);

        // The failed attempt freed the slot: the buyer retries on the same session.
        const second = instance.confirm();
        await vi.advanceTimersByTimeAsync(0);
        const ids = confirmOpIds(transport);
        expect(ids).toHaveLength(2);
        expect(ids[1]).not.toBe(ids[0]);
        const ok: PaymentOutcome = { status: 'succeeded', operationId: ids[1], txnId: 'txn_ok' };
        emitResult(transport, ids[1], ok);
        await expect(second).resolves.toEqual(ok);
    });

    it('retries keep failing then succeed: every attempt reaches the paymentResult listener', async () => {
        const transport = createMockTransport();
        const instance = makeInstance(transport);
        const seen: string[] = [];
        instance.on('paymentResult', (e) => seen.push(`${e.operationId}:${e.outcome.status}`));

        for (let i = 0; i < 3; i++) {
            const p = instance.confirm();
            await vi.advanceTimersByTimeAsync(0);
            const id = confirmOpIds(transport)[i];
            emitResult(
                transport,
                id,
                i < 2
                    ? {
                          status: 'failed',
                          operationId: id,
                          error: {
                              errorId: `err_${i}`,
                              code: ErrorCode.PAYMENT_FLOW_ERROR,
                              message: 'declined',
                              category: 'payment',
                          },
                      }
                    : { status: 'succeeded', operationId: id, txnId: 'txn_ok' }
            );
            await p;
        }

        const ids = confirmOpIds(transport);
        expect(seen).toEqual([`${ids[0]}:failed`, `${ids[1]}:failed`, `${ids[2]}:succeeded`]);
    });

    it('session closed during confirm (C11): rejection keeps the backend code and frees the slot', async () => {
        const transport = createMockTransport();
        const instance = makeInstance(transport);
        transport.requestImpl = () =>
            Promise.reject({
                code: ErrorCode.PAYMENT_FLOW_ERROR,
                message: 'Session already closed',
                category: 'payment',
                backendCode: 'C11',
            });

        await expect(instance.confirm()).rejects.toMatchObject({ backendCode: 'C11' });
        // Not stuck in CHECKOUT_BUSY: another confirm is sent (and rejected by the backend again).
        transport.requestImpl = () => Promise.resolve({ accepted: true });
        const next = instance.confirm();
        next.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(0);
        expect(confirmOpIds(transport)).toHaveLength(2);
    });

    describe('getPaymentStatus', () => {
        it('returns txnStatus and sessionStatus verbatim', async () => {
            const transport = createMockTransport();
            const instance = makeInstance(transport);
            transport.requestImpl = () =>
                Promise.resolve({ txnStatus: 'F', sessionStatus: 'ACTIVE', txnId: 'txn_f' });

            await expect(instance.getPaymentStatus()).resolves.toEqual({
                txnStatus: 'F',
                sessionStatus: 'ACTIVE',
                txnId: 'txn_f',
            });
        });

        it('txnStatus may be absent (EXPIRED session): passed through, not invented', async () => {
            const transport = createMockTransport();
            const instance = makeInstance(transport);
            transport.requestImpl = () => Promise.resolve({ sessionStatus: 'EXPIRED' });

            const status = await instance.getPaymentStatus();
            expect(status.txnStatus).toBeUndefined();
            expect(status.sessionStatus).toBe('EXPIRED');
        });
    });
});
