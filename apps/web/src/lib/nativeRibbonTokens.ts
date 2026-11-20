"use client";

/**
 * Native app (Build 0013 corrections): the modeling ribbon takes its look from the vertical toolbar on the left of the canvas (`.camera-controls`), in every
 * theme. The toolbar's colours differ per theme (Classic, and the generated System/Light/Dark palettes), so instead of copying values the ribbon reads them:
 * a throw-away, hidden `.camera-controls` with one `.camera-group` and a button is created, its computed styles are read and removed, and the results are
 * published as CSS variables on <html> (nativeInspector.css uses them). They are read again whenever the theme or palette changes and when a palette
 * stylesheet finishes loading. Nothing here touches the real toolbar.
 */
const TOKENS = ["--native-rail-bg", "--native-rail-bg-solid", "--native-rail-border", "--native-rail-group-border", "--native-rail-ink"] as const;

export function readRailTokens(root: HTMLElement = document.documentElement) {
  const rail = document.createElement("div");
  rail.className = "camera-controls";
  rail.setAttribute("aria-hidden", "true");
  rail.style.display = "none";
  const group = document.createElement("div");
  group.className = "camera-group";
  const button = document.createElement("button");
  button.tabIndex = -1;
  group.appendChild(button);
  rail.appendChild(group);
  document.body.appendChild(rail);
  try {
    const railStyle = getComputedStyle(rail);
    const bg = railStyle.backgroundColor;
    const numbers = bg.match(/[\d.]+/g) ?? [];
    root.style.setProperty("--native-rail-bg", bg);
    // The same colour fully opaque, for the ribbon itself and for the folded groups' popovers (which float over the canvas).
    root.style.setProperty("--native-rail-bg-solid", numbers.length >= 3 ? `rgb(${numbers[0]}, ${numbers[1]}, ${numbers[2]})` : bg);
    root.style.setProperty("--native-rail-border", railStyle.borderTopColor);
    root.style.setProperty("--native-rail-group-border", getComputedStyle(group).borderTopColor);
    root.style.setProperty("--native-rail-ink", getComputedStyle(button).color);
  } finally {
    rail.remove();
  }
}

/** Keeps the variables in step with the theme for as long as the app runs; returns the stop function. */
export function startRailTokens(): () => void {
  const root = document.documentElement;
  const timers = new Set<number>();
  const sync = () => { try { readRailTokens(root); } catch { /* no document yet: the CSS fallbacks hold */ } };
  const later = () => {
    sync();
    // A palette's stylesheet is loaded a moment after the theme attribute changes: look again as it arrives.
    for (const delay of [60, 400, 1500]) { const id = window.setTimeout(() => { timers.delete(id); sync(); }, delay); timers.add(id); }
  };
  later();
  const attributes = new MutationObserver(later);
  attributes.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
  const links = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach((node) => { if (node instanceof HTMLLinkElement) node.addEventListener("load", sync, { once: true }); });
  });
  links.observe(document.head, { childList: true });
  window.addEventListener("load", sync, { once: true });
  return () => {
    attributes.disconnect();
    links.disconnect();
    timers.forEach((id) => window.clearTimeout(id));
    TOKENS.forEach((name) => root.style.removeProperty(name));
  };
}
