# Real-device test cases (test-cases.md)

> The case list for the Checkout Web SDK real-device tests: 46 structured cases
> across C1–C7. Each case maps directly to one executable real-device test.
> Read `README.md` (three-layer architecture, markers) and `harness-design.md`
> (`window.__sunbayHarness` hook contract, data-source cheatsheet) first.

---

## 1. Case template

Every case uses these fields:

```
### <id> <title>
- category / priority / real-device-condition [/ optional]
- preconditions
- harness-config  the declarative config passed to __sunbayHarness.setup()
- steps           ordered actions (map to browser-automation operations)
- expected        observable points (DOM / events / parentMessages / iframe state / computed style)
- assertions      explicit pass/fail criteria
- cleanup         reset actions (destroy / reset)
```

**Cross-cutting PCI assertion (global invariant, applies to every card-entry
case)**: serialize `__sunbayHarness.parentMessages` and `__sunbayHarness.events`
and scan — they **must never** contain the sandbox PAN `4012000098765439`, any
contiguous substring of it, or the CVV `999` (in a card context). Any card-entry
case that does not spell this out still implies it, and the runner must append it.

**Cross-origin assertion rule (applies to C4 / C5 and any "iframe internal
style/text" assertion)**: the hosted iframe and the harness page are **different
origins**, so parent JS **cannot** read the iframe's `contentDocument` or
computed styles. Wherever this doc says "read computed styles / `.dark` / text
cross-iframe", it means one of: (a) browser automation **switches into the
iframe's frame context** and runs script; (b) **visual assertion** (screenshot
comparison). Iframe **outer** attributes (`iframe.src`, `style.height`,
existence) and parent-observed `events`/`parentMessages` can be read directly.
See `harness-design.md` §7 "Cross-origin assertion rule".

**Case matrix**: C1(5) + C2(6) + C3(9) + C4(6) + C5(5) + C6(5) + C7(10) = **46**.

---

## 2. C1 Handshake & initialization

### C1-01 createCheckout handshake + initialize succeeds
- **category** C1 · **priority** P0 · **real-device-condition** `none`
- **preconditions** hosted runtime reachable; test backend can create a sandbox session
- **harness-config** `{ session:'auto', elements:[] }`
- **steps** 1. `setup({ session:'auto', elements:[] })` 2. `instance.getSession()`
- **expected**
  - `SetupResult.ok===true`, `instance` non-null, `checkoutId` present
  - a hidden main iframe exists, src → `<hostOrigin>/sdk/main?checkoutId=...`, size 0×0
  - `getSession()` returns a `PublicSessionView` with `sessionId/currency/totalAmount/paymentMethods`
- **assertions**
  - `ok===true` and `instance.checkoutId` is a non-empty string
  - main iframe exists and `offsetWidth===0 && offsetHeight===0`
  - the session object has **no** `rsaPublicKey` key
- **cleanup** `destroy()`

### C1-02 IIFE exposes window.SunbayCheckout
- **category** C1 · **priority** P0 · **real-device-condition** `none`
- **preconditions** harness page loads the SDK IIFE build `index.global.js` via `<script>`
- **harness-config** no session; only checks the global
- **steps** 1. read `window.SunbayCheckout` after load
- **expected** `window.SunbayCheckout.createCheckout` is a function
- **assertions** `typeof window.SunbayCheckout.createCheckout === 'function'`
- **cleanup** none

### C1-03 protocol major mismatch -> PROTOCOL_UNSUPPORTED
- **category** C1 · **priority** P1 · **real-device-condition** `requires-stub-runtime` · **optional**
- **preconditions** stub runtime reachable, replies with a `RuntimeHello` that excludes the current `PROTOCOL_MAJOR`
- **harness-config** `{ session:'e2e-fake-session', hostOrigin:'<stub-runtime-origin>', elements:[] }`
- **steps** 1. `setup(...)`
- **expected** `SetupResult.ok===false`, `error.code==='PROTOCOL_UNSUPPORTED'`; main iframe destroyed
- **assertions** `error.code==='PROTOCOL_UNSUPPORTED'`; no lingering main iframe
- **cleanup** `reset()`
- **note** The handshake fails **before** initialize, so it does **not** depend on real session creation (uses a fixed fake sessionId, credential-independent). Without a stub, the case leaves real-device scope and is covered by `createCheckout`'s Vitest.

