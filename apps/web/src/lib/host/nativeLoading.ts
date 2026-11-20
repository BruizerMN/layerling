"use client";

import { useSyncExternalStore } from "react";

/**
 * What the native document window's loading screen shows (Build 0014). It mirrors the loading the shell already does (NativeDocumentShell ->
 * loadNativeDocument's onPhase): there is no second progress tracker, the shell only reports here what it already knows.
 *
 * Only the transfer stage is measurable (bytes read of bytes in the file); every other stage is reported without a number and shown as an
 * indeterminate indicator.
 */
export type LoadingStage = "connecting" | "opening" | "transfer" | "unpack" | "build" | "editor";

export interface LoadingState {
  stage: LoadingStage;
  /** Bytes read so far / in the file: only while `stage` is "transfer". */
  loaded?: number;
  total?: number;
  /** The document's file name (or "Untitled"), once the host has said which document this is. */
  name: string | null;
}

let state: LoadingState = { stage: "connecting", name: null };
const listeners = new Set<() => void>();

export function setLoadingState(next: Partial<LoadingState> & { stage: LoadingStage }) {
  // A stage without measurements carries none over from the stage before it.
  state = { name: state.name, ...next };
  listeners.forEach((listener) => listener());
}

export function setLoadingName(name: string | null) {
  state = { ...state, name };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLoadingState(): LoadingState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** The words for a stage: the messages the loading has always shown. */
export function loadingLabel(stage: LoadingStage): string {
  switch (stage) {
    case "connecting": return "Connecting to HundchenLayerling…";
    case "opening": return "Opening…";
    case "transfer": return "Reading the file…";
    case "unpack": return "Unpacking…";
    case "build": return "Building the design…";
    case "editor": return "Preparing the editor…";
  }
}

/** The fraction (0..1) of the CURRENT stage that is measurably done, or null when this stage cannot be measured. */
export function measuredFraction(current: LoadingState): number | null {
  if (current.stage !== "transfer" || !current.total || current.total <= 0 || current.loaded === undefined) return null;
  return Math.min(1, Math.max(0, current.loaded / current.total));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}
