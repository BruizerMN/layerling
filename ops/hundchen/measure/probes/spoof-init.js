// A hostile or curious page environment: fake the native host's objects on an http origin. The editor must not take the bait.
window.__spoofPosts = [];
Object.defineProperty(window, "__layerlingHostBootstrap", { value: { host: { name: "Fake", version: "9" }, protocol: { min: 1, max: 1 }, session: "spoofed-session-0001" }, configurable: true });
window.webkit = { messageHandlers: { layerlingHost: { postMessage: (m) => { window.__spoofPosts.push(m); return Promise.resolve({}); } } } };
