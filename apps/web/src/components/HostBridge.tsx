"use client";

import { useEffect } from "react";
import { startHostBridge } from "@/lib/host/hostBridge";

/**
 * Connects the editor to a native host when there is one (lib/host/README.md). Renders nothing, and in an ordinary browser does nothing:
 * the bridge only starts on the host's custom URL scheme with the host's injected capability.
 */
export function HostBridge() {
  useEffect(() => startHostBridge(), []);
  return null;
}
