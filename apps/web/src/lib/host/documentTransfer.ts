import type { FileDocumentDescriptor } from "@/lib/host/hostDocument";

/** Why a transfer failed. Always reported to the host as document.failed "transfer-failed" (or "cancelled" for an abort). */
export class DocumentTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentTransferError";
  }
}

export interface DocumentTransferOptions {
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
  /** Replaceable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Reads the document package from the host's resource endpoint into ONE preallocated array of exactly the announced size.
 * Checks: HTTP 200, Content-Length equals the descriptor's size, no more bytes than announced, none missing at the end.
 * Memory: one array of the package's size plus the chunk in flight; nothing is concatenated afterwards.
 */
export async function fetchDocumentBytes(descriptor: FileDocumentDescriptor, options: DocumentTransferOptions = {}): Promise<Uint8Array> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(descriptor.url, { method: "GET", cache: "no-store", signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new DocumentTransferError(`The file could not be read from the host (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!response.ok) throw new DocumentTransferError(`The host refused to send the file (status ${response.status})`);
  const announced = Number(response.headers.get("content-length"));
  if (!Number.isInteger(announced) || announced !== descriptor.byteLength) {
    throw new DocumentTransferError(`The file changed while it was being opened (the host announced ${descriptor.byteLength} bytes, the transfer ${response.headers.get("content-length") ?? "no length"})`);
  }
  if (!response.body) throw new DocumentTransferError("The host sent no data");
  const bytes = new Uint8Array(descriptor.byteLength);
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > bytes.byteLength) throw new DocumentTransferError("The file is larger than the host announced; it changed while it was being opened");
      bytes.set(value, received);
      received += value.byteLength;
      options.onProgress?.(received, bytes.byteLength);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (options.signal?.aborted || error instanceof DocumentTransferError) throw error;
    throw new DocumentTransferError(`The transfer broke off (${error instanceof Error ? error.message : String(error)})`);
  }
  if (received !== bytes.byteLength) throw new DocumentTransferError(`The file is shorter than the host announced (${received} of ${bytes.byteLength} bytes); it changed while it was being opened`);
  return bytes;
}
