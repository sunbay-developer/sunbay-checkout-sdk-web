/**
 * iframe layout protocol: the **direct postMessage** contract from the hosted iframe (checkout,
 * child) → parent window (merchant SDK, parent), used for iframe auto-height.
 *
 * Distinct from both the outer Envelope (merchant SDK ↔ main iframe) and the inner point-to-point
 * port (element ↔ main): this message is posted directly by each visible field / element iframe to
 * its `window.parent` (the merchant page), and the merchant SDK's Element handle listens for it and
 * adjusts the outer iframe height to the real content height (width stays 100%).
 *
 * Security constraint (AGENTS/spec): this message **never contains any card value** (plaintext or
 * ciphertext); it only carries height and elementId. The parent-window side must validate the
 * source (`event.source === iframe.contentWindow` and `event.origin === hostOrigin`) before
 * trusting it, to prevent cross-origin forgery.
 */

/** Discriminant literal for the iframe auto-height message (namespaced to avoid colliding with other postMessages). */
export const IFRAME_RESIZE_MESSAGE_TYPE = 'sunbay:checkout:iframe-resize' as const;

/**
 * Content height change notification from the iframe (child) → parent window (SDK).
 *
 * The child observes content height with a `ResizeObserver` and sends on change (deduplicated); the
 * parent sets `iframe.style.height` accordingly. Never contains card values.
 */
export interface IframeResizeMessage {
    /** Discriminant field, fixed to {@link IFRAME_RESIZE_MESSAGE_TYPE}. */
    type: typeof IFRAME_RESIZE_MESSAGE_TYPE;
    /**
     * The unique id of the target Element. Passed down by the merchant SDK via the iframe src's
     * `&elementId=`, echoed back verbatim by the child, so the parent window can dispatch by handle
     * among multiple iframes on the same page.
     */
    elementId: string;
    /** Content height (CSS px, already `Math.ceil`-ed; finite and non-negative). */
    height: number;
}

/**
 * Whether the value is a valid {@link IframeResizeMessage}.
 *
 * Validates: non-null object + type literal match + elementId is a non-empty string + height is a
 * finite non-negative number.
 *
 * @param data - Data from any source (typically `MessageEvent.data`).
 * @returns Whether data is a valid iframe-resize message.
 */
export function isIframeResizeMessage(data: unknown): data is IframeResizeMessage {
    if (typeof data !== 'object' || data === null) {
        return false;
    }
    const msg = data as Partial<IframeResizeMessage>;
    return (
        msg.type === IFRAME_RESIZE_MESSAGE_TYPE &&
        typeof msg.elementId === 'string' &&
        msg.elementId.length > 0 &&
        typeof msg.height === 'number' &&
        Number.isFinite(msg.height) &&
        msg.height >= 0
    );
}
