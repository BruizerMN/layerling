// Waits (up to 150 s) for the next IndexedDB working-copy write after the last edit; returns its lag. (Only meaningful in the current web app: it is the full-project repack.)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const since = window.__lastEditClick || 0;
const t0 = performance.now(); let hit = null;
while (performance.now() - t0 < 150000) { hit = (window.__puts || []).find((t) => t >= (window.__lastClickPerf || 0)); if (hit) break; await sleep(250); }
return { waitedMs: Math.round(performance.now() - t0), idbPutAfterClickMs: hit ? Math.round(hit - (window.__lastClickPerf || 0)) : null };
