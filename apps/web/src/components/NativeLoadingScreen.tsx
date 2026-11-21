"use client";

import { useState } from "react";
import { formatBytes, loadingLabel, measuredFraction, useLoadingState } from "../lib/host/nativeLoading";

/**
 * The loading screen of a native document window (Build 0014): shown by NativeDocumentShell from the first paint until the editor is on screen.
 * Deep navy with a quiet electric-blue accent, taken from the Welcome artwork; always dark, whatever the application theme is. It is not part of the
 * browser edition (the shell only exists in the native app).
 *
 * Progress: a percentage and a filled bar are shown ONLY for the stage that can be measured (reading the file: bytes of bytes). Every other stage gets a
 * slim indeterminate indicator and its name. The content fades in after a short pause so a document that opens at once never flashes this screen.
 */
const STYLE = `
.native-loading { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; overflow: hidden;
  color: rgba(255,255,255,.94); background: #000926 radial-gradient(ellipse 70% 55% at 50% 40%, #052056 0%, #02123a 45%, #000926 100%);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing: antialiased; user-select: none; cursor: default; }
.native-loading-card { display: grid; justify-items: center; width: min(420px, 78vw); margin-top: -6vh; opacity: 0; animation: native-loading-in 320ms ease-out 350ms forwards; }
.native-loading-mark { width: 54px; height: 54px; margin-bottom: 22px; color: #4da3ff; }
/* Levi, from the approved Welcome artwork (a crop the host serves from its bundle), at about the size he has in the Welcome window. The mask only lets the crop's
   edges melt into this background; nothing of him or his platform is faded. */
.native-loading-levi { display: block; width: min(268px, 66vw); height: auto; max-height: 30vh; margin: -8px 0 4px; object-fit: contain;
  -webkit-mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, #000 70%, transparent 100%); mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, #000 70%, transparent 100%); }
.native-loading h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: .01em; }
.native-loading-name { box-sizing: border-box; max-width: 100%; min-height: 20px; margin-top: 6px; padding: 0 4px; overflow: hidden; color: rgba(255,255,255,.72); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.native-loading-bar { position: relative; width: 100%; height: 4px; margin-top: 26px; overflow: hidden; background: rgba(120,170,255,.16); border-radius: 2px; }
.native-loading-fill { position: absolute; inset: 0 auto 0 0; background: #4da3ff; border-radius: 2px; transition: width 160ms linear; }
.native-loading-sweep { position: absolute; top: 0; bottom: 0; width: 34%; background: linear-gradient(90deg, rgba(77,163,255,0), #4da3ff 50%, rgba(77,163,255,0)); border-radius: 2px; animation: native-loading-sweep 1.5s ease-in-out infinite; }
.native-loading-status { display: flex; justify-content: space-between; gap: 12px; width: 100%; margin-top: 12px; color: rgba(255,255,255,.62); font-size: 12px; }
.native-loading-status span:last-child { font-variant-numeric: tabular-nums; text-align: right; }
@keyframes native-loading-in { to { opacity: 1; } }
@keyframes native-loading-sweep { from { left: -34%; } to { left: 100%; } }
@media (prefers-reduced-motion: reduce) { .native-loading-sweep { left: 33%; animation: none; opacity: .7; } }
`;

/** Once Levi has been fetched, a later copy of the screen (a new element at each stage) shows him at once. */
let leviReady = false;

export function NativeLoadingScreen() {
  const state = useLoadingState();
  const fraction = measuredFraction(state);
  const label = loadingLabel(state.stage);
  const percent = fraction === null ? null : Math.round(fraction * 100);
  // The screen is replaced by itself as the shell moves from stage to stage (a new element each time): the fade-in belongs to the page's first moments only, measured
  // from the page's start, so a later arrival shows at once instead of fading in again.
  const [leviFailed, setLeviFailed] = useState(false);
  const [leviLoaded, setLeviLoaded] = useState(leviReady);
  const elapsed = typeof performance === "undefined" ? 0 : performance.now();
  const cardStyle = {
    ...(elapsed >= 700 ? { animation: "none", opacity: 1 } : { animationDelay: `${Math.max(0, Math.round(350 - elapsed))}ms` }),
    // The card appears with Levi in it (a picture arriving after the text would pop in), or without him if he cannot be fetched.
    visibility: leviLoaded || leviFailed ? ("visible" as const) : ("hidden" as const),
  };
  return (
    <main className="native-loading" role="status" aria-live="polite" aria-label="Loading Project">
      <style>{STYLE}</style>
      <div className="native-loading-card" style={cardStyle}>
        {leviFailed ? (
          <svg className="native-loading-mark" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
            <path d="M24 5 43 15 24 25 5 15Z" opacity=".55" />
            <path d="M5 23 24 33 43 23" opacity=".8" />
            <path d="M5 31 24 41 43 31" />
          </svg>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="native-loading-levi" src="/__host__/art/loading-levi.jpg" width={268} height={200} alt="" aria-hidden="true" draggable={false} onLoad={() => { leviReady = true; setLeviLoaded(true); }} onError={() => setLeviFailed(true)} />
        )}
        <h1>Loading Project...</h1>
        <div className="native-loading-name" title={state.name ?? undefined}>{state.name ?? ""}</div>
        <div
          className="native-loading-bar"
          role="progressbar"
          aria-label={label}
          aria-valuemin={percent === null ? undefined : 0}
          aria-valuemax={percent === null ? undefined : 100}
          aria-valuenow={percent === null ? undefined : percent}
          aria-valuetext={percent === null ? label : `${label} ${percent}%`}
        >
          {fraction === null ? <div className="native-loading-sweep" /> : <div className="native-loading-fill" style={{ width: `${(fraction * 100).toFixed(1)}%` }} />}
        </div>
        <div className="native-loading-status">
          <span>{label}</span>
          <span>{percent === null ? "" : `${percent}%${state.total ? ` · ${formatBytes(state.loaded ?? 0)} of ${formatBytes(state.total)}` : ""}`}</span>
        </div>
      </div>
    </main>
  );
}
