/**
 * Native app: errors are shown by the host, as a sheet on the document's window (Build 0019). The page sends each error to the host's `layerlingErrors`
 * message handler (injected by the host into document pages only) and shows nothing itself. In a browser, or without the handler, nothing is sent and the
 * editor's own notice stays what it was.
 */
interface ErrorHandler {
  postMessage(message: unknown): void;
}

function handler(): ErrorHandler | null {
  if (typeof window === "undefined") return null;
  const handlers = (window as unknown as { webkit?: { messageHandlers?: Record<string, ErrorHandler | undefined> } }).webkit?.messageHandlers;
  return handlers?.layerlingErrors ?? null;
}

/** Hands an error to the host; false when there is no host to show it (the caller then shows it itself). */
export function reportNativeError(message: string, kind: "error" | "exception" = "error"): boolean {
  const target = handler();
  if (!target || !message.trim()) return false;
  try {
    target.postMessage({ type: "error", kind, message: message.trim().slice(0, 2000) });
    return true;
  } catch {
    return false;
  }
}

/** What an unexpected exception is not worth telling anyone about: the page's own housekeeping, cancellations and blocked network requests (the app is offline). */
const IGNORED = /ResizeObserver|Script error|AbortError|cancell?ed|aborted|NetworkError|Failed to fetch|Load failed|fetch|Importing a module script failed|ChunkLoadError|Loading chunk/i;

function describe(reason: unknown): string | null {
  if (reason instanceof Error) return IGNORED.test(`${reason.name} ${reason.message}`) ? null : reason.message || reason.name;
  if (typeof reason === "string" && reason.length > 0 && !IGNORED.test(reason)) return reason;
  return null;
}

/** Unexpected exceptions must not disappear silently: they are reported like any error. Returns the remover. */
export function startNativeErrorForwarding(): () => void {
  if (typeof window === "undefined") return () => undefined;
  let last = "";
  let lastAt = 0;
  const forward = (text: string | null) => {
    if (!text) return;
    const now = Date.now();
    if (text === last && now - lastAt < 2000) return;
    last = text;
    lastAt = now;
    reportNativeError(text, "exception");
  };
  const onError = (event: ErrorEvent) => forward(describe(event.error) ?? (event.error ? null : describe(event.message)));
  const onRejection = (event: PromiseRejectionEvent) => forward(describe(event.reason));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
