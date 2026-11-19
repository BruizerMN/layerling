const t = (document.body.innerText || '').match(/(Validating|Still opening|Opening)[^\n]{0,110}/);
const w = window.__workerStats || {};
return { now: Math.round(performance.now()), notice: t ? t[0].replace(/\d+ s\b/, 'N s') : null, canvas: !!document.querySelector('canvas'), vis: document.visibilityState, blobCreated: w.blobCreated, blobAlive: w.blobAlive };
