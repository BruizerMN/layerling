"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ComponentType, CSSProperties, ReactNode, SVGProps } from "react";
import { currentRibbonIcons, ribbonIconKey, subscribeRibbonIcons } from "@/lib/host/ribbonIcons";

/**
 * Ribbon icons with optional external artwork (Builds 0024 and 0025). Without a file for the icon's canonical key the editor's own icon is drawn, exactly as before. With
 * a valid SVG (the host has validated it and serves it only as an image) it is a single-colour mask of that artwork: the shape comes from the file, the colour from
 * `currentColor`, so every theme, hover, disabled and selected state of the ribbon applies unchanged. Until the file has actually loaded, and whenever it cannot be
 * loaded, the original stays: a button is never blank. Each icon looks only at its own key, so one file never changes another icon.
 */
function useExternalArtwork(key: string): string | null {
  const icons = useSyncExternalStore(subscribeRibbonIcons, currentRibbonIcons, currentRibbonIcons);
  const url = icons[key] ?? null;
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
  return url && shown === url ? url : null;
}

function ExternalIcon({ url, iconKey }: { url: string; iconKey: string }) {
  return <span className="toolbar-vector-art-icon ribbon-icon-override" data-ribbon-icon="external" data-ribbon-icon-key={iconKey} aria-hidden="true" style={{ "--ribbon-icon": `url("${url}")` } as CSSProperties} />;
}

/** The icon of a ribbon tool, by the tool's id (aliases such as `sketch-copy` map to their canonical key). */
export function RibbonToolIcon({ id, Icon }: { id: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }) {
  const key = ribbonIconKey(id);
  const url = useExternalArtwork(key);
  return url ? <ExternalIcon url={url} iconKey={key} /> : <Icon />;
}

/** Any other ribbon picture (a Lucide icon, a raster picture): the given node, unless there is external artwork for the canonical key. */
export function RibbonIconOr({ iconKey, children }: { iconKey: string; children: ReactNode }) {
  const url = useExternalArtwork(iconKey);
  return url ? <ExternalIcon url={url} iconKey={iconKey} /> : <>{children}</>;
}
