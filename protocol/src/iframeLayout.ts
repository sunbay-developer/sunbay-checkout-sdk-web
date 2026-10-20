/**
 * iframe 布局协议:托管 iframe(checkout,child)→ 父窗口(商户 SDK,parent)的
 * **直连 postMessage** 契约,用于 iframe 自适应高度。
 *
 * 与外层 Envelope(商户 SDK ↔ main iframe)及内层点对点 port(element ↔ main)均区分:
 * 本消息由每个可见 field / element iframe 直接 postMessage 到其 `window.parent`(商户页),
 * 商户 SDK 的 Element 句柄监听后把外层 iframe 高度调整为内容真实高度(宽度保持 100%)。
 *
 * 安全约束(AGENTS/spec):本消息**绝不含任何卡值**(明文或密文),仅携带 height 与
 * elementId。父窗口侧须校验来源(`event.source === iframe.contentWindow` 且
 * `event.origin === hostOrigin`)后方可采信,防止跨源伪造。
 */

/** iframe 自适应高度消息的判别字面量(命名空间化,避免与其它 postMessage 碰撞)。 */
export const IFRAME_RESIZE_MESSAGE_TYPE = 'sunbay:checkout:iframe-resize' as const;

/**
 * iframe(child)→ 父窗口(SDK)的内容高度变更通知。
 *
 * child 用 `ResizeObserver` 观测内容高度,变化时发送(去重);parent 据此设
 * `iframe.style.height`。绝不含卡值。
 */
export interface IframeResizeMessage {
    /** 判别字段,固定为 {@link IFRAME_RESIZE_MESSAGE_TYPE}。 */
    type: typeof IFRAME_RESIZE_MESSAGE_TYPE;
    /**
     * 目标 Element 的唯一 id。由商户 SDK 经 iframe src 的 `&elementId=` 下发,child 原样
     * 回传,供父窗口在同一页面多个 iframe 间按句柄分发。
     */
    elementId: string;
    /** 内容高度(CSS px,已 `Math.ceil`;有限且非负)。 */
    height: number;
}

/**
 * 是否为合法的 {@link IframeResizeMessage}。
 *
 * 校验:非空对象 + type 字面量匹配 + elementId 为非空字符串 + height 为有限非负数。
 *
 * @param data - 任意来源数据(通常是 `MessageEvent.data`)。
 * @returns data 是否为合法的 iframe-resize 消息。
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
