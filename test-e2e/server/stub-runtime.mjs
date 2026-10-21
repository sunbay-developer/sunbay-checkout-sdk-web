// @ts-nocheck
/**
 * Optional stub runtime — ONLY for case C1-03 (PROTOCOL_UNSUPPORTED).
 *
 * Serves a fake `/sdk/main` page that, once loaded, broadcasts a RuntimeHello whose
 * `supportedMajorVersions` deliberately EXCLUDES the SDK's current PROTOCOL_MAJOR (1).
 * createCheckout then finds no common major version and rejects with PROTOCOL_UNSUPPORTED,
 * which is exactly what C1-03 verifies.
 *
 * This stub never touches card data and is not part of any published artifact.
 * Start it on its own origin (default :8099) and point the harness at it via
 * `hostOrigin` in the setup config (or E2E_STUB_ORIGIN).
 *
 * Node 18+ (zero deps):  node server/stub-runtime.mjs
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 8099);

/**
 * Fake main page HTML. On load it posts a RuntimeHello to window.parent with an
 * incompatible major version set. The real SDK's MainFrameTransport recognizes a
 * message as hello via { protocol:'sunbay-checkout', kind:'hello' } and reads
 * supportedMajorVersions.
 */
const FAKE_MAIN_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>stub runtime main</title></head>
  <body>
    <script>
      // Broadcast an intentionally-incompatible hello. '*' targetOrigin is fine:
      // the parent (SDK transport) filters by event.origin === hostOrigin, which
      // is this stub's origin, so it is accepted and parsed as hello.
      var hello = {
        protocol: 'sunbay-checkout',
        kind: 'hello',
        runtimeId: 'stub-runtime',
        supportedMajorVersions: [999],
        capabilities: []
      };
      try { window.parent.postMessage(JSON.stringify(hello), '*'); } catch (e) {}
    </script>
  </body>
</html>`;

const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, stub: true }));
        return;
    }
    if (path === '/sdk/main') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(FAKE_MAIN_HTML);
        return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', path }));
});

server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
        [
            '',
            '  Checkout SDK e2e STUB runtime started (PROTOCOL_UNSUPPORTED only)',
            `  fake main: http://localhost:${PORT}/sdk/main (broadcasts incompatible hello)`,
            `  healthz:   http://localhost:${PORT}/healthz`,
            '',
        ].join('\n')
    );
});