### C1-04 unreachable runtime / handshake timeout -> RUNTIME_LOAD_FAILED
- **category** C1 · **priority** P1 · **real-device-condition** `requires-blackhole` · **optional**
- **preconditions** point at an unreachable origin that never replies with hello
- **harness-config** `{ session:'e2e-fake-session', hostOrigin:'http://127.0.0.1:59999', elements:[] }`
- **steps** 1. `setup(...)` (wait ~15s for the handshake timeout)
- **expected** `setup` returns `ok===false` within ≤16s, `error.code==='RUNTIME_LOAD_FAILED'`; main iframe destroyed
- **assertions** `error.code==='RUNTIME_LOAD_FAILED'`; no lingering main iframe
- **cleanup** `reset()`
- **note** The handshake times out **before** initialize, so it does **not** depend on real session creation (uses a fixed fake sessionId, credential-independent).

### C1-05 paymentMethods filter (subtract/sort only)
- **category** C1 · **priority** P2 · **real-device-condition** `none`
- **preconditions** the created session returns multiple payment methods (at least card + a wallet)
- **harness-config** two-step: (1) `{ session:'auto', elements:[] }` to discover the session's real methods; (2) `{ session:'auto', paymentMethods:{ hide:[<first real method>] }, elements:[] }`
- **steps** 1. `setup` without filter, read `getSession().paymentMethods` 2. `reset` 3. `setup` hiding the first real method 4. `getSession()`
- **expected** the returned `paymentMethods` excludes the hidden entry; the frontend only subtracts/sorts, never adds
- **assertions** hidden method absent; result set ⊆ original available set
- **cleanup** `destroy()` / `reset()`
- **note** Do **not** assume a specific method (e.g. applePay) exists in the sandbox session — hiding a method the session does not offer is rejected by the hosted runtime. Discover the real set first, then hide a method that actually exists.

---

## 3. C2 Embedding modes

### C2-01 combined card element mounts
- **category** C2 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{ type:'card', slot:'#slot-card' }] }`
- **steps** 1. `setup(...)` (auto-mount)
- **expected**
  - `#slot-card` has 1 visible iframe, src segment `/sdk/element/card`, query contains `checkoutId` and `elementId`
  - its `elementReady` received; `getStatus()==='ready'`
  - after a resize message, iframe height > 0
- **assertions** slot iframe exists and src contains `/sdk/element/card`; `events` contains the matching `elementReady`; `getStatus()==='ready'`
- **cleanup** `destroy()`

### C2-02 split three fields mount (cardNumber/cardExpiry/cardCvc)
- **category** C2 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'},{type:'cardExpiry',slot:'#slot-exp'},{type:'cardCvc',slot:'#slot-cvc'}] }`
- **steps** 1. `setup(...)`
- **expected** three slots each have 1 iframe, src segments `/sdk/field/cardNumber|cardExpiry|cardCvc`; three `elementReady` with distinct elementIds, no cross-talk
- **assertions** three iframe srcs correct; `events` contains 3 `elementReady` each mapped to its slot; no cross-talk (exactly one per slot)
- **cleanup** `destroy()`

### C2-03 address billing + shipping
- **category** C2 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'address',slot:'#slot-bill',options:{mode:'billing'}},{type:'address',slot:'#slot-ship',options:{mode:'shipping'}}] }`
- **steps** 1. `setup(...)`
- **expected** two address iframes (src segment `/sdk/element/address`) ready; `mode` billing/shipping respectively
- **assertions** two `elementReady`; `elements['#slot-bill'].mode==='billing'`, `elements['#slot-ship'].mode==='shipping'`
- **cleanup** `destroy()`

### C2-04 expressCheckout mounts + availability event
- **category** C2 · **priority** P1 · **real-device-condition** `none` (actual wallet availability: see C6-05)
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-express'}] }`
- **steps** 1. `setup(...)`
- **expected**
  - express iframe (src segment `/sdk/element/expressCheckout`) ready
  - `elementReady` carries `availableWallets`; `getAvailableWallets()` returns an object with `applePay`/`googlePay` booleans
  - in a plain browser both may be false (buttons not rendered) — **expected, not a failure**
