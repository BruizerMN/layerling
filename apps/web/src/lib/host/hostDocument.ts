/**
 * Native documents (host protocol 2): what the host tells the editor about its document, and how the editor judges it.
 * Pure parsing only; the transfer is documentTransfer.ts, the opening nativeDocumentLoader.ts.
 *
 * Identity: `documentId` names the document for the lifetime of its window (host-assigned, unguessable, never reused). It is NOT the session
 * id (which names the page load) and NOT the project id stored inside a .lyl file (document metadata; see nativeDocumentLoader.ts).
 */

/** The only URL shape the editor will fetch a document from: the host's own scheme, its reserved path, one unguessable token. */
export const DOCUMENT_URL_PATTERN = /^layerling:\/\/app\/__host__\/doc\/[A-Za-z0-9_-]{16,128}$/;
/** An upper bound on a package the editor will accept from the host (the .lyl format's own limits are checked by the parser). */
export const DOCUMENT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export type NewDocumentDescriptor = { kind: "new"; documentId: string; displayName: string };
export type FileDocumentDescriptor = { kind: "file"; documentId: string; fileName: string; byteLength: number; modifiedAt: number; url: string };
export type DocumentDescriptor = NewDocumentDescriptor | FileDocumentDescriptor;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function parseDocumentDescriptor(value: unknown): DocumentDescriptor | { invalid: string } {
  if (!isRecord(value)) return { invalid: "document is not an object" };
  if (!isText(value.documentId) || value.documentId.length < 8 || value.documentId.length > 128) return { invalid: "document has no valid documentId" };
  if (value.kind === "new") {
    return isText(value.displayName) ? { kind: "new", documentId: value.documentId, displayName: value.displayName } : { invalid: "new document needs a displayName" };
  }
  if (value.kind === "file") {
    const { fileName, byteLength, modifiedAt, url } = value;
    if (!isText(fileName)) return { invalid: "file document needs a fileName" };
    if (typeof byteLength !== "number" || !Number.isInteger(byteLength) || byteLength <= 0 || byteLength > DOCUMENT_MAX_BYTES) return { invalid: "file document byteLength is out of range" };
    if (typeof modifiedAt !== "number" || !Number.isFinite(modifiedAt)) return { invalid: "file document needs modifiedAt" };
    if (!isText(url) || !DOCUMENT_URL_PATTERN.test(url)) return { invalid: "file document url is not a host document url" };
    return { kind: "file", documentId: value.documentId, fileName, byteLength, modifiedAt, url };
  }
  return { invalid: `unknown document kind "${String(value.kind)}"` };
}
