// One identifiable edit (a Box dropped at a new spot each call) plus main-thread responsiveness for 15 s afterwards.
// Records: time to the "Box added" notice, rAF gaps (jank), writes of the working copy (localStorage project list, IndexedDB).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!window.__probeHooks) {
  window.__probeHooks = true; window.__puts = []; window.__projectWrites = [];
  const sp = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k) { if (k === 'layerling.projects') window.__projectWrites.push(performance.now()); return sp.apply(this, arguments); };
  const op = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { try { if (this.name === 'projectShapes') window.__puts.push(performance.now()); } catch (e) {} return op.apply(this, arguments); };
}
const gaps = []; let last = performance.now(); let run = true;
const loop = (t) => { gaps.push([t, t - last]); last = t; if (run) requestAnimationFrame(loop); };
requestAnimationFrame(loop);
const find = (l) => [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.title || x.innerText || '').trim() === l);
const n = (window.__editN = (window.__editN || 0) + 1);
find('Add shape').click(); await sleep(800); find('Box').click(); await sleep(600);
const c = document.querySelector('canvas'); const b = c.getBoundingClientRect();
const x = b.left + b.width * (0.06 + 0.05 * n), y = b.top + b.height * 0.86;
const ev = (t, T = PointerEvent) => c.dispatchEvent(new T(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: t.endsWith('up') ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
let tNotice = null;
const mo = new MutationObserver((ms) => { for (const m of ms) { if (tNotice === null && (m.type === 'characterData' || m.type === 'childList') && (m.target.textContent || '').length < 100 && /Box added/.test(m.target.textContent || '')) tNotice = performance.now(); } });
mo.observe(document.body, { subtree: true, characterData: true, childList: true });
ev('pointermove'); await sleep(200);
const tClick = performance.now(); ev('pointerdown'); ev('mousedown', MouseEvent); await sleep(100); ev('pointerup'); ev('mouseup', MouseEvent); ev('click', MouseEvent);
window.__lastClickPerf = tClick;
await sleep(15000); run = false; mo.disconnect();
const after = gaps.filter((g) => g[0] >= tClick).map((g) => g[1]);
const over = (ms) => after.filter((g) => g > ms);
return { edit: n, tClickPerf: tClick, launchAtPerf: window.__launchAt, noticeMs: tNotice === null ? null : Math.round(tNotice - tClick),
  frames: after.length, maxFrameGapMs: Math.round(Math.max(0, ...after)), blockedMsOver100: Math.round(over(100).reduce((a, b) => a + b, 0)), framesOver250: over(250).length,
  firstProjectWriteMs: (window.__projectWrites.find((t) => t >= tClick) ?? null) === null ? null : Math.round(window.__projectWrites.find((t) => t >= tClick) - tClick),
  firstIdbPutMsSoFar: (window.__puts.find((t) => t >= tClick) ?? null) === null ? null : Math.round(window.__puts.find((t) => t >= tClick) - tClick) };