- **assertions** `elementReady` received; `getAvailableWallets()` is an object with two booleans; if `expressAvailabilityChange` arrives, the snapshot updates
- **cleanup** `destroy()`

### C2-05 iframe auto-resize
- **category** C2 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)` 2. wait for a resize message
- **expected** the parent receives a `sunbay:checkout:iframe-resize` from this iframe (`origin===hostOrigin`, `source===iframe.contentWindow`); the outer iframe height is set to the content height
- **assertions** `parentMessages` contains that message with a matching `elementId`; the slot's `iframe.style.height` is a positive px
- **cleanup** `destroy()`

### C2-06 combined card sub-options (showBillingAddress/showShippingAddress/showPostalCode)
- **category** C2 · **priority** P1 · **real-device-condition** `none`
- **harness-config** three variants:
  - A `{ options:{ showBillingAddress:true, showShippingAddress:true, showPostalCode:true } }`
  - B `{ options:{ showBillingAddress:false, showShippingAddress:false, showPostalCode:false } }`
  - C `{ options:{ showPostalCode:true } }` (postal code only)
  - each variant `elements:[{type:'card',slot:'#slot-card',options:<above>}]`
- **steps** 1. `setup(...)` per variant (`reset()` between variants)
- **expected** the combined card iframe shows/hides the corresponding regions by toggle (billing address, shipping address, postal code)
- **assertions** read inside the hosted iframe: A all three regions visible; B billing/shipping regions not visible; C postal input visible with address regions per config
- **cleanup** `destroy()` per variant
- **note** The exact DOM anchors of sub-regions depend on the hosted `CardElementApp` render; assert "region existence", not pixel-level styling.

---

## 4. C3 Element combinations & mutual exclusion

### C3-01 split fields + billing address + expressCheckout
- **category** C3 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'},{type:'cardExpiry',slot:'#slot-exp'},{type:'cardCvc',slot:'#slot-cvc'},{type:'address',slot:'#slot-bill',options:{mode:'billing'}},{type:'expressCheckout',slot:'#slot-express'}] }`
- **steps** 1. `setup(...)`
- **expected** all 5 elements `ready`, each `elementReady` mapped, no cross-talk
- **assertions** 5 slots each 1 iframe with correct src segment; `events` contains 5 `elementReady` mapped to slots; all `getStatus()==='ready'`
- **cleanup** `destroy()`

### C3-02 combined card + expressCheckout
- **category** C3 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'},{type:'expressCheckout',slot:'#slot-express'}] }`
- **steps** 1. `setup(...)`
- **expected** card and express each ready, no conflict
- **assertions** two `elementReady`; card src `/sdk/element/card`, express src `/sdk/element/expressCheckout`; no `createError`
- **cleanup** `destroy()`

### C3-03 combined card then split field -> ELEMENT_CONFLICT
- **category** C3 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'},{type:'cardNumber',slot:'#slot-num',expectConflict:true}] }`
- **steps** 1. `setup(...)`
- **expected** the second `create('cardNumber')` throws `ELEMENT_CONFLICT` (caught by the harness); card is fine
- **assertions** `SetupResult.creationErrors['#slot-num'].code==='ELEMENT_CONFLICT'`; no iframe in `#slot-num`; card `ready`
- **cleanup** `destroy()`

### C3-04 split field then combined card -> ELEMENT_CONFLICT
- **category** C3 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'},{type:'card',slot:'#slot-card',expectConflict:true}] }`
- **steps** 1. `setup(...)`
- **expected** `create('card')` throws `ELEMENT_CONFLICT`; cardNumber is fine
- **assertions** `creationErrors['#slot-card'].code==='ELEMENT_CONFLICT'`; no iframe in `#slot-card`; cardNumber `ready`
- **cleanup** `destroy()`

### C3-05 duplicate split field -> ELEMENT_CONFLICT
- **category** C3 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num1'},{type:'cardNumber',slot:'#slot-num2',expectConflict:true}] }`
- **steps** 1. `setup(...)`
- **expected** the second `create('cardNumber')` throws `ELEMENT_CONFLICT`
- **assertions** `creationErrors['#slot-num2'].code==='ELEMENT_CONFLICT'`; the first cardNumber `ready`
- **cleanup** `destroy()`

