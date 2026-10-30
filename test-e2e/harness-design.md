# Harness page + hook contract (harness-design.md)

> This file defines the real-device tests' **execution vehicle**: a test-only
> "standard merchant-page simulator" (the harness) and the deterministic global
> `window.__sunbayHarness` it exposes to test cases. Cases write only
> **declarative config + assertions**; all SDK call details are encapsulated by
> the harness, minimizing ambiguity when an AI lands executable tests.
>
> The harness is **test infrastructure**, not part of the SDK, and is never
> published. It loads the real SDK IIFE build and simulates a real merchant
> page. **The harness never touches card values** (PCI).

---

## 1. Components

| Component | Role | Default origin |
|---|---|---|
| `harness.html` + `harness.mjs` | Harness page: loads the SDK IIFE build, exposes `window.__sunbayHarness`, provides mount slots | `http://localhost:8090` |
| `server/server.mjs` | Test backend: holds the sandbox merchant key, `POST /api/create-session` returns a `sessionId` | same origin as the harness |
| hosted runtime | Hosts `/embed/sdk/main`, `/embed/embed/sdk/field/*`, `/embed/embed/sdk/element/*` | `http://localhost:3000` or a real environment |
| stub runtime (optional) | Fake hello endpoint (for PROTOCOL_UNSUPPORTED), started on demand | in `test-e2e/`, `:8099` |

The harness provides a set of **empty containers with fixed ids** (mount slots)
that cases locate by id, e.g.:

```html
<div id="slot-card"></div>
<div id="slot-num"></div>   <div id="slot-exp"></div>   <div id="slot-cvc"></div>
<div id="slot-bill"></div>  <div id="slot-ship"></div>
<div id="slot-express"></div>
<!-- spare slots: slot-card2 / slot-num1 / slot-num2 / slot-b1 / slot-b2 / slot-e1 / slot-e2 -->
```

> A slot container must resolve uniquely and be empty (the SDK `mount` requires a
> unique match with `childElementCount===0`). `reset()` clears all slots.

> **Multi-instance semantics**: `instance` always points at the "most recently
> created instance from a successful `setup`" and is a convenience for the
> single-instance case. Multi-instance cases (C7-10) **must** locate each
> instance via `instances[instanceKey]`; likewise `destroy(instanceKey)` /
> `confirm(opts, instanceKey)` / `updateCheckout(patch, instanceKey)` take an
> explicit key.

---

## 2. Global hook contract `window.__sunbayHarness`

> Expressed as TS pseudo-types; the implementation may be JS or TS. All methods
> are `async` and record errors as a structured `CheckoutError` rather than
> throwing raw exceptions (unless the contract explicitly declares a sync throw).

```ts
interface SunbayHarness {
    // --- Build a scenario (declarative) ---
    // Create an instance from a session, then create + mount the declared
    // elements. Resolves after createCheckout settles and all auto-mount elements
    // reach ready or loadError.
    setup(config: HarnessConfig): Promise<SetupResult>;

    // --- Live handles (for assertions; readable after a successful setup) ---
    instance: CheckoutInstance | null;              // shortcut to the most recently created instance
    instances: Record<string, CheckoutInstance>;    // named instances (multi-instance cases)
    elements: Record<string, CheckoutElement>;      // keyed by slot selector, e.g. '#slot-card'

    // --- Observers (primary assertion data sources) ---
    events: HarnessEvent[];          // ordered instance/element events + createError records
    parentMessages: ParentMessage[]; // every window 'message' the parent window received

    // --- Operations (mirror the SDK API; called by case steps) ---
    confirm(opts?: ConfirmOptions, instanceKey?: string): Promise<ConfirmRecord>;
    update(slot: string, patch: Partial<ElementOptions>): Promise<void>; // element.update
    updateCheckout(patch: { locale?: string; appearance?: Appearance }, instanceKey?: string): Promise<void>;
    action(slot: string, kind: 'focus' | 'blur' | 'clear'): Promise<void>;
    unmount(slot: string): Promise<void>;
    mount(slot: string): Promise<MountRecord>;       // re-mount a previously created element
    createElement(spec: ElementSpec, instanceKey?: string): Promise<CreateRecord>; // late create (conflict cases)
    destroy(instanceKey?: string): Promise<void>;    // instance.destroy; default = the default instance

    // --- Reset ---
    reset(): void;                   // destroy all instances, clear slots, clear records
}
```

### 2.1 `HarnessConfig`

