"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ComponentType, CSSProperties, SVGProps } from "react";
import { currentRibbonIcons, ribbonIconKey, subscribeRibbonIcons } from "@/lib/host/ribbonIcons";

/**
 * The icon of a ribbon tool (Build 0024). Without external artwork it is the editor's own icon component, exactly as before. With a valid SVG for the tool's key (the
 * host has validated it and serves it only as an image) it is a single-colour mask of that artwork: the shape comes from the file, the colour from `currentColor`, so
 * every theme, hover, disabled and selected state of the ribbon applies unchanged. Until the file has actually loaded, and whenever it cannot be loaded, the
 * original icon is shown: a button is never blank.
 */
export function RibbonToolIcon({ id, Icon }: { id: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }) {
  const icons = useSyncExternalStore(subscribeRibbonIcons, currentRibbonIcons, currentRibbonIcons);
  const url = icons[ribbonIconKey(id)] ?? null;
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setShown(null);
      return;
    }
    let live = true;
    const image = new Image();
    image.onload = () => { if (live) setShown(url); };
    image.onerror = () => { if (live) setShown(null); };
    image.src = url;
    return () => { live = false; };
  }, [url]);
  if (url && shown === url) {
    return <span className="toolbar-vector-art-icon ribbon-icon-override" data-ribbon-icon="external" aria-hidden="true" style={{ "--ribbon-icon": `url("${url}")` } as CSSProperties} />;
  }
  return <Icon />;
}
