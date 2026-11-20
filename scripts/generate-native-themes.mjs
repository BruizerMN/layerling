#!/usr/bin/env node
/*
 * The native app's two neutral appearances (Build 0007): "mac-light" and "mac-dark", generated from the same style sheets and by the same method as
 * the Graphite palette (generate-graphite-theme.mjs): every colour declaration of the app's CSS is repeated once, in order, under a selector that
 * matches only in that palette and has exactly the original's specificity, with warm neutrals (the browns, creams and tans of Layerling's own look)
 * turned into neutral greys. Accents (orange and friends), cool colours and true greys pass through. Nothing here changes the Light, Dark or Graphite
 * themes of the browser: the palettes apply only where the native app sets data-palette="mac" (appTheme.ts).
 *
 *   mac-light  html[data-theme="light"][data-palette="mac"]   the light theme with neutral greys and near-black text
 *   mac-dark   html[data-theme="dark"][data-palette="mac"]    the dark theme with neutral charcoal surfaces in macOS's tonal steps
 *
 * Run after changing colours in the app's style sheets:  npm run theme:native
 * A unit test fails while the generated files are out of date.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blocks, declarations, splitSelectors, toHsl, readGraphiteSources, COLOR_PATTERN, COLOR_PROPERTY } from "./generate-graphite-theme.mjs";

const LIGHT_SCOPE = '[data-theme="light"][data-palette="mac"]';
const DARK_SCOPE = '[data-theme="dark"][data-palette="mac"]';
const DARK_PREFIX = 'html[data-theme="dark"]';
const LIGHT_PREFIX = 'html[data-theme="light"]';

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Warm neutral? (brown, beige, cream, khaki: hue 10-60, some saturation, not a strong accent.) Same rule as Graphite's. */
function warmNeutral(r, g, b) {
  const { h, s, l } = toHsl(r, g, b);
  if (s < 0.02 || h < 10 || h > 60) return null;
  const paleBeige = l >= 0.74 && s < 0.75;
  const accent = s >= 0.5 && l >= 0.22 && l <= 0.85 && !paleBeige;
  return accent ? null : l;
}

/** Light: neutral greys; text and dark ink go nearer to black (macOS's label colour), mid greys and paper tones keep their lightness. */
export function macLightGrey(r, g, b) {
  const l = warmNeutral(r, g, b);
  if (l === null) return null;
  const mapped = l < 0.5 ? l * 0.6 : l;
  const value = Math.round(clamp01(mapped) * 255);
  return [value, value, value];
}

/** Dark: neutral charcoal in macOS's steps (window ~#1e1e1e, raised ~#2c2c2e / #3a3a3c, separators ~#48484a); light text and mid greys stay. */
export function macDarkGrey(r, g, b) {
  const l = warmNeutral(r, g, b);
  if (l === null) return null;
  let mapped;
  if (l < 0.35) mapped = 0.075 + 0.6 * l;
  else if (l < 0.65) mapped = 0.285 + ((l - 0.35) / 0.3) * (0.62 - 0.285);
  else mapped = l;
  const value = Math.round(clamp01(mapped) * 255);
  return [value, value, value];
}

const hex = (value) => value.toString(16).padStart(2, "0");

export function recolor(value, grey) {
  return value.replace(COLOR_PATTERN, (match) => {
    if (match.startsWith("#")) {
      let digits = match.slice(1);
      if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join("");
      const [r, g, b] = [0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16));
      const mapped = grey(r, g, b);
      return mapped ? `#${mapped.map(hex).join("")}${digits.slice(6, 8)}` : match;
    }
    const parts = match.slice(match.indexOf("(") + 1, -1).split(",").map((part) => part.trim());
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !/^[0-9.]+$/.test(part))) return match;
    const mapped = grey(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    if (!mapped) return match;
    return parts.length === 4 ? `rgba(${mapped.join(", ")}, ${parts[3]})` : `rgb(${mapped.join(", ")})`;
  });
}

function scopedSelector(selector, scope, themePrefix) {
  if (selector.startsWith(themePrefix)) return `${themePrefix}:where([data-palette="mac"])${selector.slice(themePrefix.length)}`;
  const root = /^(:root|html)(?=$|[\s.#[:>+~])/.exec(selector);
  if (root) return `${root[1]}:where(${scope})${selector.slice(root[1].length)}`;
  return `:where(html${scope}) ${selector}`;
}

function transform(css, { scope, themePrefix, otherPrefix, grey }, indent = "") {
  const out = [];
  for (const [prelude, body] of blocks(css)) {
    if (prelude.startsWith("@media") || prelude.startsWith("@supports")) {
      const inner = transform(body, { scope, themePrefix, otherPrefix, grey }, `${indent}  `);
      if (inner.length) out.push(`${indent}${prelude} {\n${inner.join("\n\n")}\n${indent}}`);
      continue;
    }
    if (prelude.startsWith("@")) continue;
    const selectors = splitSelectors(prelude).filter((selector) => !selector.startsWith(otherPrefix));
    if (!selectors.length) continue;
    const kept = declarations(body).filter(([property, value]) => {
      COLOR_PATTERN.lastIndex = 0;
      return COLOR_PROPERTY.test(property) || COLOR_PATTERN.test(value);
    });
    if (!kept.length) continue;
    out.push(
      `${indent}${selectors.map((selector) => scopedSelector(selector, scope, themePrefix)).join(`,\n${indent}`)} {\n`
      + kept.map(([property, value]) => `${indent}  ${property}: ${recolor(value, grey)};`).join("\n")
      + `\n${indent}}`,
    );
  }
  return out;
}

const HEADER = (name) => ["/*", ` * Generated by scripts/generate-native-themes.mjs (${name}) from globals.css and the sheets split off from it - do not`, " * edit by hand; run `npm run theme:native` after changing colours there.", " */", ""];

export function macLightThemeCss(sourceCss) {
  return [...HEADER("mac-light"), transform(sourceCss, { scope: LIGHT_SCOPE, themePrefix: LIGHT_PREFIX, otherPrefix: DARK_PREFIX, grey: macLightGrey }).join("\n\n"), ""].join("\n");
}

export function macDarkThemeCss(sourceCss) {
  return [...HEADER("mac-dark"), transform(sourceCss, { scope: DARK_SCOPE, themePrefix: DARK_PREFIX, otherPrefix: LIGHT_PREFIX, grey: macDarkGrey }).join("\n\n"), ""].join("\n");
}

export const MAC_LIGHT_TARGET = "apps/web/public/assets/theme/mac-light-theme.css";
export const MAC_DARK_TARGET = "apps/web/public/assets/theme/mac-dark-theme.css";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const css = readGraphiteSources(root);
  writeFileSync(path.join(root, MAC_LIGHT_TARGET), macLightThemeCss(css));
  writeFileSync(path.join(root, MAC_DARK_TARGET), macDarkThemeCss(css));
  console.log(`Wrote ${MAC_LIGHT_TARGET} and ${MAC_DARK_TARGET}`);
}