```ts
interface HarnessConfig {
    // Session source. 'auto' => call test backend POST /api/create-session.
    // A string => use that sessionId directly (pre-created / fake for error paths).
    session: 'auto' | string;

    // Optional named instance key for multi-instance cases (default '__default__').
    instanceKey?: string;

    env?: 'dev' | 'test' | 'prod';
    hostOrigin?: string;             // override hosted origin (e.g. stub/blackhole)
    locale?: string;
    appearance?: Appearance;         // colorScheme / variables / rules (instance-level initial)
    paymentMethods?: PaymentMethodFilter;

    // Session variants passed to the backend (C3-09).
    collectBillingAddress?: boolean;
    collectShippingAddress?: boolean;

    elements: ElementSpec[];
}

interface ElementSpec {
    type: ElementType;               // 'card' | 'cardNumber' | 'cardExpiry' | 'cardCvc' | 'address' | 'expressCheckout'
    slot: string;                    // container selector, e.g. '#slot-card'
    options?: ElementOptions;        // per-element options incl. appearance / express options / address mode
    mount?: boolean;                 // default true; false => create only (no DOM mount)

    // Mutual-exclusion cases: when true, create() is EXPECTED to throw
    // ELEMENT_CONFLICT synchronously. setup() catches it, records a 'createError'
    // event, and continues with the remaining elements instead of aborting.
    expectConflict?: boolean;
}
```

### 2.2 Result and record shapes

```ts
interface SetupResult {
    ok: boolean;                     // createCheckout resolved
    error?: CheckoutError;           // set when createCheckout rejected (handshake/initialize)
    checkoutId?: string;
    // Per-slot creation outcome. For expectConflict slots, creationErrors[slot]
    // holds the captured ELEMENT_CONFLICT; otherwise undefined.
    creationErrors?: Record<string, CheckoutError>;
    // Per-slot mount outcome (ready | loadError | skipped).
    mountStatus?: Record<string, 'ready' | 'loadError' | 'skipped'>;
}

interface HarnessEvent {
    t: number;                       // performance.now() timestamp (ordering)
    source: 'instance' | string;    // 'instance' or the slot selector that owns the element
    name: string;                    // event name OR 'createError' / 'mountError'
    payload: unknown;                // event payload (card-value-free by protocol contract)
}

interface ParentMessage {
    t: number;
    origin: string;                  // event.origin
    sameSourceAsIframe: boolean;     // event.source === some tracked iframe.contentWindow
    data: unknown;                   // raw MessageEvent.data
}

interface ConfirmRecord {
    ok: boolean;
    outcome?: PaymentOutcome;        // on success
    error?: CheckoutError;           // on reject (e.g. CHECKOUT_BUSY / INSTANCE_DESTROYED)
    operationId?: string;            // the operationId the instance generated (for correlation)
}

interface MountRecord { ok: boolean; error?: CheckoutError; }
interface CreateRecord { ok: boolean; error?: CheckoutError; slot: string; }
```

---

## 3. setup() internal behavior (normative)

`setup(config)` MUST execute in the following order so a case's `expected` is
deterministically observable:

1. **Create a session**: `session==='auto'` → `POST /api/create-session` for a
   `sessionId`; otherwise use the given value. On failure →
   `SetupResult.ok=false` with a structured `error`, and stop.
2. **createCheckout**: call `createCheckout` with `sessionId` + `env` /
   `hostOrigin` / `locale` / `appearance` / `paymentMethods`.
   - resolve → store in `instances[instanceKey]` (and the `instance` shortcut),
     record `checkoutId`.
   - reject (e.g. `RUNTIME_LOAD_FAILED` / `PROTOCOL_UNSUPPORTED` / initialize
     failure) → `ok=false`, `error=<CheckoutError>`, return (do not create
     elements).
3. **Subscribe instance-level events**: `instance.on` for `paymentResult` /
   `paymentStateChange` / `error`; callbacks push `{source:'instance', name,
   payload}` into `events`.
4. **Create + mount elements** (in config order):
   - Normal: `instance.create(type, options)` → store in `elements[slot]`;
     subscribe `elementReady` / `loadError` / `ready` / `change` / `focus` /
     `blur` / `expressAvailabilityChange` for that element, pushing into `events`
     with `source` = the slot.
   - `expectConflict:true`: wrap `create` in try/catch; on a synchronous
     `ELEMENT_CONFLICT` → push `{source:slot, name:'createError', payload:error}`,
     write `creationErrors[slot]`, and **continue** to the next item; if it does
     not throw (contract violated) → record so the assertion fails.
   - `mount!==false`: `await element.mount(slot)`; ready → `mountStatus[slot]='ready'`;
     loadError → `'loadError'`. `mount===false` → `'skipped'`.
5. Return the aggregated `SetupResult`.

> `setup` does **not** reject on a single element's loadError; it records the
> status in `mountStatus` so cases that test the loadError branch can assert it.

---

## 4. Observers

### 4.1 Event recorder

The harness appends **every subscribed SDK event** to `events` in **time order**
with its **source** (`instance` or a slot). Assertions read back
`__sunbayHarness.events` via `evaluate_script` and judge by `name` / `source` /
order.

- Event payloads are **card-value-free** by protocol contract; the recorder
  stores payloads **verbatim**, precisely so the PCI assertion can scan for the
  absence of a card number.
- `on` does **not** replay history, so the harness subscribes **immediately**
  after `create`/`createCheckout` to avoid missing early `elementReady`.

### 4.2 parentMessage sniffer

