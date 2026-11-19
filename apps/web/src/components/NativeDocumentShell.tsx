"use client";

import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { relieveOverFineCadMeshes } from "@/lib/cadMeshRelief";
import { loadEditorModule } from "@/lib/editorModuleLoader";
import { getHostBridge, subscribeToHostBridge, type HostBridge, type HostConnection } from "@/lib/host/hostBridge";
import { parseDocumentDescriptor, type DocumentDescriptor } from "@/lib/host/hostDocument";
import { classifyOpenError, loadNativeDocument, type NativeDocumentState } from "@/lib/host/nativeDocumentLoader";
import { importLylProject } from "@/lib/lylProject";
import { applyAppTheme, getAppThemePreference, readStoredAppTheme, resolveAppTheme, setAppTheme, subscribeToAppTheme, type AppThemePreference, type ResolvedAppTheme } from "@/lib/appTheme";
import { localizedError } from "@/lib/userErrors";
import { useLanguage } from "@/lib/useLanguage";

/**
 * The editor in a HundchenLayerling document window. Rendered INSTEAD of the browser start page whenever the page is served from the host's
 * layerling: scheme (app/page.tsx), and it only proceeds after the host handshake granted the document capability.
 *
 * It owns no library: no dashboard, no project list, no IndexedDB project record, no thumbnails, no per-edit repack, no snapshots. The editor
 * is handed one in-memory document under a transient project id. See nativeDocumentLoader.ts.
 */
const LayerlingEditor = dynamic(() => loadEditorModule().then((editorModule) => editorModule.LayerlingEditor), { ssr: false, loading: () => <Message text="Preparing the editor…" /> });

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
  const bridge = useBridge();
  const [connection, setConnection] = useState<HostConnection>({ state: "inactive" });
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
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
      if (event.type === "document.cancel") controller.abort();
    });
    let documentId: string | null = null;
    void (async () => {
      try {
        setPhase({ kind: "opening", text: "Opening…" });
        const reply = await bridge.send("document.request", {});
        if (!reply.ok) throw new Error(`${reply.failure.message} (${reply.failure.code})`);
        const descriptor: DocumentDescriptor | { invalid: string } = parseDocumentDescriptor(reply.payload.document);
        if ("invalid" in descriptor) throw new Error(`The host sent an unusable document description: ${descriptor.invalid}`);
        documentId = descriptor.documentId;
        const name = descriptor.kind === "file" ? descriptor.fileName : descriptor.displayName;
        const state = await loadNativeDocument(
          descriptor,
          { importLyl: (bytes) => importLylProject(bytes), relieve: (project) => relieveOverFineCadMeshes(project, remeshCadBrepLater) },
          {
            signal: controller.signal,
            onPhase: (step, loaded, total) => {
              const label = step === "transfer" ? "Reading the file" : step === "unpack" ? "Unpacking" : "Building the design";
              setPhase({ kind: "opening", text: `${label}…${step === "transfer" && loaded && total ? ` ${Math.round((loaded / total) * 100)}%` : ""}` });
              void bridge.send("document.progress", { documentId: descriptor.documentId, phase: step, ...(loaded !== undefined ? { loaded } : {}), ...(total !== undefined ? { total } : {}) });
            },
          },
        );
        setPhase({ kind: "ready", document: state, fileName: descriptor.kind === "file" ? name : null });
        const reported = await bridge.send("document.opened", {
          documentId: state.documentId,
          projectId: state.documentProjectId,
          projectName: state.projectName,
          stats: state.stats,
          timings: state.timings,
          meshRelief: state.meshRelief,
          repack: false,
        });
        if (!reported.ok) console.warn(`[layerling-host] document.opened was not accepted: ${reported.failure.code}: ${reported.failure.message}`);
      } catch (error) {
        fail(bridge, documentId, error);
      }
    })();
    return () => {
      stopListening();
    };
  }, [bridge, connection, fail]);

  if (phase.kind === "failed") return <Message title={phase.title} text={phase.text} />;
  if (phase.kind !== "ready") return <Message text={phase.kind === "opening" ? phase.text : "Connecting to HundchenLayerling…"} />;

  const document = phase.document;
  return (
    <EditorBoundary onError={(error) => console.error("layerling: the editor stopped", error)}>
      <div className="editor-stage active">
        <LayerlingEditor
          nativeDocument={{ fileName: phase.fileName }}
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
          projectName={document.projectName}
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
