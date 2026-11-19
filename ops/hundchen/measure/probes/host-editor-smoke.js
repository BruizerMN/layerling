// Interactive smoke test for DEBUG builds only (--smoke --smoke-script this-file): create a design, add a Box, confirm the editor responds.
// Test tooling, not an integration mechanism: it drives the web UI the way a user would, and nothing in the app depends on it.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (l) => [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.title || x.innerText || '').trim() === l);
const q = (s) => document.querySelector(s);
const out = { title: document.title };
find('Create new 3D design').click();
const t0 = performance.now();
while (!(q('canvas') && find('Add shape')) && performance.now() - t0 < 60000) await sleep(200);
out.editorReady = !!(q('canvas') && find('Add shape'));
out.editorMs = Math.round(performance.now() - t0);
find('Add shape').click(); await sleep(800); find('Box').click(); await sleep(600);
const c = q('canvas'); const b = c.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2;
const ev = (t, T = PointerEvent) => c.dispatchEvent(new T(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: t.endsWith('up') ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
ev('pointermove'); await sleep(200); ev('pointerdown'); ev('mousedown', MouseEvent); await sleep(100); ev('pointerup'); ev('mouseup', MouseEvent); ev('click', MouseEvent);
await sleep(2500);
out.boxPlaced = /Box/.test(document.body.innerText);
out.undoEnabled = !!(find('Undo') && !find('Undo').disabled);
out.canvases = document.querySelectorAll('canvas').length;
return out;
