import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import * as drawn from "@/components/toolbarIcons";
import * as hand from "@/components/icons";

/**
 * Writes every ribbon icon component of the editor as static SVG markup, plus the tool id -> component pairs found in the toolbar's tool lists, to the folder named by
 * EXPORT_RIBBON_ICONS (Build 0024: the source of the reference library, scripts/export-ribbon-icons.sh). Does nothing otherwise.
 */
const out = process.env.EXPORT_RIBBON_ICONS;

describe.skipIf(!out)("export ribbon icons", () => {
  it("writes the markup and the id table", () => {
    const icons: Record<string, { source: string; markup: string }> = {};
    for (const [source, module] of [["toolbarIcons.tsx", drawn], ["icons.tsx", hand]] as const) {
      for (const [name, component] of Object.entries(module)) {
        if (!/^Toolbar.*Icon$/.test(name) || typeof component !== "function") continue;
        icons[name] = { source, markup: renderToStaticMarkup(createElement(component as never)) };
      }
    }
    const toolbar = fs.readFileSync(path.resolve(__dirname, "../../apps/web/src/components/workplane/SecondaryToolbar.tsx"), "utf8");
    const tools: Array<{ id: string; component: string; section: string | null }> = [];
    for (const match of toolbar.matchAll(/\{\s*id:\s*"([^"]+)"([^{}]*?)icon:\s*(\w+)/g)) {
      const section = /section:\s*"([^"]+)"/.exec(match[2]);
      tools.push({ id: match[1], component: match[3], section: section ? section[1] : null });
    }
    fs.mkdirSync(out!, { recursive: true });
    fs.writeFileSync(path.join(out!, "components.json"), JSON.stringify({ icons, tools }, null, 1));
  });
});
