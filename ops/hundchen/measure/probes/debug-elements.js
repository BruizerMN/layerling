// Reports the diagnostic DOM mirrors (data-codex-*): presence and size. Run in the editor page.
const q = (s) => document.querySelector(s);
const len = (e) => (e ? e.textContent.length : null);
return { state_chars: len(q('pre[data-codex-state]')), summary_chars: len(q('pre[data-codex-summary]')), projects_chars: len(q('pre[data-codex-projects]')),
  flag: (() => { try { return localStorage.getItem('layerling.debugState'); } catch (e) { return 'n/a'; } })(), search: location.search };
