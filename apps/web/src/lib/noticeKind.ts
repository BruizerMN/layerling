import { NOTICE_ERROR_KEYS, NOTICE_INFO_KEYS } from "./noticeClasses";

/**
 * Which of the editor's messages are errors (Build 0018, native app). `t()` reports every sentence it renders for a message key that can be a notice
 * (`noteNoticeText`); when the editor then raises a notice with that same text, `noticeIsError` knows which kind it is. The classes come from
 * noticeClasses.ts (every notice key sorted by what its sentence says). A text that is none of the recorded ones - the message of an exception, a
 * composed sentence of unknown parts - counts as an error: when in doubt, it is shown.
 */
const ERRORS: ReadonlySet<string> = new Set(NOTICE_ERROR_KEYS);
const INFO: ReadonlySet<string> = new Set(NOTICE_INFO_KEYS);
const MAX_RECENT = 400;
/** Rendered sentence -> its class, the most recent last. */
const recent = new Map<string, "error" | "info">();

/** Called by `t()` with every key it renders; cheap for the (many) keys that are not notices. */
export function noteNoticeText(key: string, text: string) {
  const kind = ERRORS.has(key) ? "error" : INFO.has(key) ? "info" : null;
  if (!kind || text.length < 6) return;
  recent.delete(text);
  recent.set(text, kind);
  if (recent.size > MAX_RECENT) recent.delete(recent.keys().next().value as string);
}

/** Whether a notice message is an error (or unknown, which is treated as one). */
export function noticeIsError(message: string): boolean {
  const exact = recent.get(message);
  if (exact) return exact === "error";
  // A sentence composed of rendered parts: it is the kind of the parts it holds, an error if any part is.
  let info = false;
  for (const [text, kind] of recent) {
    if (!message.includes(text)) continue;
    if (kind === "error") return true;
    info = true;
  }
  return !info;
}
