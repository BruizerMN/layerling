"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { subscribeBackgrounds } from "@/lib/host/viewportBackgrounds";
import { currentLogo, type LogoPosition } from "@/lib/host/presentationLogo";

/**
 * The Organization Logo in Presentation Mode (Build 0022): a corner watermark over the viewport, or - on the standby screen - the large centred logo. It lives in the
 * viewport (.workplane-stage), so margins are the viewport's, not the window's or the footer's; it never takes a mouse or gesture event; the image keeps its own
 * aspect ratio and transparency (object-fit: contain, never cropped). No logo, or one that cannot be read, shows nothing. It is a view only: no document, no dirty state.
 */
const CORNER: Record<LogoPosition, CSSProperties> = {
  topLeft: { top: 20, left: 20 },
  topRight: { top: 20, right: 20 },
  bottomLeft: { bottom: 20, left: 20 },
  bottomRight: { bottom: 20, right: 20 },
};

export function PresentationLogo({ standby }: { standby: boolean }) {
  const [, setTick] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => subscribeBackgrounds(() => setTick((tick) => tick + 1)), []);
  const logo = currentLogo();
  if (!logo.url || failed === logo.url) return null;
  const common: CSSProperties = { position: "absolute", pointerEvents: "none", userSelect: "none", objectFit: "contain", zIndex: 3 };
  const style: CSSProperties = standby
    ? { ...common, left: "50%", top: "50%", transform: "translate(-50%, -50%)", maxWidth: "min(720px, 60%)", maxHeight: "min(480px, 50%)", opacity: 1 }
    : { ...common, ...CORNER[logo.position], maxWidth: "min(200px, 18%)", maxHeight: "min(110px, 16%)", opacity: logo.opacity };
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="presentation-logo" data-presentation-logo={standby ? "standby" : logo.position} src={logo.url} alt="" draggable={false} style={style} onError={() => setFailed(logo.url)} />
  );
}