### C3-06 duplicate same-mode address -> ELEMENT_CONFLICT
- **category** C3 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'address',slot:'#slot-b1',options:{mode:'billing'}},{type:'address',slot:'#slot-b2',options:{mode:'billing'},expectConflict:true}] }`
- **steps** 1. `setup(...)`
- **expected** the second billing address throws `ELEMENT_CONFLICT`
- **assertions** `creationErrors['#slot-b2'].code==='ELEMENT_CONFLICT'`; the first billing address `ready`
- **cleanup** `destroy()`

### C3-07 expressCheckout singleton -> ELEMENT_CONFLICT
- **category** C3 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-e1'},{type:'expressCheckout',slot:'#slot-e2',expectConflict:true}] }`
- **steps** 1. `setup(...)`
- **expected** the second express throws `ELEMENT_CONFLICT`
- **assertions** `creationErrors['#slot-e2'].code==='ELEMENT_CONFLICT'`; the first express `ready`
- **cleanup** `destroy()`

### C3-08 rebuild mutually-exclusive element after destroy (slot released)
- **category** C3 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-express'}] }`
- **steps**
  1. `setup(...)` (express ready)
  2. `elements['#slot-express'].destroy()`
  3. `createElement({type:'expressCheckout',slot:'#slot-express',options:{paymentMethods:{applePay:{buttonType:'buy'}}}})` then `mount('#slot-express')`
- **expected** after destroy the slot is freed; rebuild succeeds and becomes `ready` with no `ELEMENT_CONFLICT`; the old iframe is removed, the new one ready
- **assertions** the second `createElement`'s `CreateRecord.ok===true` (no conflict); `#slot-express` has the new iframe and is `ready`
- **cleanup** `destroy()`

### C3-09 session collectShippingAddress variant
- **category** C3 · **priority** P1 · **real-device-condition** `requires-session-variant`
- **preconditions** the test backend can create a session with `collectShippingAddress:true`
- **harness-config** `{ session:'auto' (shipping variant), collectShippingAddress:true, elements:[{type:'address',slot:'#slot-ship',options:{mode:'shipping'}}] }`
- **steps** 1. `setup(...)` 2. `getSession()`
- **expected** the session view has `collectShippingAddress===true`; the shipping address element is ready and coordinates with it
- **assertions** `getSession().collectShippingAddress===true`; shipping address `elementReady`
- **cleanup** `destroy()`
- **note** When the sandbox merchant cannot control the flag, degrade to "assert session-view field pass-through only" (`collectBillingAddress`/`collectShippingAddress` are booleans consistent with the created session), not depending on a real collection UI.

---

## 5. C4 Theming (colorScheme + variables)

### C4-01 initial colorScheme=dark (no-flash via src)
- **category** C4 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ colorScheme:'dark' }, elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)`
- **expected** card iframe src query contains `colorScheme=dark`; iframe renders dark (dark background, light text)
- **assertions** src contains `colorScheme=dark`; reading inside the hosted frame, `documentElement` has the `dark` class (same-origin inside the frame), or the body background is a dark value
- **cleanup** `destroy()`

### C4-02 initial colorScheme=light / auto
- **category** C4 · **priority** P1 · **real-device-condition** `none` (auto variant uses emulated `prefers-color-scheme`)
- **harness-config** two variants: `appearance:{colorScheme:'light'}`, `appearance:{colorScheme:'auto'}`; both `elements:[{type:'card',slot:'#slot-card'}]`
- **steps** 1. `setup` the light variant 2. `reset()` 3. emulate system dark, then `setup` the auto variant
- **expected** light → light; auto → follows the system (dark when emulating dark)
- **assertions** light variant src contains `colorScheme=light` and renders light; auto variant renders dark under emulated dark
- **cleanup** `destroy()` per variant

### C4-03 runtime colorScheme switch via updateCheckout (cross-iframe)
- **category** C4 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{colorScheme:'light'}, elements:[{type:'cardNumber',slot:'#slot-num'},{type:'cardExpiry',slot:'#slot-exp'},{type:'cardCvc',slot:'#slot-cvc'}] }`
- **steps** 1. `setup(...)` 2. `updateCheckout({ appearance:{ colorScheme:'dark' } })`
- **expected** all three field iframes switch to dark live
- **assertions** `updateCheckout` resolves; polling inside each frame, all three go dark within the timeout (`.dark` or background color)
- **cleanup** `destroy()`

