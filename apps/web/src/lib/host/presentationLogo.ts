/**
 * The Organization Logo of Presentation Mode (Build 0022, native app only). The host keeps the image (a PNG in Application Support: a transparent PNG, or an SVG the
 * host has already drawn to a PNG, so no vector content ever reaches the page) and tells every page its address and the two preferences with the viewport
 * backgrounds (`window.__layerlingBackgrounds`: `logo`, `logoPosition`, `logoOpacity`). This module only reads them.
 */
export type LogoPosition = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
export const LOGO_POSITIONS: readonly LogoPosition[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];
export const DEFAULT_LOGO_POSITION: LogoPosition = "bottomRight";
export const DEFAULT_LOGO_OPACITY = 0.75;

export interface PresentationLogoSettings {
  url: string | null;
  position: LogoPosition;
  opacity: number;
}

export function normalizeLogo(value: unknown): PresentationLogoSettings {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const url = typeof source.logo === "string" && source.logo.length > 0 ? source.logo : null;
  const position = LOGO_POSITIONS.includes(source.logoPosition as LogoPosition) ? (source.logoPosition as LogoPosition) : DEFAULT_LOGO_POSITION;
  const raw = typeof source.logoOpacity === "number" && Number.isFinite(source.logoOpacity) ? source.logoOpacity : DEFAULT_LOGO_OPACITY;
  return { url, position, opacity: Math.min(1, Math.max(0.05, raw)) };
}

export function currentLogo(): PresentationLogoSettings {
  if (typeof window === "undefined") return normalizeLogo(null);
  return normalizeLogo((window as unknown as { __layerlingBackgrounds?: unknown }).__layerlingBackgrounds);
}
