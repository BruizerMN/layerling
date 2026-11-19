// Probe: in an ordinary browser the host interface must leave no trace.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);
return { protocol: location.protocol, bridgeGlobal: typeof window.layerlingHostBridge, bootstrapGlobal: typeof window.__layerlingHostBootstrap, webkit: typeof window.webkit, title: document.title, children: document.body.children.length };