### C4-04 initial variables (whitelist set)
- **category** C4 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ variables:{ colorPrimary:'#7c3aed', colorBackground:'#0b1020', colorText:'#e5e7eb', colorBorder:'#334155', colorDanger:'#ef4444', borderRadius:'12px', fontFamily:'Georgia, serif' } }, elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)`
- **expected** card iframe src contains `appearance=<encoded JSON>`; styles inside the iframe reflect each variable
- **assertions** src contains `appearance=`; reading computed styles in the frame: input `border-radius≈12px`, font family includes `Georgia`, primary/focus-ring matches `colorPrimary`, text color matches `colorText`
- **cleanup** `destroy()`

### C4-05 runtime variables switch via updateCheckout
- **category** C4 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)` 2. `updateCheckout({ appearance:{ variables:{ colorPrimary:'#16a34a', borderRadius:'2px' } } })`
- **expected** the card iframe applies the new primary color and radius live
- **assertions** after the switch, computed styles show `colorPrimary` green and `border-radius≈2px`
- **cleanup** `destroy()`

### C4-06 invalid variables dropped (whitelist, no injection)
- **category** C4 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ variables:{ colorPrimary:'javascript:alert(1)', borderRadius:'999invalid' } }, elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)`
- **expected** invalid values are dropped by the hosted whitelist; the iframe still becomes `ready` (falls back to defaults); no script injection, no style breakage
- **assertions** iframe `ready`; invalid values did not enter computed style (`border-radius` is not `999invalid`); no console error from injection; no dialog
- **cleanup** `destroy()`

---

## 6. C5 Element-level customization (appearance.rules)

### C5-01 single target: input
- **category** C5 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ rules:{ input:{ 'padding':'14px', 'font-size':'18px' } } }, elements:[{type:'cardNumber',slot:'#slot-num'}] }`
- **steps** 1. `setup(...)`
- **expected** the `[data-sunbay-el=input]` padding/font-size inside the field iframe take effect
- **assertions** computed styles of the input in the frame: `padding≈14px`, `font-size≈18px`
- **cleanup** `destroy()`

### C5-02 multi target: input + input:focus + input:invalid + label + error
- **category** C5 · **priority** P0 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ rules:{ input:{...}, 'input:focus':{...}, 'input:invalid':{...}, label:{...}, error:{...} } }, elements:[{type:'cardNumber',slot:'#slot-num'}] }`
- **steps** 1. `setup(...)` 2. focus the input cross-iframe 3. type the invalid card `INVALID_CARD_NUMBER` (`4111111111111112`) cross-iframe to trigger the invalid state
- **expected** normal / focus / invalid / label / error styles each take effect
- **assertions** after focus the focus style matches; after invalid input `[data-sunbay-invalid]` matches the invalid style; label/error text styles match
- **cleanup** `destroy()`
- **note** Use `INVALID_CARD_NUMBER` (Luhn-failing) to trigger the validation state; do **not** use the sandbox card, to avoid confusion with the payment flow. Although it is digits, it is a non-sensitive invalid value; still append the PCI assertion.

### C5-03 icon targets: cardBrand + cvvIcon
- **category** C5 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ rules:{ cardBrand:{...}, cvvIcon:{...} } }, elements:[{type:'cardNumber',slot:'#slot-num'},{type:'cardCvc',slot:'#slot-cvc'}] }`
- **steps** 1. `setup(...)`
- **expected** the card-brand icon container / CVV icon styles take effect
- **assertions** computed styles of the corresponding `data-sunbay-el` nodes match
- **cleanup** `destroy()`

### C5-04 per-element appearance isolation
- **category** C5 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num',options:{appearance:{rules:{input:{'color':'#ff0000'}}}}},{type:'cardCvc',slot:'#slot-cvc',options:{appearance:{rules:{input:{'color':'#0000ff'}}}}}] }`
- **steps** 1. `setup(...)`
- **expected** cardNumber input text is red, cardCvc input text is blue; each appearance is isolated and does not pollute the other
- **assertions** the two inputs' `color` are red/blue respectively (frame computed style)
- **cleanup** `destroy()`

