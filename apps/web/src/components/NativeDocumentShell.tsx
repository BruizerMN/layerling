"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { relieveOverFineCadMeshes } from "@/lib/cadMeshRelief";
import { loadEditorModule } from "@/lib/editorModuleLoader";
import { getHostBridge, subscribeToHostBridge, type HostBridge, type HostConnection } from "@/lib/host/hostBridge";
import { parseDocumentDescriptor, type DocumentDescriptor } from "@/lib/host/hostDocument";
import { classifyOpenError, loadNativeDocument, type NativeDocumentState } from "@/lib/host/nativeDocumentLoader";
import { importLylProject } from "@/lib/lylProject";
import type { RevisionState } from "@/lib/host/documentRevision";
import { performNativeSave, type NativeSaveApi } from "@/lib/host/nativeSave";
import { applyAppTheme, getAppThemePreference, readStoredAppTheme, resolveAppTheme, setAppTheme, subscribeToAppTheme, type AppThemePreference, type ResolvedAppTheme } from "@/lib/appTheme";
import { localizedError } from "@/lib/userErrors";
import { useLanguage } from "@/lib/useLanguage";
import { startNativeAppSync } from "@/lib/nativeAppSync";
import { startNativeErrorForwarding } from "@/lib/host/nativeErrors";
import { installBackgroundsReceiver } from "@/lib/host/viewportBackgrounds";
import { installRibbonIconsReceiver } from "@/lib/host/ribbonIcons";
import { setLoadingName, setLoadingState } from "@/lib/host/nativeLoading";
import { NativeLoadingScreen } from "@/components/NativeLoadingScreen";

/**
 * The editor in a HundchenLayerling document window. Rendered INSTEAD of the browser start page whenever the page is served from the host's
 * layerling: scheme (app/page.tsx), and it only proceeds after the host handshake granted the document capability.
 *
 * It owns no library: no dashboard, no project list, no IndexedDB project record, no thumbnails, no per-edit repack, no snapshots. The editor
 * is handed one in-memory document under a transient project id. See nativeDocumentLoader.ts.
 */
const LayerlingEditor = dynamic(() => loadEditorModule().then((editorModule) => editorModule.LayerlingEditor), { ssr: false, loading: () => <NativeLoadingScreen /> });

const remeshCadBrepLater = (brep: string, deflection: Parameters<typeof import("@/lib/editorSketchCad").remeshCadBrep>[1], capped: Parameters<typeof import("@/lib/editorSketchCad").remeshCadBrep>[2]) =>
  import("@/lib/editorSketchCad").then(({ remeshCadBrep }) => remeshCadBrep(brep, deflection, capped));

type Phase =
  | { kind: "connecting" }
  | { kind: "opening"; text: string }
  | { kind: "ready"; document: NativeDocumentState; fileName: string | null }
  | { kind: "failed"; title: string; text: string };

function Message({ text, title }: { text: string; title?: string }) {
  return (
    <main role="status" style={{ display: "grid", placeItems: "center", height: "100vh", padding: 24, textAlign: "center", fontFamily: "-apple-system, system-ui, sans-serif", color: "CanvasText", background: "Canvas" }}>
      <div style={{ maxWidth: 520 }}>
        {title ? <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>{title}</h1> : null}
        <p style={{ margin: 0, opacity: 0.8, lineHeight: 1.45 }}>{text}</p>
      </div>
    </main>
  );
}

class EditorBoundary extends Component<{ onError: (error: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? <Message title="The editor stopped" text="Close this window and open the document again. Changes made since it was opened were not saved." /> : this.props.children;
  }
}

function useBridge(): HostBridge | null {
  const [bridge, setBridge] = useState<HostBridge | null>(() => getHostBridge());
  useEffect(() => {
    setBridge(getHostBridge());
    return subscribeToHostBridge(setBridge);
  }, []);
  return bridge;
}

