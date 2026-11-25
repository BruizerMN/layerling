"use client";

import { useEffect } from "react";
import { startHostBridge } from "@/lib/host/hostBridge";
import { installDocumentSettingsEngine } from "@/lib/host/nativeDocumentSettings";
import { installPreferencesSnapshot } from "@/lib/host/preferencesSnapshot";

/**
 * Connects the editor to a native host when there is one (lib/host/README.md). Renders nothing, and in an ordinary browser does nothing:
 * the bridge only starts on the host's custom URL scheme with the host's injected capability.
 */
export function HostBridge() {
  useEffect(() => {
    installPreferencesSnapshot();
    installDocumentSettingsEngine();
    return startHostBridge();
  }, []);
  return null;
}