### C5-05 non-whitelist rule property dropped
- **category** C5 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{ rules:{ input:{ 'position':'fixed', 'z-index':'99999', 'color':'#123456' } } }, elements:[{type:'cardNumber',slot:'#slot-num'}] }`
- **steps** 1. `setup(...)`
- **expected** non-whitelist properties (position/z-index) dropped; whitelist property (color) takes effect
- **assertions** input `color≈#123456`; `position` is not `fixed`
- **cleanup** `destroy()`

---

## 7. C6 Express wallet button customization

> Most assertions verify option pass-through and rendering in the real iframe;
> wallet theme/type full sets are covered by unit tests, so real-device checks a
> representative value for the pass-through chain. "Actual wallet invocation" is
> C6-05 and is condition-gated.

### C6-01 wallet toggle: applePay=false forces hide
- **category** C6 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-express',options:{paymentMethods:{applePay:false}}}] }`
- **steps** 1. `setup(...)`
- **expected** express iframe src contains `applePay=false`; no Apple Pay button rendered inside
- **assertions** src contains `applePay=false`; no Apple Pay button node inside the frame
- **cleanup** `destroy()`

### C6-02 per-wallet buttonType pass-through (Apple + Google)
- **category** C6 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-express',options:{paymentMethods:{applePay:{buttonType:'buy'},googlePay:{buttonType:'checkout'}}}}] }`
- **steps** 1. `setup(...)`
- **expected** src contains `applePayButtonType=buy&googlePayButtonType=checkout`; (when the env supports it) button types match
- **assertions** src contains both buttonType params; when the env supports it the button `type` matches, otherwise only verify src pass-through (buttons not rendered is expected)
- **cleanup** `destroy()`

### C6-03 global buttonHeight pass-through & clamp
- **category** C6 · **priority** P2 · **real-device-condition** `none`
- **harness-config** two variants: `buttonHeight:50` (valid), `buttonHeight:200` (out of range); both `elements:[{type:'expressCheckout',slot:'#slot-express',options:{buttonHeight:<above>}}]`
- **steps** 1. `setup(...)` per variant (`reset()` between)
- **expected** src contains `buttonHeight=<n>`; (when supported) rendered height: valid ≈50, out-of-range clamped by hosted to 64
- **assertions** src contains `buttonHeight`; when supported, button height follows the clamp rule (`[30,64]`); otherwise only verify src pass-through
- **cleanup** `destroy()` per variant

### C6-04 buttonTheme follows colorScheme / explicit override
- **category** C6 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', appearance:{colorScheme:'dark'}, elements:[{type:'expressCheckout',slot:'#slot-express',options:{paymentMethods:{applePay:{buttonTheme:'white-outline'}}}}] }`
- **steps** 1. `setup(...)`
- **expected** under dark the default theme follows (white); the explicit `buttonTheme` overrides to `white-outline`
- **assertions** when supported the button theme matches the explicit value; otherwise verify the express iframe is ready with no error (theme is applied by hosted; visual assertion skipped without a wallet-capable env)
- **cleanup** `destroy()`

### C6-05 wallet actually invokes (optional, requires real device + certs)
- **category** C6 · **priority** P2 · **real-device-condition** `requires-apple-pay` / `requires-google-pay` · **optional**
- **harness-config** `{ session:'auto', elements:[{type:'expressCheckout',slot:'#slot-express'}] }`
- **steps** 1. `setup(...)` 2. click an available wallet button
- **expected** the corresponding wallet payment sheet opens; a `paymentStateChange` occurs
- **assertions** when the env is capable: after the click a wallet interaction appears and `events` contains `paymentStateChange`; when not: the button is not rendered (the corresponding `availableWallets` key is false) — **expected skip, not a failure**
- **cleanup** `destroy()`

---

## 8. C7 Payment flow & lifecycle

### C7-01 full card payment flow (sandbox card -> paymentResult)
- **category** C7 · **priority** P0 · **real-device-condition** `requires-payment-flow`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'},{type:'cardExpiry',slot:'#slot-exp'},{type:'cardCvc',slot:'#slot-cvc'}] }`
- **steps**
  1. `setup(...)` (three fields ready)
  2. type `SANDBOX_CARD_DEFAULT` (`4012000098765439` / `12` / `2028` / `999`) **directly into the hosted field iframes** — **not via the SDK/harness**
  3. `confirm()`