export function NativeDocumentShell() {
  useLanguage();
  // Application-wide preferences changed in another window (Settings, another document) apply here too, live (nativeAppSync.ts).
  useEffect(() => startNativeAppSync(), []);
  // An unexpected exception of the page is an error like any other: the host shows it (nothing disappears silently).
  useEffect(() => startNativeErrorForwarding(), []);
  // The host tells the page when a viewport background image is set, replaced or cleared (Settings); the viewport follows without a reload.
  useEffect(() => installBackgroundsReceiver(), []);
  useEffect(() => installRibbonIconsReceiver(), []);
  const bridge = useBridge();
  const [connection, setConnection] = useState<HostConnection>({ state: "inactive" });
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /** The editor's packaging API (protocol 3) and the saves in flight, keyed by saveId. */
  const nativeApiRef = useRef<NativeSaveApi | null>(null);
  const savesRef = useRef(new Map<string, AbortController>());
  /** The name shown for the document: the native file name is authoritative (D6), "Untitled" before the first save. */
  const [displayName, setDisplayName] = useState<string | null>(null);
  /** The editor has mounted and reported itself ready: until then the loading screen stays over it (no blank or half-built editor shows through). */
  const [editorOnScreen, setEditorOnScreen] = useState(false);
  const changeStateRef = useRef<RevisionState | null>(null);
  const changeTimerRef = useRef<number | null>(null);
  const documentIdRef = useRef<string | null>(null);
  /** The document.opened payload, held until the editor has mounted (see onNativeDocumentReady). */
  const pendingReportRef = useRef<{ payload: Record<string, unknown>; shownAt: number } | null>(null);
  const [themePreference, setThemePreference] = useState<AppThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedAppTheme>("light");

  // Theme: the editor's own look setting, the one piece of browser storage a native window still reads.
  useEffect(() => {
    const stored = readStoredAppTheme(window.localStorage);
    setAppTheme(stored, false);
    setThemePreference(stored);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const preference = getAppThemePreference();
      setThemePreference(preference);
      setResolvedTheme(resolveAppTheme(preference, media.matches));
      applyAppTheme(preference, media.matches);
    };
    apply();
    const unsubscribe = subscribeToAppTheme(apply);
    media.addEventListener("change", apply);
    return () => {
      unsubscribe();
      media.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    if (!bridge) return;
    setConnection(bridge.getConnection());
    return bridge.subscribe(setConnection);
  }, [bridge]);

  const fail = useCallback(
    (activeBridge: HostBridge | null, documentId: string | null, error: unknown) => {
      const raw = error instanceof Error ? error.message : String(error);
      const text = localizedError(raw);
      const code = classifyOpenError(error);
      if (code !== "cancelled") setPhase({ kind: "failed", title: "This document could not be opened", text });
      // The host decides what the person sees (a sheet) and closes the window; the page just says so too in case it stays.
      if (activeBridge && documentId) void activeBridge.send("document.failed", { documentId, code, message: text });
    },
    [],
  );

  // Handshake -> document request -> open. Runs once per page load; a reload of the page (the host's recovery) starts it again.
  useEffect(() => {
    if (!bridge || startedRef.current) return;
    if (connection.state === "failed") {
      setPhase({ kind: "failed", title: "HundchenLayerling could not connect to this editor", text: `${connection.failure.message} (${connection.failure.code}). This editor and the app need to speak a common version; update HundchenLayerling or its editor.` });
      return;
    }
    if (connection.state !== "ready") return;
    startedRef.current = true;
    if (!bridge.supportsDocuments()) {
      setPhase({ kind: "failed", title: "This app version cannot open documents", text: "The host did not offer document support (protocol 2). Update HundchenLayerling." });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const stopListening = bridge.onEvent((event) => {
      if (event.type === "document.cancel") {
        controller.abort();
        savesRef.current.forEach((save) => save.abort());
        return;
      }
      if (event.type === "document.renamed") {
        setDisplayName(event.payload.fileName);
        return;
      }
      if (event.type === "document.save.cancel") {
        savesRef.current.get(event.payload.saveId)?.abort();
        return;
      }
      if (event.type === "document.saved") {
        nativeApiRef.current?.markSaved(event.payload.signature);
        if (event.payload.fileName) setDisplayName(event.payload.fileName);
        return;
      }
      if (event.type === "document.save") {
        const api = nativeApiRef.current;
        const save = new AbortController();
        savesRef.current.set(event.payload.saveId, save);
        if (!api) {
          void bridge.sendSave("document.save.failed", { documentId: event.payload.documentId, saveId: event.payload.saveId, code: "internal", message: "The editor is not ready to save." });
          savesRef.current.delete(event.payload.saveId);
          return;
        }
        // The upload runs beside editing: the snapshot is immutable, later edits stay unsaved.
        void performNativeSave(bridge, event.payload, api, save).finally(() => savesRef.current.delete(event.payload.saveId));
      }
    });
    let documentId: string | null = null;
    void (async () => {
      try {
        setPhase({ kind: "opening", text: "Opening…" });
        setLoadingState({ stage: "opening" });
        const reply = await bridge.send("document.request", {});
        if (!reply.ok) throw new Error(`${reply.failure.message} (${reply.failure.code})`);
        const descriptor: DocumentDescriptor | { invalid: string } = parseDocumentDescriptor(reply.payload.document);
        if ("invalid" in descriptor) throw new Error(`The host sent an unusable document description: ${descriptor.invalid}`);
        documentId = descriptor.documentId;
        const name = descriptor.kind === "file" ? descriptor.fileName : descriptor.displayName;
        setLoadingName(name);
        const state = await loadNativeDocument(
          descriptor,
          { importLyl: (bytes) => importLylProject(bytes), relieve: (project) => relieveOverFineCadMeshes(project, remeshCadBrepLater) },
          {
            signal: controller.signal,
            onPhase: (step, loaded, total) => {
              const label = step === "transfer" ? "Reading the file" : step === "unpack" ? "Unpacking" : "Building the design";
              setPhase({ kind: "opening", text: `${label}…${step === "transfer" && loaded && total ? ` ${Math.round((loaded / total) * 100)}%` : ""}` });
              // The loading screen shows the same stage; only the transfer carries measurements.
              setLoadingState(step === "transfer" ? { stage: "transfer", loaded, total } : { stage: step });
              void bridge.send("document.progress", { documentId: descriptor.documentId, phase: step, ...(loaded !== undefined ? { loaded } : {}), ...(total !== undefined ? { total } : {}) });
            },
          },
        );
        documentIdRef.current = state.documentId;
        setDisplayName(descriptor.kind === "file" ? name.replace(/\.[^./]+$/, "") : name);
        setLoadingState({ stage: "editor" });
        setPhase({ kind: "ready", document: state, fileName: descriptor.kind === "file" ? name : null });
        // Reported when the editor is on screen (reportOpened below), not now: "open" means ready to edit.
        pendingReportRef.current = {
          shownAt: performance.now(),
          payload: { documentId: state.documentId, projectId: state.documentProjectId, projectName: state.projectName, stats: state.stats, timings: state.timings, meshRelief: state.meshRelief, repack: false },
        };
      } catch (error) {
        fail(bridge, documentId, error);
      }
    })();
    return () => {
      stopListening();
    };
  }, [bridge, connection, fail]);

  /** The editor reports every change of persistent content; the host hears about it at most once per tick (the dirty flag flips at once). */
  const handleNativeChange = (state: RevisionState) => {
    changeStateRef.current = state;
    if (changeTimerRef.current !== null || !bridge) return;
    changeTimerRef.current = window.setTimeout(() => {
      changeTimerRef.current = null;
      const latest = changeStateRef.current;
      const documentId = documentIdRef.current;
      if (latest && documentId) void bridge.sendSave("document.changed", { documentId, revision: latest.revision, dirty: latest.dirty });
    }, 0);
  };

  const reportOpened = () => {
    setEditorOnScreen(true);
    const pending = pendingReportRef.current;
    if (!pending || !bridge) return;
    pendingReportRef.current = null;
    const timings = { ...(pending.payload.timings as Record<string, number>), mountMs: Math.round(performance.now() - pending.shownAt) };
    void bridge.send("document.opened", { ...pending.payload, timings }).then((reported) => {
      if (!reported.ok) console.warn(`[layerling-host] document.opened was not accepted: ${reported.failure.code}: ${reported.failure.message}`);
    });
  };

  if (phase.kind === "failed") return <Message title={phase.title} text={phase.text} />;
  if (phase.kind !== "ready") return <NativeLoadingScreen />;

  const document = phase.document;
  return (
    <EditorBoundary onError={(error) => console.error("layerling: the editor stopped", error)}>
      {editorOnScreen ? null : <NativeLoadingScreen />}
      <div className="editor-stage active">
        <LayerlingEditor
          nativeDocument={{ fileName: phase.fileName, documentId: document.documentId, documentProjectId: document.documentProjectId }}
          onNativeDocumentChange={handleNativeChange}
          nativeApiRef={nativeApiRef}
          onNativeDocumentReady={reportOpened}
          initialAssets={document.assets}
          initialAttachments={document.attachments}
          initialShapes={document.shapes}
          initialHistory={document.history}
          initialHistoryIndex={document.historyIndex}
          initialSnap={document.snapGrid}
          initialWorkspace={document.workspace}
          initialPlacementElevation={document.placementElevation}
          initialPlacementWorkplane={document.placementWorkplane}
          projectId={document.runtimeProjectId}
          projectName={displayName ?? document.projectName}
          projectCreatedAt={document.createdAt}
          projectModifiedAt={document.modifiedAt}
          projectRevision={1}
          editorOpen
          themePreference={themePreference}
          resolvedTheme={resolvedTheme}
          onThemePreferenceChange={setAppTheme}
        />
      </div>
    </EditorBoundary>
  );
}
