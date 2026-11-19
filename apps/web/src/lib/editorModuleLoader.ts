import { loadStoredCustomFonts } from "@/lib/customFontStore";
import { loadTextFonts } from "@/lib/textFonts";

let editorModulePromise: Promise<typeof import("@/components/LayerlingEditor")> | null = null;

/** The editor with what it needs before it draws: fonts, the 2D kernel. Shared by the browser start page and the native document window. */
export function loadEditorModule() {
  // Fonts of one's own kept in this browser come along; without them the built-in ones still work.
  editorModulePromise ??= Promise.all([
    import("@/components/LayerlingEditor"),
    loadTextFonts(),
    loadStoredCustomFonts(),
    // The 2D kernel builds the wider layers of a name tag and every text fill (#215); drawn before
    // it is there, such a text stands as plain letters for a moment. It comes with the editor
    // (0.6 MB, kept by the browser); should it fail, the editor opens and texts ask for it again.
    import("@/lib/editorMeshCore").then((core) => core.getManifoldRuntime()).catch(() => undefined),
  ])
    .then(([editorModule]) => editorModule)
    .catch((error) => {
      editorModulePromise = null;
      throw error;
    });
  return editorModulePromise;
}