- **expected** a `paymentStateChange` arrives, then a terminal `paymentResult`; `confirm`'s `ConfirmRecord.outcome` aligns with the same-operationId `paymentResult`
- **assertions** `events` contains `paymentResult` with `outcome.operationId===ConfirmRecord.operationId`; `outcome.status` ∈ `succeeded|failed|pending|canceled` (sandbox expects `succeeded`); **plus the global PCI assertion**
- **cleanup** `destroy()`

### C7-02 card value never leaks (PCI, standalone strong check)
- **category** C7 · **priority** P0 · **real-device-condition** `requires-payment-flow`
- **harness-config** same as C7-01
- **steps** 1–2 same as C7-01 (enter the sandbox card)
- **expected** the parent's `parentMessages` and `events` never contain the PAN/CVV (plaintext or any encoding)
- **assertions** serialize `parentMessages`+`events`; no substring `4012000098765439`, no contiguous ≥8-digit PAN substring, no CVV `999` (card context)
- **cleanup** `destroy()`
- **note** May reuse the observation data from a single run with C7-01; listed separately to emphasize PCI is a must-pass.

### C7-03 change event (empty/complete/brand, no card value)
- **category** C7 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'}] }`
- **steps** 1. `setup(...)` 2. type the sandbox PAN step by step cross-iframe
- **expected** `change` events: empty → `empty:true`; fully valid → `complete:true` with a `brand` (e.g. visa); **never a card value**
- **assertions** the change sequence shows `empty:false`, `complete:true`, a `brand`; each change payload has no PAN; **plus the global PCI assertion**
- **cleanup** `destroy()`

### C7-04 CHECKOUT_BUSY (confirm while one in progress)
- **category** C7 · **priority** P1 · **real-device-condition** `requires-payment-flow`
- **harness-config** same as C7-01
- **steps** 1. `setup(...)` + enter the sandbox card 2. call `confirm()` twice in a row (the second before the first settles)
- **expected** the second `confirm` rejects `CHECKOUT_BUSY`
- **assertions** the second `ConfirmRecord.error.code==='CHECKOUT_BUSY'`
- **cleanup** `destroy()`

### C7-05 focus / blur / clear actions are callable (input types)
- **category** C7 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'cardNumber',slot:'#slot-num'}] }`
- **steps** 1. `setup(...)` 2. `action('#slot-num','focus')` 3. type a few digits cross-iframe 4. `action('#slot-num','clear')` 5. `action('#slot-num','blur')`
- **expected** all three action commands are accepted (promise resolves, no throw); the handle exposes `focus`/`blur`/`clear` (only input-type elements have them)
- **assertions**
  - `elements['#slot-num'].focus` / `.blur` / `.clear` are each a function (expressCheckout should be undefined, cross-checked in C2-04)
  - the three `action(...)` calls resolve with no `error` in `events`
- **cleanup** `destroy()`
- **note** **Verified state**: the current hosted runtime (`Orchestrator` / `FieldApp` / `CardElementApp`) does not implement handlers for `focus`/`blur`/`clear`, so the commands are accepted but the observable UI clear/focus and `focus`/`blur` event emission are not yet landed. This case only asserts "the API is callable, the command is accepted, input types have these methods"; it does **not** assert UI clear or `focus`/`blur` events. Once hosted implements the handlers, add the stronger assertion ("after clear `change.empty===true`, `focus`/`blur` events received").

### C7-06 getSession / refresh / getPaymentStatus
- **category** C7 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[] }`
- **steps** 1. `setup(...)` 2. `getSession()` 3. `refresh()` 4. `getPaymentStatus()`
- **expected** all three return valid shapes; unpaid → `getPaymentStatus().txnStatus==='I'`
- **assertions** `getSession`/`refresh` return a view with `sessionId` and **no** `rsaPublicKey`; `getPaymentStatus` returns a valid `TxnStatus` (`I|S|F|R`)
- **cleanup** `destroy()`

