import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuideModal } from "@/components/workplane/GuideModal";
import { NATIVE_GUIDE_LINES } from "@/lib/nativeGuideLines";
import { MESSAGES_EN } from "@/lib/messages.en";

const src = (file: string) => readFileSync(`apps/web/src/${file}`, "utf8");

describe("Build 0107: the view bar is not rendered in the Mac app", () => {
  const files = ["components/WorkplaneViewport.tsx", "components/SketchWorkspace.tsx"];

  it("both views take hideViewBar (default false: the browser edition is unchanged) and the editor passes it from the native document", () => {
    for (const file of files) {
      const s = src(file);
      expect(s, file).toContain("hideViewBar = false,");
      expect(s, file).toContain("hideViewBar?: boolean;");
    }
    const editor = src("components/LayerlingEditor.tsx");
    expect(editor.match(/hideViewBar=\{Boolean\(nativeDocument\)\}/g)?.length).toBe(2);
  });

  it("the whole bar (handle included) sits inside the suppression: nothing is reserved or clickable, and only the rendering is gated", () => {
    for (const file of files) {
      const s = src(file);
      const gate = s.indexOf("{hideViewBar ? null : (");
      const bar = s.indexOf('className={`camera-controls', gate);
      const handle = s.indexOf("<CameraBarHandle", bar);
      const end = s.indexOf("      )}\n", handle);
      expect(gate, file).toBeGreaterThan(0);
      expect(bar - gate, file).toBeLessThan(200);
      expect(handle, file).toBeGreaterThan(bar);
      expect(end, file).toBeGreaterThan(handle);
      // the hooks and state the bar was fed by stay mounted with the view (no pruning): Escape, exclusivity and state reporting do not depend on the bar's elements
      expect(s, file).toContain("useCameraBarPeek(");
      expect(s, file).toContain("useMovablePanel<HTMLDivElement>(");
    }
    const wp = src("components/WorkplaneViewport.tsx");
    for (const keep of ["registerViewCommands(", "sectionViewOpenRef", "setSectionMeasureMode"]) expect(wp, keep).toContain(keep);
    // the throwaway rail the ribbon reads its look from is built by script, not from the mounted bar
    expect(src("lib/nativeRibbonTokens.ts")).toContain('rail.className = "camera-controls"');
  });
});

describe("Build 0107: the guide lines the bar's suppression affects", () => {
  it("every override names a real guide line; the Mac wording no longer points at the view bar", () => {
    for (const [key, text] of Object.entries(NATIVE_GUIDE_LINES)) {
      expect(key in MESSAGES_EN, key).toBe(true);
      if (text !== null) expect(text!.toLowerCase(), key).not.toContain("view bar");
    }
    expect(NATIVE_GUIDE_LINES["guide.view.touch"]).toBeNull();
  });

  it("native (English) reads the Mac wording; the browser edition keeps the original instructions", () => {
    const nativeHtml = renderToStaticMarkup(createElement(GuideModal, { onClose: () => undefined, nativeApp: true }));
    const browserHtml = renderToStaticMarkup(createElement(GuideModal, { onClose: () => undefined }));
    expect(nativeHtml).toContain("Section item in the toolbar");
    expect(nativeHtml).not.toContain("bottom of the view bar");
    expect(nativeHtml).not.toContain("protractor in the view bar");
    expect(browserHtml).toContain("bottom of the view bar");
    expect(browserHtml).toContain("The switch in the view bar");
  });
});
