"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceSettingsModal } from "@/components/workplane/WorkspaceSettingsModal";
import { applyAppTheme, getAppThemePreference, readStoredAppTheme, resolveAppTheme, setAppTheme, subscribeToAppTheme, type AppThemePreference } from "@/lib/appTheme";
import { readAppPrefs, subscribeAppPrefs, writeAppPrefs } from "@/lib/appPrefs";
import { effectiveWorkspace, splitWorkspace } from "@/lib/settingsScope";
import { useLanguage } from "@/lib/useLanguage";
import { startNativeAppSync } from "@/lib/nativeAppSync";
import type { BackgroundKind } from "@/lib/host/viewportBackgrounds";
import { DEFAULT_SNAP_GRID, DEFAULT_WORKPLANE_WORKSPACE, normalizeSnapGrid, normalizeWorkspaceSettings, readWorkspaceDefault, saveWorkspaceDefault } from "@/lib/workplaneSettings";
import type { GridSize, WorkplaneWorkspaceSettings } from "@/types/layerling";

/**
 * The page of a native Settings window (Build 0003). The host loads it into its own window's web view and injects `__layerlingSettingsBootstrap`
 * ({ scope, documentId? }) plus the `layerlingSettings` message handler; this page has no document and no editor.
 *
 *  - scope "app": Application Settings. Edits go straight to the application preference store (appPrefs.ts); every open document window picks them
 *    up through the `storage` event. No document is involved, so it works with none open and can never mark one modified.
 *  - scope "doc": Document Settings for ONE document. The document page sends its own settings to the host while this window is open
 *    (`settings.state`); the host hands them to `window.layerlingSettingsPage.receive`; edits go back with `patch` and the document page applies them
 *    like any change to its settings.
 * Both reuse the existing settings component, filtered by owner (WorkspaceSettingsModal `scope`), in its embedded form.
 */
export interface SettingsBootstrap {
  scope: "app" | "doc";
  documentId?: string;
}

interface HostHandler {
  postMessage(message: unknown): Promise<unknown>;
}

interface DocState {
  workspace: Record<string, unknown>;
  snap: string;
  hasStartView: boolean;
}

const MOVE_DIMENSIONS_KEY = "layerling.editor.moveDimensionsEnabled";
const ORIGIN_DIMENSIONS_KEY = "layerling.editor.originDimensionsEnabled";
const START_IN_PERSPECTIVE_KEY = "layerling.editor.startInPerspective";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}
function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Blocked storage: the choice holds for this window only.
  }
}

function hostHandler(): HostHandler | null {
  const handlers = (window as unknown as { webkit?: { messageHandlers?: Record<string, HostHandler | undefined> } }).webkit?.messageHandlers;
  return handlers?.layerlingSettings ?? null;
}