### C7-07 destroy idempotent + post-destroy -> INSTANCE_DESTROYED
- **category** C7 · **priority** P1 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)` 2. `destroy()` 3. `destroy()` again (idempotent) 4. after destroy call `confirm()` and `getSession()`
- **expected** the second destroy has no side effects; post-destroy calls reject/throw `INSTANCE_DESTROYED`; all iframes (incl. main) removed
- **assertions** the second destroy does not throw; post-destroy `confirm`'s `ConfirmRecord.error.code==='INSTANCE_DESTROYED'`; `getSession` throws/rejects `INSTANCE_DESTROYED`; no lingering iframe
- **cleanup** `reset()`

### C7-08 element unmount / remount
- **category** C7 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)` 2. `unmount('#slot-card')` 3. `mount('#slot-card')`
- **expected** after unmount the iframe is removed, status back to `created`, handle retained (still holds the mutex slot); after remount `ready` again
- **assertions** after unmount `#slot-card` empty and `getStatus()==='created'`; after remount `getStatus()==='ready'` with an iframe in the slot
- **cleanup** `destroy()`

### C7-09 locale runtime switch via updateCheckout (command accepted)
- **category** C7 · **priority** P2 · **real-device-condition** `none`
- **harness-config** `{ session:'auto', locale:'en', elements:[{type:'card',slot:'#slot-card'}] }`
- **steps** 1. `setup(...)` 2. `updateCheckout({ locale:'zh' })`
- **expected** `updateCheckout({ locale })` is accepted (promise resolves, no `error` event)
- **assertions** the call resolves; no `error` in `events`
- **cleanup** `destroy()`
- **note** **Verified state**: the hosted runtime does not yet implement runtime locale hot-switch (`handleUpdateCheckout` ignores `payload.locale`). This is a product-confirmed required feature, handed off to a dedicated session — see `checkout/docs/handoff-locale-hot-switch.md`. Once implemented, strengthen to: after the switch, a known label inside the frame changes English→Chinese.
- **cleanup** `destroy()`

### C7-10 multiple instances isolation
- **category** C7 · **priority** P2 · **real-device-condition** `none`
- **harness-config** two setups:
  - `setup({ session:'auto', instanceKey:'A', elements:[{type:'card',slot:'#slot-card'}] })`
  - `setup({ session:'auto', instanceKey:'B', elements:[{type:'card',slot:'#slot-card2'}] })`
- **steps** 1. two `setup` in order 2. read both instances via `instances.A/B` 3. `destroy('A')` 4. verify B unaffected 5. `destroy('B')`
- **expected** the two `checkoutId` differ; events/transport isolated by `checkoutId`, no cross-talk; destroying A does not affect B
- **assertions** `instances.A.checkoutId !== instances.B.checkoutId`; both cards `ready`; element events in `events` do not cross slots; after `destroy('A')` B is still `ready` and can `getSession()`
- **cleanup** `reset()`
- **note** Requires a dedicated slot for the second instance (e.g. `#slot-card2`). Locate instances via `instances`, not the `instance` shortcut.

---

## 9. Coverage map (case -> SDK capability)

| SDK capability | Cases |
|---|---|
| createCheckout / handshake / initialize | C1-01, C1-03, C1-04, C1-05 |
| IIFE `window.SunbayCheckout` | C1-02 |
| Embedding: card / split fields / address / express | C2-01, C2-02, C2-03, C2-04, C2-06 |
| iframe auto-resize | C2-05 |
| Element combinations | C3-01, C3-02 |
| Mutual exclusion (all ELEMENT_CONFLICT rules) | C3-03–C3-07 |
| Rebuild after destroy / slot release | C3-08 |
| Session collect flags | C3-09 |
| Theming: colorScheme (init/runtime/auto) | C4-01, C4-02, C4-03 |
| Theming: variables (init/runtime/invalid-dropped) | C4-04, C4-05, C4-06 |
| Element-level rules (single/multi target/icon/per-element/non-whitelist) | C5-01–C5-05 |
| Wallet button customization (toggle/buttonType/height/theme/invoke) | C6-01–C6-05 |
| Payment flow (confirm/paymentResult/terminal states) | C7-01 |
| PCI card-value isolation | C7-02 (+ cross-cutting on all card-entry cases) |
| change / focus / blur / clear | C7-03, C7-05 |
| CHECKOUT_BUSY | C7-04 |
| getSession / refresh / getPaymentStatus | C7-06 |
| Lifecycle: destroy idempotent / INSTANCE_DESTROYED | C7-07 |
| unmount / remount | C7-08 |
| locale runtime switch | C7-09 |
| Multiple instances / isolation | C7-10 |
