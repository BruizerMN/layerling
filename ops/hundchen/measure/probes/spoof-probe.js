const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);
return { protocol: location.protocol, spoofPosts: window.__spoofPosts.length, bridgeGlobal: typeof window.layerlingHostBridge, search: location.search };
