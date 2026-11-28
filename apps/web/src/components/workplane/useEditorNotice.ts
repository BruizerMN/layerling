import { useCallback, useEffect, useRef, useState } from "react";
import { rememberBugReportEvent, type BugReportEvent } from "@/lib/bugReport";
import { NOTICE_AFTER_HOVER_MS, noticeDurationMs } from "@/lib/noticeTiming";
import { noticeIsError } from "@/lib/noticeKind";
import { reportNativeError } from "@/lib/host/nativeErrors";

export type NoticeAction = { label: string; run: () => void };

/**
 * Die Statuszeile in der Fusszeile. Eine Bestaetigung - „Gewinde
 * hinzugefuegt" - hat nach ein paar Sekunden ihren Zweck erfuellt und macht
 * wieder Platz. Alles, was etwas von einem will oder schiefgegangen ist,
 * bleibt stehen, bis es abgeloest wird: Eine Aufforderung, die sich von
 * selbst zurueckzieht, ist keine.
 */
export function useEditorNotice(options: { errorsOnly?: boolean } = {}) {
  // Native app: only errors are presented (something failed, was refused or cannot proceed), by the host, natively; confirmations, tool guidance, progress and
  // routine remarks are not raised at all. The browser shows everything, as before.
  const errorsOnly = options.errorsOnly === true;
  // Leer heisst Ruhe: Dann steht kein Fenster auf der Arbeitsflaeche. Ein
  // „Bereit" braucht niemand zu lesen - dass nichts los ist, sieht man.
  const [notice, setNoticeText] = useState("");
  // A message may carry one button, for what the person can do about it right away (#489).
  const [noticeAction, setNoticeAction] = useState<NoticeAction | null>(null);
  // When the message came (performance.now()), so the editor can tell one that reports a change just made.
  const [noticeAt, setNoticeAt] = useState(0);
  // An ordinary message goes after a few seconds and carries no button of its own: a confirmation, which can be switched off (#1708).
  const [noticeOrdinary, setNoticeOrdinary] = useState(true);
  const noticeTimerRef = useRef<number | null>(null);
  // Fuer den Fehlerbericht: die letzten Meldungen dieser Sitzung.
  const reportNoticesRef = useRef<BugReportEvent[]>([]);

  const clearLater = useCallback((ms: number) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNoticeText("");
      setNoticeAction(null);
    }, ms);
  }, []);
  // "stay": the message stays until the next one or the close button - for work that runs long and for what went wrong (#286).
  // `showInNative` (Build 0124): a result the person should see even in the native app, where confirmations are otherwise not raised (the footer message, never a sheet).
  const setNotice = useCallback((message: string, patient: boolean | "stay" = false, action: NoticeAction | null = null, showInNative = false) => {
    reportNoticesRef.current = rememberBugReportEvent(reportNoticesRef.current, message);
    if (errorsOnly && message !== "" && !showInNative) {
      // Native app: nothing is a toast. An error goes to the host, which shows it as a sheet on this document's window; anything else is not raised at all.
      // Without a host to take it (not expected in the app), the error is shown here as before rather than lost.
      if (!noticeIsError(message) || reportNativeError(message)) return;
    }
    setNoticeText(message);
    setNoticeAction(action);
    setNoticeAt(performance.now());
    setNoticeOrdinary(patient === false && action === null);
    if (patient === "stay") {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
      return;
    }
    clearLater(noticeDurationMs(message, patient));
  }, [clearLater, errorsOnly]);
  // A message stays while the pointer rests on it, and goes a few seconds after it leaves (#422).
  const holdNotice = useCallback(() => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = null;
  }, []);
  const releaseNotice = useCallback(() => clearLater(NOTICE_AFTER_HOVER_MS), [clearLater]);
  const dismissNotice = useCallback(() => {
    holdNotice();
    setNoticeText("");
    setNoticeAction(null);
  }, [holdNotice]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  return { notice, noticeAction, noticeAt, noticeOrdinary, setNotice, holdNotice, releaseNotice, dismissNotice, reportNoticesRef };
}
