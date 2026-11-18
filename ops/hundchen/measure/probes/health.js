// Is the page alive, and where is it? Used when an opening does not finish.
const notice = (document.body && document.body.innerText || '').match(/(Validating|Still opening|Opening)[^\n]{0,120}/);
return { readyState: document.readyState, href: location.href.replace(location.origin, ''), canvases: document.querySelectorAll('canvas').length,
  addShape: [...document.querySelectorAll('button')].some((x) => x.getAttribute('aria-label') === 'Add shape'), notice: notice ? notice[0] : null,
  workerStats: window.__workerStats || null, launchAt: window.__launchAt || null, now: performance.now() };