export function NativeSettingsPage({ bootstrap }: { bootstrap: SettingsBootstrap }) {
  useLanguage();
  const scope = bootstrap.scope;
  useEffect(() => startNativeAppSync(), []);
  const [theme, setTheme] = useState<AppThemePreference>("system");
  const [prefsVersion, setPrefsVersion] = useState(0);
  const [doc, setDoc] = useState<DocState | null>(null);
  const [moveDimensions, setMoveDimensions] = useState(() => readFlag(MOVE_DIMENSIONS_KEY));
  const [originDimensions, setOriginDimensions] = useState(() => readFlag(ORIGIN_DIMENSIONS_KEY));
  const [startInPerspective, setStartInPerspective] = useState(() => readFlag(START_IN_PERSPECTIVE_KEY));
  // The Welcome window preference lives in the host (it decides what a launch shows); Application Settings reads and writes it through the bridge.
  const [showWelcome, setShowWelcome] = useState(true);
  // The viewport background images (Build 0020): the host keeps them; this page shows what is set and asks the host to choose, replace or clear.
  const [backgrounds, setBackgrounds] = useState<Record<BackgroundKind, string | null>>({ light: null, dark: null, presentation: null });
  useEffect(() => {
    if (scope !== "app") return;
    const w = window as unknown as { layerlingSettingsPage?: { welcome?: (on: boolean) => void; backgrounds?: (value: unknown) => void } };
    const take = (value: unknown) => {
      const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      const pick = (key: string) => (typeof source[key] === "string" && source[key] ? (source[key] as string) : null);
      setBackgrounds({ light: pick("light"), dark: pick("dark"), presentation: pick("presentation") });
    };
    w.layerlingSettingsPage = { welcome: (on) => setShowWelcome(Boolean(on)), backgrounds: take };
    void hostHandler()?.postMessage({ type: "backgrounds.get" }).then((reply) => take((reply as { backgrounds?: unknown } | null)?.backgrounds));
    void hostHandler()?.postMessage({ type: "welcome.get" }).then((reply) => {
      const enabled = (reply as { enabled?: boolean } | null)?.enabled;
      if (typeof enabled === "boolean") setShowWelcome(enabled);
    });
    return () => {
      delete w.layerlingSettingsPage;
    };
  }, [scope]);
  const docRef = useRef<DocState | null>(null);
  docRef.current = doc;

  // The look of the window follows the application theme, like every document window.
  useEffect(() => {
    const stored = readStoredAppTheme(window.localStorage);
    setAppTheme(stored, false);
    setTheme(stored);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const preference = getAppThemePreference();
      setTheme(preference);
      applyAppTheme(preference, media.matches);
      document.documentElement.dataset.theme = resolveAppTheme(preference, media.matches);
    };
    apply();
    const off = subscribeToAppTheme(apply);
    media.addEventListener("change", apply);
    return () => {
      off();
      media.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => subscribeAppPrefs(() => setPrefsVersion((v) => v + 1)), []);

  // Document scope: the host pushes the document's settings here; ask for the first copy once the receiver is in place.
  useEffect(() => {
    if (scope !== "doc") return;
    const w = window as unknown as { layerlingSettingsPage?: { receive: (state: DocState) => void } };
    w.layerlingSettingsPage = { receive: (state) => setDoc(state) };
    void hostHandler()?.postMessage({ type: "ready" });
    return () => {
      delete w.layerlingSettingsPage;
    };
  }, [scope]);

  const appPrefs = useMemo(() => readAppPrefs(), [prefsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const workspace: WorkplaneWorkspaceSettings = useMemo(() => {
    if (scope === "doc") return effectiveWorkspace(normalizeWorkspaceSettings(doc?.workspace ?? {}), appPrefs);
    // Application scope shows no document key; the saved default only fills what the (hidden) rest of the component reads.
    return effectiveWorkspace(readWorkspaceDefault()?.workspace ?? DEFAULT_WORKPLANE_WORKSPACE, appPrefs);
  }, [scope, doc, appPrefs]);
  const snap: GridSize = scope === "doc" ? normalizeSnapGrid(doc?.snap, DEFAULT_SNAP_GRID) : DEFAULT_SNAP_GRID;

  const onWorkspaceChange = useCallback(
    (next: WorkplaneWorkspaceSettings) => {
      if (scope === "app") {
        writeAppPrefs(splitWorkspace(next).app);
        setPrefsVersion((v) => v + 1);
        return;
      }
      // Document scope: only the document's own keys leave this window; the document page applies them.
      const patch = splitWorkspace(normalizeWorkspaceSettings(next)).doc;
      setDoc((current) => (current ? { ...current, workspace: { ...current.workspace, ...patch } } : current));
      void hostHandler()?.postMessage({ type: "patch", workspace: patch, snap: docRef.current?.snap ?? null });
    },
    [scope],
  );
  const onSnapChange = useCallback(
    (next: GridSize) => {
      if (scope !== "doc") return;
      setDoc((current) => (current ? { ...current, snap: next } : current));
      void hostHandler()?.postMessage({ type: "patch", workspace: {}, snap: next });
    },
    [scope],
  );
  const action = (name: "settings.saveStartView" | "settings.resetStartView" | "settings.makeFitTest") => void hostHandler()?.postMessage({ type: "action", name });

  if (scope === "doc" && !doc) return <main role="status" style={{ display: "grid", placeItems: "center", height: "100vh", fontFamily: "-apple-system, system-ui, sans-serif", opacity: 0.7 }}>Loading the document's settings…</main>;

  return (
    <WorkspaceSettingsModal
      embedded
      scope={scope}
      workspace={workspace}
      snap={snap}
      themePreference={theme}
      moveDimensionsEnabled={moveDimensions}
      originDimensionsEnabled={originDimensions}
      startInPerspective={startInPerspective}
      showWelcome={showWelcome}
      viewportBackgrounds={scope === "app" ? backgrounds : undefined}
      onChooseBackground={scope === "app" ? (kind) => void hostHandler()?.postMessage({ type: "background.choose", kind }) : undefined}
      onClearBackground={scope === "app" ? (kind) => void hostHandler()?.postMessage({ type: "background.clear", kind }) : undefined}
      onShowWelcomeChange={scope === "app" ? (on) => {
        setShowWelcome(on);
        void hostHandler()?.postMessage({ type: "welcome.set", enabled: on });
      } : undefined}
      onWorkspaceChange={onWorkspaceChange}
      onSnapChange={onSnapChange}
      onThemePreferenceChange={setAppTheme}
      onMoveDimensionsEnabledChange={(on) => {
        writeFlag(MOVE_DIMENSIONS_KEY, on);
        setMoveDimensions(on);
      }}
      onOriginDimensionsEnabledChange={(on) => {
        writeFlag(ORIGIN_DIMENSIONS_KEY, on);
        setOriginDimensions(on);
      }}
      onStartInPerspectiveChange={(on) => {
        writeFlag(START_IN_PERSPECTIVE_KEY, on);
        setStartInPerspective(on);
      }}
      hasStartView={doc?.hasStartView ?? false}
      onSaveStartView={() => action("settings.saveStartView")}
      onResetStartView={() => action("settings.resetStartView")}
      // "Make default" keeps its meaning: the settings of THIS model become what new documents start from (document keys; application keys come from
      // the application's own preferences when a document is created).
      onMakeDefault={() => saveWorkspaceDefault(workspace, snap)}
      onMakeFitTest={scope === "doc" ? () => action("settings.makeFitTest") : undefined}
      onClose={() => void hostHandler()?.postMessage({ type: "close" })}
    />
  );
}