The harness installs a persistent `message` listener on the **top-level harness
window**, recording **every** `MessageEvent` as a `ParentMessage` (its `origin`,
whether it came from a tracked iframe's contentWindow, and the raw `data`).
Used for:

- Verifying the iframe auto-resize message (`sunbay:checkout:iframe-resize`)
  source and elementId.
- The **PCI assertion**: serialize all `parentMessages` and confirm **no card
  number / CVV ever appears**.

> This sniffer is independent of the SDK's internal Element resize listener — a
> read-only side observation on the test side.

---

## 5. Cross-iframe card entry convention (PCI-critical)

Payment-flow / input-state cases need to "enter a card", but **card values never
pass through the harness hooks or the SDK**. Convention:

1. The harness only makes the `cardNumber` / `cardExpiry` / `cardCvc` hosted
   field iframes ready and exposes their containers/iframes (for automation to
   locate).
2. **Entry is done by the browser automation typing directly into the `<input>`
   inside each hosted field iframe** (cross-iframe), without calling any
   SDK/harness method that carries a card value.
3. The sandbox card is in `fixtures/test-cards.ts`.
4. Every card-entry case **must** carry the PCI assertion: serialize
   `parentMessages` + `events` and confirm they contain no card number
   (`4012000098765439`), no CVV fragment, and no contiguous PAN substring.

> Because hosted and harness are cross-origin, locating the `<input>` inside the
> iframe relies on the runner's handling of the same-origin policy (browser
> automation can operate within each frame's own context). If a given execution
> environment cannot operate inside the iframe, the case is marked as needing a
> "controllable card-entry entry point", decided by the runner — but **under no
> circumstances may card values travel via the SDK channel**.

---

## 6. Stub and backend conventions

### 6.1 Test backend `POST /api/create-session`

- Request: optional body selecting currency/amount/collect flags (safe defaults).
- Behavior: the server creates a session against the open platform using the
  **sandbox merchant key** (read from `.env.local`, git-ignored).
- Response: `{ sessionId }`. The key is **never** sent to the browser.
- `requires-session-variant` cases: the backend must be able to create a session
  with a specific flag (e.g. `collectShippingAddress:true`). If the sandbox
  merchant cannot control it, the case degrades to "assert session-view field
  pass-through only", as noted on the case.

### 6.2 Stub runtime (for `PROTOCOL_UNSUPPORTED` only)

- A minimal `/embed/sdk/main` stand-in that, at handshake, replies with a
  `RuntimeHello` whose `supportedMajorVersions` **excludes** the current
  `PROTOCOL_MAJOR` (set to a disjoint value).
- Used only by `C1-03`. Touches no card data; not part of any published artifact.
- If the environment provides no stub, `C1-03` leaves real-device scope (covered
  by `createCheckout`'s Vitest) and is marked `requires-stub-runtime`, optional.

### 6.3 Blackhole origin (`RUNTIME_LOAD_FAILED`)

- Points at an **unreachable origin that never replies with hello** (e.g.
  `http://127.0.0.1:59999`), triggering `createCheckout`'s 15s handshake timeout
  → `RUNTIME_LOAD_FAILED`. No stub implementation needed.

---

## 7. Assertion data-source cheatsheet (for the runner)

| What to verify | How to read it |
|---|---|
| createCheckout success/failure/error code | `setup()`'s `SetupResult.ok` / `error.code` |
| whether an element is ready | `elements['#slot'].getStatus()` or the slot's `elementReady` in `events` |
| mutual-exclusion conflict | `SetupResult.creationErrors['#slot'].code === 'ELEMENT_CONFLICT'` or `events` `createError` |
| iframe src / routing / customization params | read the slot's `iframe.src` (query contains `colorScheme=` / `appearance=` / `applePay=` ...) — **parent can read directly**, not blocked by cross-origin |
| theming/style applied (inside the iframe) | **Cross-origin constraint**: the hosted iframe is a different origin, so parent JS **cannot** read its `contentDocument` / computed styles. Use one of: (a) browser automation **switches into the iframe's frame context** and runs script reading `getComputedStyle` / `.dark`; (b) **visual assertion** (screenshot the iframe region and compare). Wherever this doc says "read computed styles cross-iframe", it means (a)/(b), not a direct parent read |
| iframe auto-resize | the slot's `iframe.style.height` > 0 (parent can read); `parentMessages` contains the resize message with a matching elementId |
| event sequence (change/ready/focus/blur/express/payment*) | filter `__sunbayHarness.events` by `name`/`source` (parent can read) |
| confirm result | the `ConfirmRecord` from `confirm()` (`outcome` / `error.code` / `operationId`) |
| payment terminal state | `paymentResult` in `events`, its `outcome.status` and `operationId` aligned with confirm |
| wallet availability | `elements['#slot-express'].getAvailableWallets()` (parent can read) |
| PCI: no card leak | serialize `parentMessages` + `events`, scan for absence of card number / CVV (parent side) |
| post-destroy behavior | calls after destroy return/throw `INSTANCE_DESTROYED` |

> **Cross-origin assertion rule**: any assertion about iframe **internal**
> DOM/style/text must be obtained via a frame-context script or a visual
> comparison; any assertion about iframe **outer** attributes (`iframe.src`,
> `style.height`, existence) and about parent-observed `events`/`parentMessages`
> can be read directly by parent JS. The runner chooses the data source
> accordingly.
