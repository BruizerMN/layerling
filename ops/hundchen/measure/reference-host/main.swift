// HundchenLayerling PoC - Stage C (throwaway). Native document workflow around the static Layerling editor.
// File on disk = the document. Writes only happen inside a user-initiated Save / Save As, via a staged file + atomic replace.
import AppKit
import WebKit
import Darwin
import CryptoKit
import UniformTypeIdentifiers

let launchUptime = ProcessInfo.processInfo.systemUptime
func now() -> Double { ProcessInfo.processInfo.systemUptime }
func since() -> String { String(format: "%.3f", now() - launchUptime) }

// REFERENCE HOST for the measurement harness (throwaway; moves to the macOS repository). A copy of the Stage C proof-of-concept app with isolated roots (--poc-root), an isolated WebKit data store (--store-id) and --ls injection.
let args = CommandLine.arguments
func argValue(_ name: String) -> String? { if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }; return nil }
let pocRoot = URL(fileURLWithPath: argValue("--poc-root") ?? (NSTemporaryDirectory() + "layerling-reference-host"))
let resultsDir = pocRoot.appendingPathComponent("results")
let controlDir = pocRoot.appendingPathComponent("control")
let supportDir = pocRoot.appendingPathComponent("support")
let baseHost: String? = argValue("--base-url").flatMap { URL(string: $0)?.host }
try? FileManager.default.createDirectory(at: resultsDir, withIntermediateDirectories: true)
try? FileManager.default.createDirectory(at: controlDir, withIntermediateDirectories: true)
let allowNet = args.contains("--allow-net")
let scheme = "layerling"
try? FileManager.default.createDirectory(at: supportDir, withIntermediateDirectories: true)

var logHandle: FileHandle? = {
    let u = resultsDir.appendingPathComponent("console.log")
    FileManager.default.createFile(atPath: u.path, contents: nil)
    return try? FileHandle(forWritingTo: u)
}()
func log(_ s: String) {
    let line = "[\(since())] \(s)\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
    logHandle?.write(line.data(using: .utf8)!)
}
struct SaveError: Error, CustomStringConvertible { let description: String; init(_ d: String) { description = d } }

// MARK: staged write session
final class WriteSession {
    let id = UUID().uuidString
    let dest: URL, tempDir: URL, staging: URL, fh: FileHandle
    var bytes: Int64 = 0, chunks = 0
    let started = now()
    init(dest: URL) throws {
        self.dest = dest
        tempDir = try FileManager.default.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: dest, create: true)
        staging = tempDir.appendingPathComponent(dest.lastPathComponent)
        FileManager.default.createFile(atPath: staging.path, contents: nil)
        fh = try FileHandle(forWritingTo: staging)
    }
    func discard() { try? fh.close(); try? FileManager.default.removeItem(at: tempDir) }
}

// MARK: scheme handler
final class SiteHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    var requests = 0, bytes = 0, notFound: [String] = [], paths: [String] = []
    var tokens: [String: URL] = [:]
    var stopped = Set<ObjectIdentifier>()
    init(root: URL) { self.root = root.standardizedFileURL }
    static let mime: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8", "json": "application/json", "wasm": "application/wasm", "png": "image/png",
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "svg": "image/svg+xml", "woff2": "font/woff2", "woff": "font/woff",
        "ttf": "font/ttf", "otf": "font/otf", "txt": "text/plain; charset=utf-8", "webmanifest": "application/manifest+json",
        "ico": "image/x-icon", "pdf": "application/pdf", "xml": "application/xml", "bin": "application/octet-stream"]
    func reply(_ task: WKURLSchemeTask, _ code: Int, _ body: String, type: String = "application/json") {
        let r = HTTPURLResponse(url: task.request.url!, statusCode: code, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"])!
        task.didReceive(r); task.didReceive(Data(body.utf8)); task.didFinish()
    }
    // POST /__w__/<session>?offset=N  (Uint8Array body) -> staged file
    func writeChunk(_ task: WKURLSchemeTask, id: String) {
        let url = task.request.url!
        let offset = Int64(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "offset" })?.value ?? "") ?? -1
        guard let body = task.request.httpBody else { reply(task, 400, "{\"error\":\"no httpBody\"}"); return }
        do {
            try theController.appendChunk(id: id, offset: offset, data: body)
            reply(task, 200, "{\"ok\":true,\"written\":\(body.count)}")
        } catch { reply(task, 500, "{\"error\":\"\(error)\"}") }
    }
    func sink(_ task: WKURLSchemeTask, name: String) {   // used for recovery extraction: append chunks into Recovery folder
        let url = task.request.url!
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let append = q.contains { $0.name == "append" && $0.value == "1" }
        let dir = supportDir.appendingPathComponent("Recovery"); try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(name.replacingOccurrences(of: "/", with: "_"))
        if !append { FileManager.default.createFile(atPath: dest.path, contents: nil) }
        var n = 0
        if let body = task.request.httpBody, let fh = try? FileHandle(forWritingTo: dest) { fh.seekToEndOfFile(); try? fh.write(contentsOf: body); try? fh.close(); n = body.count }
        reply(task, 200, "{\"received\":\(n),\"path\":\"\(dest.path)\"}")
    }
    func serveFile(_ task: WKURLSchemeTask, token: String) {
        let url = task.request.url!
        guard let file = tokens[token], let fh = try? FileHandle(forReadingFrom: file),
              let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value else {
            reply(task, 404, "no such file token", type: "text/plain"); return }
        let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": "application/octet-stream", "Content-Length": String(size), "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"])!
        task.didReceive(r)
        let id = ObjectIdentifier(task as AnyObject); let started = now(); var sent: Int64 = 0
        func pump() {
            if stopped.contains(id) { stopped.remove(id); try? fh.close(); return }
            var done = false
            autoreleasepool {
                let chunk = (try? fh.read(upToCount: 4 << 20)) ?? Data()
                if chunk.isEmpty { done = true } else { sent += Int64(chunk.count); task.didReceive(chunk) }
            }
            if done { task.didFinish(); try? fh.close(); log(String(format: "served %@ %lld bytes in %.3fs", file.lastPathComponent, sent, now() - started)) }
            else { DispatchQueue.main.async { pump() } }
        }
        pump()
    }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let url = task.request.url!
        var path = url.path.removingPercentEncoding ?? url.path
        if path.hasPrefix("/__w__/") { writeChunk(task, id: String(path.dropFirst("/__w__/".count))); return }
        if path.hasPrefix("/__sink__/") { sink(task, name: String(path.dropFirst("/__sink__/".count))); return }
        if path.hasPrefix("/__file__/") { serveFile(task, token: String(path.dropFirst("/__file__/".count))); return }
        if path.isEmpty || path.hasSuffix("/") { path += "index.html" }
        var file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        var isDir: ObjCBool = false
        let fm = FileManager.default
        if fm.fileExists(atPath: file.path, isDirectory: &isDir), isDir.boolValue { file.appendPathComponent("index.html") }
        else if !fm.fileExists(atPath: file.path) { let h = file.appendingPathExtension("html"); if fm.fileExists(atPath: h.path) { file = h } }
        requests += 1; paths.append(path)
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            notFound.append(path); log("404 \(path)"); reply(task, 404, "not found", type: "text/plain"); return }
        bytes += data.count
        let type = SiteHandler.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"])!
        task.didReceive(r); task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { stopped.insert(ObjectIdentifier(task as AnyObject)) }
}

// MARK: injected script
let injected = """
(function(){
  const post = (k, v) => { try { window.webkit.messageHandlers.poc.postMessage({k, v}); } catch(e){} };
  const rpc = (o) => window.webkit.messageHandlers.pocReply.postMessage(o);
  try { localStorage.setItem('layerling.fileBackups.settings', JSON.stringify({overwriteCount:0, snapshotMinutes:0, reminderDays:0})); } catch(e){}
  for (const lvl of ['log','info','warn','error']) {
    const o = console[lvl].bind(console);
    console[lvl] = (...a) => { try { post('console.'+lvl, a.map(x => { try { return typeof x==='string'?x:(x&&x.stack)||JSON.stringify(x); } catch(e){ return String(x);} }).join(' ').slice(0,600)); } catch(e){} o(...a); };
  }
  addEventListener('error', e => post('window.error', (e.message||'')+' @'+(e.filename||'')+':'+(e.lineno||'')));
  addEventListener('unhandledrejection', e => post('unhandledrejection', String(e.reason&&e.reason.stack||e.reason).slice(0,600)));
  const ext = u => { try { return new URL(u, location.href).origin !== location.origin; } catch(e){ return false; } };
  const f = window.fetch; window.fetch = function(i, o){ const u = (i&&i.url)||String(i); if (ext(u)) post('net.fetch', u); return f.apply(this, arguments); };
  const W = window.Worker; window.__workers = []; window.__peakActiveBlobWorkers = 0;
  const S = window.__workerStats = { blobCreated: 0, blobAlive: 0, blobMaxAlive: 0, blobTerminated: 0, faults: 0 };
  const fault = window.__workerFault || null; let blobSeen = 0;
  window.__phase = []; const mark = (k) => window.__phase.push([Math.round(performance.now()), k]);
  mark('start vis=' + document.visibilityState); document.addEventListener('visibilitychange', () => mark('vis=' + document.visibilityState));
  new MutationObserver((ms) => { for (const m of ms) { const t = (m.target && m.target.textContent) || ''; if (t.length < 200 && /Validating|Still opening/.test(t)) { const k = t.replace(/\\d+ s\\b/, 'N s').slice(0, 70); if (window.__lastNotice !== k) { window.__lastNotice = k; mark('notice: ' + k); } } } }).observe(document, { subtree: true, characterData: true, childList: true });
  const bump = () => { S.blobCreated++; if (S.blobCreated === 1) mark('first blob worker'); if (S.blobCreated === 2) mark('second blob worker'); if (S.blobCreated === 100) mark('100th blob worker'); if (S.blobCreated === 450) mark('450th blob worker'); S.blobAlive++; if (S.blobAlive > S.blobMaxAlive) S.blobMaxAlive = S.blobAlive; };
  const fakeWorker = (mode) => { const fw = { onmessage: null, onerror: null, onmessageerror: null, _t: false, postMessage() {}, addEventListener() {}, removeEventListener() {},
      terminate() { if (!fw._t) { fw._t = true; S.blobTerminated++; S.blobAlive--; } } };
    if (mode === 'error') setTimeout(() => { fw.onerror && fw.onerror({ error: new Error('injected worker error'), message: 'injected' }); }, 5);
    return fw; };
  const mk = (u, o) => { const isBlob = String(u).startsWith('blob:');
    if (isBlob) { blobSeen++; if (fault && blobSeen <= (fault.limit || Infinity) && blobSeen % fault.every === 0) { S.faults++; post('fault.injected', fault.mode + ' #' + blobSeen); if (fault.mode === 'throw') throw new Error('injected: Worker creation failed'); bump(); return fakeWorker(fault.mode); } }
    const rec = {url: String(u), t: performance.now()|0, errors: []}; window.__workers.push(rec); const w = new W(u, o);
    w.addEventListener('error', e => { rec.errors.push((e.message||'error')); post('worker.error', rec.url+' '+e.message); });
    if (isBlob) { bump(); const t = w.terminate.bind(w); let done = false; w.terminate = () => { if (!done) { done = true; S.blobTerminated++; S.blobAlive--; } return t(); }; }
    return w; };
  // Optional cap on concurrent *blob* workers (fflate starts one per zip entry: 8,6xx for Foshay). CAD workers are never capped.
  const cap = window.__workerCap || 0; let active = 0; const waiting = [];
  const pump = () => { while (active < cap && waiting.length) waiting.shift().start(); };
  window.Worker = function(u, o){
    if (!cap || !String(u).startsWith('blob:')) return mk(u, o);
    const px = { onmessage: null, onerror: null, onmessageerror: null, _q: [], _w: null, _l: [],
      postMessage(m, t) { if (this._w) this._w.postMessage(m, t); else this._q.push([m, t]); },
      addEventListener(t, f) { this._l.push([t, f]); }, removeEventListener() {},
      terminate() { if (this._w) { this._w.terminate(); this._w = null; active--; pump(); } else { const i = waiting.indexOf(this); if (i >= 0) waiting.splice(i, 1); } },
      start() { active++; if (active > window.__peakActiveBlobWorkers) window.__peakActiveBlobWorkers = active; const w = mk(u, o); this._w = w;
        w.onmessage = e => this.onmessage && this.onmessage(e); w.onerror = e => this.onerror && this.onerror(e); w.onmessageerror = e => this.onmessageerror && this.onmessageerror(e);
        for (const [t, f] of this._l) w.addEventListener(t, f); for (const [m, t] of this._q) w.postMessage(m, t); this._q = []; } };
    waiting.push(px); pump(); return px; };
  window.Worker.prototype = W.prototype;
  // --- change detection: Layerling saves its working copy to IndexedDB after every change ---
  const wrapPut = (name) => { const orig = IDBObjectStore.prototype[name]; IDBObjectStore.prototype[name] = function(){ try { const db = this.transaction && this.transaction.db && this.transaction.db.name; if (db === 'layerling.projectShapes' && this.name === 'projectShapes') post('doc.edit', name+' '+performance.now().toFixed(0)); } catch(e){} return orig.apply(this, arguments); }; };
  wrapPut('put'); wrapPut('add');
  // --- fast change signal: the editor keeps hidden summary/state elements that are rewritten on every scene change ---
  const hashStr = s => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };
  const watch = () => {
    const sum = document.querySelector('pre[data-codex-summary]'), st = document.querySelector('pre[data-codex-state]');
    if (!sum || !st) { setTimeout(watch, 500); return; }
    let timer = null;
    const compute = () => { timer = null; const a = sum.textContent, b = st.textContent; const ia = a.indexOf('count='), ib = b.indexOf('"shapeCount"');
      post('doc.sig', hashStr(a.slice(ia < 0 ? 0 : ia)) + '-' + hashStr(b.slice(ib < 0 ? 0 : ib))); };
    const schedule = () => { if (!timer) timer = setTimeout(compute, 300); };
    const opts = { subtree: true, characterData: true, childList: true };
    new MutationObserver(schedule).observe(sum, opts); new MutationObserver(schedule).observe(st, opts); schedule();
  };
  // --- native file bridge: File System Access subset + launchQueue ---
  const CH = 8 * 1024 * 1024; const names = {};
  const mkHandle = info => { names[info.token] = info.name; return { kind: 'file', get name() { return names[info.token]; }, __info: info,
    async getFile() { const t0 = performance.now(); const r = await fetch('/__file__/' + info.token); if (!r.ok) throw new DOMException('Could not read file', 'NotReadableError');
      const blob = await r.blob(); const ms = Math.round(performance.now() - t0); window.__lastFileFetch = { ms, bytes: blob.size, name: names[info.token] }; post('file.fetched', names[info.token] + ' ' + blob.size + ' bytes in ' + ms + ' ms');
      return new File([blob], names[info.token], { type: 'application/octet-stream', lastModified: info.mtime }); },
    async createWritable() {
      const w = await rpc({ op: 'wbegin', token: info.token }); let off = 0, done = false;
      const sendBytes = async (u8) => { for (let p = 0; p < u8.length; p += CH) { const part = u8.subarray(p, Math.min(u8.length, p + CH));
          const r = await fetch('/__w__/' + w.id + '?offset=' + off, { method: 'POST', body: part }); if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch(e){} throw new DOMException('Write failed: ' + m, 'NotAllowedError'); } off += part.length; } };
      return { async write(data) { if (done) throw new TypeError('closed');
          if (data instanceof Blob) { for (let p = 0; p < data.size; p += CH) await sendBytes(new Uint8Array(await data.slice(p, p + CH).arrayBuffer())); }
          else if (data instanceof ArrayBuffer) await sendBytes(new Uint8Array(data));
          else if (ArrayBuffer.isView(data)) await sendBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          else throw new TypeError('unsupported write data'); },
        async close() { done = true; return rpc({ op: 'wclose', id: w.id, total: off }); },
        async abort() { done = true; return rpc({ op: 'wabort', id: w.id }); } }; },
    async queryPermission(d) { if (d && d.mode === 'readwrite') return (await rpc({ op: 'perm', token: info.token })) ? 'granted' : 'prompt'; return 'granted'; },
    async requestPermission(d) { if (d && d.mode === 'readwrite') return (await rpc({ op: 'perm', token: info.token })) ? 'granted' : 'denied'; return 'granted'; },
    async isSameEntry(o) { return !!o && o.__info && o.__info.token === info.token; } }; };
  window.__setHandleName = (token, name) => { names[token] = name; };
  window.showOpenFilePicker = async () => { const info = await rpc({ op: 'open' }); if (!info) throw new DOMException('The user aborted a request.', 'AbortError'); return [mkHandle(info)]; };
  window.showSaveFilePicker = async () => { const info = await rpc({ op: 'savepicker' }); if (!info) throw new DOMException('The user aborted a request.', 'AbortError'); return mkHandle(info); };
  // After a failed write the web app unlinks the file and asks for a click on "Save project" before opening a picker; during a native Save we do that click.
  new MutationObserver(() => { if (!window.__saveActive) return; const b = [...document.querySelectorAll('button')].find(x => /^Save layerling design$/.test(x.innerText.trim())); if (b && !b.__poc) { b.__poc = true; post('save.autoclick', 'second-step button'); b.click(); } }).observe(document, { subtree: true, childList: true });
  let consumer = null; const pending = [];
  const flush = () => { if (consumer && pending.length) consumer({ files: pending.splice(0) }); };
  window.launchQueue = { setConsumer(cb) { consumer = cb; flush(); } };
  window.__nativeLaunch = info => { window.__launchAt = performance.now(); window.__docInfo = info; pending.push(mkHandle(info)); flush();
    const iv = setInterval(() => { if (document.querySelector('canvas') && [...document.querySelectorAll('button')].some(x => x.getAttribute('aria-label') === 'Add shape')) { clearInterval(iv); post('doc.ready', String(performance.now() - window.__launchAt | 0)); watch(); } }, 300); };
  // --- library UI is not part of the Mac document workflow ---
  const st = document.createElement('style'); st.textContent = 'button[aria-label="Home dashboard"]{display:none!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
})();
"""

enum Choice { case save, dontSave, cancel }

var theController: Controller!

final class Controller: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply, WKUIDelegate, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation {
    var window: NSWindow!
    var web: WKWebView!
    var placeholder: NSView!
    var handler: SiteHandler!
    var navStart = 0.0
    var messages: [String: Int] = [:]
    var netAttempts: [String] = []

    // document state
    var docURL: URL?
    var docToken = ""
    var dirty = false
    var editCounter = 0
    var armed = false
    var armTimer: Timer?
    var lastSig: String?, baselineSig: String?, saveStartSig: String?
    var docReady = false
    var pendingOpen: URL?
    var openT0 = 0.0
    // save state
    var saveActive = false
    var saveStartEpoch = 0
    var saveT0 = 0.0
    var saveDone: ((Bool) -> Void)?
    var saveWatchdog: Timer?
    var savePreviousURL: URL?
    var sessions: [String: WriteSession] = [:]
    var failMode: String?
    var allowCloseNow = false
    var saveLog: [String] = []
    var rulesAdded = false
    var cleanedStores = false
    var activityToken: NSObjectProtocol?

    func applicationDidFinishLaunching(_ n: Notification) {
        theController = self
        let site = Bundle.main.resourceURL!.appendingPathComponent("site")
        handler = SiteHandler(root: site)
        let cfg = WKWebViewConfiguration()
        if let sid = argValue("--store-id"), let uuid = UUID(uuidString: sid) { cfg.websiteDataStore = WKWebsiteDataStore(forIdentifier: uuid) }
        cfg.setURLSchemeHandler(handler, forURLScheme: scheme)
        cfg.userContentController.add(self, name: "poc")
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "pocReply")
        var capJS = ""; if let i = args.firstIndex(of: "--worker-cap"), i + 1 < args.count { capJS = "window.__workerCap = \(Int(args[i + 1]) ?? 0);\n" }
        if let wf = argValue("--worker-fault") { let p = wf.split(separator: ":").map(String.init); capJS += "window.__workerFault = { mode: \(jsString(p[0])), every: \(p.count > 1 ? (Int(p[1]) ?? 1) : 1), limit: \(p.count > 2 ? (Int(p[2]) ?? 0) : 0) };\n" }
        for (i, a) in args.enumerated() where a == "--ls" && i + 1 < args.count { let kv = args[i + 1].split(separator: "=", maxSplits: 1).map(String.init); if kv.count == 2 { capJS += "try { localStorage.setItem(\(jsString(kv[0])), \(jsString(kv[1]))); } catch (e) {}\n" } }
        cfg.userContentController.addUserScript(WKUserScript(source: capJS + injected, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900), configuration: cfg)
        web.isInspectable = true
        web.navigationDelegate = self
        web.uiDelegate = self
        let container = NSView(frame: web.frame)
        web.autoresizingMask = [.width, .height]
        container.addSubview(web)
        let label = NSTextField(labelWithString: "No document open\nChoose File ▸ Open… (⌘O) to open a .lyl file")
        label.alignment = .center; label.font = .systemFont(ofSize: 18); label.textColor = .secondaryLabelColor
        label.frame = NSRect(x: 0, y: 380, width: 1440, height: 80); label.autoresizingMask = [.width, .minYMargin, .maxYMargin]
        let cover = NSView(frame: container.frame); cover.wantsLayer = true; cover.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        cover.autoresizingMask = [.width, .height]; cover.addSubview(label); placeholder = cover
        container.addSubview(cover)   // the web view stays "visible" (WebKit throttles hidden views) but is covered until a document is ready
        window = NSWindow(contentRect: container.frame, styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.contentView = container
        window.delegate = self
        window.center()
        updateWindow()
        // Benchmark hosting: never let the window be covered or the app napped, so page visibility (and WebKit's timer/process throttling) cannot skew a run.
        if !args.contains("--hide") { window.level = .floating; window.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary] }   // appear on the Space being looked at, even over a full-screen app
        activityToken = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleSystemSleepDisabled, .latencyCritical], reason: "benchmark host")
        window.makeKeyAndOrderFront(nil)
        buildMenu()
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main) { [self] _ in logWindowState("occlusion changed") }
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [self] _ in logWindowState("app became active") }
        NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [self] _ in logWindowState("app resigned active") }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [self] in logWindowState("1 s after launch") }
        if args.contains("--hide") { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { NSApp.hide(nil); log("app hidden (--hide): the page is not visible") } }   // test of background-page timer throttling
        loadSite()
        Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [self] _ in pollControl() }
        let tl = resultsDir.appendingPathComponent("mem-timeline.csv")
        FileManager.default.createFile(atPath: tl.path, contents: "t_s,app_mb,webcontent_mb,webcontent_peak_mb\n".data(using: .utf8))
        let tlh = try? FileHandle(forWritingTo: tl); tlh?.seekToEndOfFile()
        Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [self] _ in
            let m = memory(); let f = { (k: String) -> String in String(format: "%.0f", (m[k] as? Double) ?? 0) }
            tlh?.write("\(since()),\(f("app_mb")),\(f("webcontent_mb")),\(f("webcontent_peak_mb"))\n".data(using: .utf8)!)
        }
        if let i = args.firstIndex(of: "--open"), i + 1 < args.count { pendingOpen = URL(fileURLWithPath: args[i + 1]) }
        checkRecoveryLeftover()
    }

    func logWindowState(_ tag: String) {
        let visible = window.occlusionState.contains(.visible)
        log("window[\(tag)]: isVisible=\(window.isVisible) occlusionVisible=\(visible) key=\(window.isKeyWindow) appActive=\(NSApp.isActive) activeSpace=\(window.isOnActiveSpace) screen=\(window.screen?.localizedName ?? "none") level=\(window.level.rawValue) mini=\(window.isMiniaturized)")
    }
    func loadSite() {
        let go = { [self] in navStart = now(); web.load(URLRequest(url: URL(string: argValue("--base-url") ?? "\(scheme)://app\(argValue("--url") ?? "/")")!)) }
        if allowNet { go(); return }
        let rules = #"[{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}}]"#
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "blocknet", encodedContentRuleList: rules) { [self] list, err in
            if let list, !rulesAdded { web.configuration.userContentController.add(list); rulesAdded = true }
            go()
        }
    }

    // MARK: menu
    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem); let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Quit LayerlingPoC", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let fileItem = NSMenuItem(); main.addItem(fileItem); let fileMenu = NSMenu(title: "File"); fileItem.submenu = fileMenu
        func add(_ title: String, _ sel: Selector, _ key: String, _ mods: NSEvent.ModifierFlags = [.command]) {
            let i = NSMenuItem(title: title, action: sel, keyEquivalent: key); i.keyEquivalentModifierMask = mods; i.target = self; fileMenu.addItem(i) }
        add("Open…", #selector(menuOpen(_:)), "o")
        fileMenu.addItem(.separator())
        add("Close", #selector(menuClose(_:)), "w")
        add("Save", #selector(menuSave(_:)), "s")
        add("Save As…", #selector(menuSaveAs(_:)), "s", [.command, .shift])
        let editItem = NSMenuItem(); main.addItem(editItem); let editMenu = NSMenu(title: "Edit"); editItem.submenu = editMenu
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        NSApp.mainMenu = main
    }
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(menuSave(_:)), #selector(menuSaveAs(_:)): return docURL != nil && docReady && !saveActive
        case #selector(menuClose(_:)): return true
        default: return true
        }
    }
    @objc func menuOpen(_ s: Any?) { chooseToOpen { [self] info in if let info, let p = info["path"] as? String { openDocument(URL(fileURLWithPath: p)) } } }
    @objc func menuSave(_ s: Any?) { performSave { _ in } }
    @objc func menuSaveAs(_ s: Any?) { chooseSaveAs { [self] url in if let url { saveAs(url) { _ in } } } }
    @objc func menuClose(_ s: Any?) { window.performClose(nil) }

    // MARK: window title / edited state
    func updateWindow() {
        window.title = (docURL?.lastPathComponent ?? "HundchenLayerling PoC") + (saveActive ? " — Saving…" : "")
        window.representedURL = docURL
        window.isDocumentEdited = dirty
    }
    func setDirty(_ d: Bool) {
        if d == dirty { return }
        dirty = d; updateWindow(); log("dirty = \(d)")
        let marker = supportDir.appendingPathComponent("dirty-session.json")
        if d { try? "{\"doc\":\"\(docURL?.path ?? "")\",\"since\":\(Date().timeIntervalSince1970)}".write(to: marker, atomically: true, encoding: .utf8) }
        else { try? FileManager.default.removeItem(at: marker) }
    }

    // MARK: open
    func fileInfo(_ url: URL) -> [String: Any] {
        let token = UUID().uuidString
        handler.tokens[token] = url
        let attrs = (try? FileManager.default.attributesOfItem(atPath: url.path)) ?? [:]
        return ["token": token, "name": url.lastPathComponent, "path": url.path, "size": (attrs[.size] as? NSNumber)?.int64Value ?? 0,
                "mtime": ((attrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000]
    }
    func chooseToOpen(completion: @escaping ([String: Any]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "lyl") ?? .data]
        panel.allowsMultipleSelection = false; panel.canChooseDirectories = false
        panel.message = "Choose a Layerling design (.lyl)"
        panel.beginSheetModal(for: window) { [self] resp in
            guard resp == .OK, let url = panel.url else { completion(nil); return }
            completion(["path": url.path])
        }
    }
    /// Opens a document. If one is open, it is closed first (asking about unsaved changes); the page is reloaded so no state leaks.
    func openDocument(_ url: URL) {
        if docURL != nil {
            confirmDiscardIfDirty { [self] ok in
                guard ok else { return }
                purgeJournal { [self] in resetToEmpty(); pendingOpen = url; loadSite() }
            }
        } else { launch(url) }
    }
    func resetToEmpty() { docURL = nil; docReady = false; dirty = false; armed = false; armTimer?.invalidate(); editCounter = 0; placeholder.isHidden = false; updateWindow()
        try? FileManager.default.removeItem(at: supportDir.appendingPathComponent("dirty-session.json")) }
    func launch(_ url: URL) {
        let info = fileInfo(url)
        docURL = url; docToken = info["token"] as! String; docReady = false; dirty = false; armed = false; editCounter = 0; lastSig = nil; baselineSig = nil
        openT0 = now(); updateWindow()
        let json = String(data: try! JSONSerialization.data(withJSONObject: info), encoding: .utf8)!
        log("open \(url.path)")
        web.evaluateJavaScript("window.__nativeLaunch(\(json))", completionHandler: nil)
    }
    func documentReady(ms: String) {
        logWindowState("document ready")
        docReady = true; placeholder.isHidden = true
        log("document ready (JS \(ms) ms; native \(String(format: "%.1f", now() - openT0)) s since open)")
        scheduleArm()
        window.makeFirstResponder(web)
    }
    func scheduleArm() {
        armTimer?.invalidate()
        armTimer = Timer.scheduledTimer(withTimeInterval: 4.0, repeats: false) { [self] _ in armed = true; baselineSig = lastSig; log("change tracking armed (baseline \(lastSig ?? "none"))") }
    }

    // JS showOpenFilePicker (e.g. editor's own open buttons) -> native panel
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let d = m.body as? [String: Any], let op = d["op"] as? String else { replyHandler(nil, "bad message"); return }
        switch op {
        case "open":
            chooseToOpen { [self] info in
                guard let info, let p = info["path"] as? String else { replyHandler(nil, nil); return }
                DispatchQueue.main.async { self.openDocument(URL(fileURLWithPath: p)) }   // opens as the document, not via a library import
                replyHandler(nil, nil)
            }
        case "savepicker":
            if saveActive, let u = handler.tokens[docToken] { var i = fileInfo(u); i["token"] = docToken; handler.tokens[docToken] = u; replyHandler(i, nil) } else { replyHandler(nil, nil) }
        case "perm":
            replyHandler(saveActive && (d["token"] as? String) == docToken, nil)
        case "wbegin":
            guard saveActive, (d["token"] as? String) == docToken, let dest = handler.tokens[docToken] else {
                log("REFUSED write: no user-initiated save in progress"); replyHandler(nil, "Writing is only allowed during Save or Save As"); return }
            do {
                let s = try WriteSession(dest: dest); sessions[s.id] = s
                saveWatchdog?.invalidate(); log("write begin -> \(dest.lastPathComponent) (staging \(s.staging.path))")
                replyHandler(["id": s.id], nil)
            } catch { finishSave(false, "Could not create a staging file: \(error)"); replyHandler(nil, "\(error)") }
        case "wclose":
            guard let id = d["id"] as? String, let total = (d["total"] as? NSNumber)?.int64Value else { replyHandler(nil, "bad close"); return }
            do { let r = try commit(id: id, total: total); replyHandler(["ok": true, "bytes": r.0, "sha256": r.1], nil); finishSave(true, "") }
            catch { replyHandler(nil, "\(error)"); finishSave(false, "\(error)") }
        case "wabort":
            if let id = d["id"] as? String, let s = sessions.removeValue(forKey: id) { s.discard(); log("write aborted") }
            replyHandler(nil, nil); if saveActive { finishSave(false, "The editor aborted the write") }
        default: replyHandler(nil, "unknown op")
        }
    }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let d = m.body as? [String: Any], let k = d["k"] as? String else { return }
        let v = (d["v"] as? String) ?? ""
        messages[k, default: 0] += 1
        if k == "doc.ready" { documentReady(ms: v); return }
        if k == "doc.edit" {   // slow signal (IndexedDB working-copy write): informational only, it trails edits by up to a minute
            editCounter += 1; log("working copy written to IndexedDB (journal) #\(editCounter) put@\(v)"); if !armed && docReady { scheduleArm() }
            return }
        if k == "doc.sig" {
            if lastSig != v { lastSig = v; if !armed { if docReady { scheduleArm() } } else if baselineSig == nil { baselineSig = v; log("baseline set late (\(v))") } else if let b = baselineSig { let d = v != b; if d != dirty { log("scene signature \(d ? "changed" : "back to saved state") (\(v))") }; setDirty(d) } }
            return }
        if k.hasPrefix("net.") { netAttempts.append("\(k) \(v)") }
        if messages[k]! <= 30 { log("js \(k): \(v)") }
    }

    // MARK: staged write
    func appendChunk(id: String, offset: Int64, data: Data) throws {
        guard let s = sessions[id] else { throw SaveError("unknown write session") }
        guard offset == s.bytes else { throw SaveError("chunk offset \(offset) != \(s.bytes)") }
        s.chunks += 1
        if failMode == "midstream" && s.chunks == 2 { failMode = nil; s.discard(); sessions[id] = nil; log("TEST: injected mid-stream failure"); throw SaveError("injected failure") }
        try s.fh.write(contentsOf: data); s.bytes += Int64(data.count)
    }
    func commit(id: String, total: Int64) throws -> (Int64, String) {
        guard let s = sessions.removeValue(forKey: id) else { throw SaveError("unknown write session") }
        defer { s.discard() }
        try s.fh.synchronize(); try s.fh.close()
        let size = (try FileManager.default.attributesOfItem(atPath: s.staging.path)[.size] as? NSNumber)?.int64Value ?? -1
        guard size == total, size == s.bytes else { throw SaveError("staged size \(size) does not match \(total) bytes the editor wrote") }
        // Validate it is a ZIP (a .lyl package): local header at the start, end-of-central-directory near the end.
        let rf = try FileHandle(forReadingFrom: s.staging); defer { try? rf.close() }
        let head = try rf.read(upToCount: 4) ?? Data()
        try rf.seek(toOffset: UInt64(max(0, size - 22))); let tail = try rf.readToEnd() ?? Data()
        guard head == Data([0x50, 0x4B, 0x03, 0x04]), tail.starts(with: [0x50, 0x4B, 0x05, 0x06]) else { throw SaveError("staged file is not a valid .lyl (ZIP) package") }
        if failMode == "commit" { failMode = nil; log("TEST: injected commit failure"); throw SaveError("injected failure before replace") }
        var coordErr: NSError?; var thrown: Error?
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: s.dest, options: .forReplacing, error: &coordErr) { target in
            do {
                if FileManager.default.fileExists(atPath: target.path) { _ = try FileManager.default.replaceItemAt(target, withItemAt: s.staging, backupItemName: nil, options: []) }
                else { try FileManager.default.moveItem(at: s.staging, to: target) }
            } catch { thrown = error }
        }
        if let e = coordErr ?? thrown as NSError? { throw SaveError("replace failed: \(e.localizedDescription)") }
        // checksum of what is now on disk (for the log/report)
        var hasher = SHA256(); let vf = try FileHandle(forReadingFrom: s.dest); defer { try? vf.close() }
        while let chunk = try vf.read(upToCount: 8 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        let hex = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        log(String(format: "write committed %@ %lld bytes sha256 %@ (%.2fs since save start)", s.dest.lastPathComponent, size, String(hex.prefix(16)), now() - saveT0))
        return (size, hex)
    }

    // MARK: save / save as
    func performSave(_ done: @escaping (Bool) -> Void) {
        guard docURL != nil, docReady, !saveActive else { done(false); return }
        saveActive = true; saveStartEpoch = editCounter; saveStartSig = lastSig; saveT0 = now(); saveDone = done; updateWindow()
        log("SAVE started (editCounter=\(editCounter)) -> \(handler.tokens[docToken]?.path ?? "?")")
        saveWatchdog?.invalidate()
        web.evaluateJavaScript("window.__saveActive = true", completionHandler: nil)
        saveWatchdog = Timer.scheduledTimer(withTimeInterval: 120, repeats: false) { [self] _ in if saveActive && sessions.isEmpty { finishSave(false, "The editor did not start writing within 2 minutes (it may have refused to save).") } }
        web.evaluateJavaScript("document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'s',code:'KeyS',metaKey:true,bubbles:true,cancelable:true}))", completionHandler: nil)
    }
    func chooseSaveAs(completion: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "lyl") ?? .data]
        panel.nameFieldStringValue = docURL?.lastPathComponent ?? "Untitled.lyl"
        panel.directoryURL = docURL?.deletingLastPathComponent()
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { resp in completion(resp == .OK ? panel.url : nil) }
    }
    /// Save As: retarget the editor's file handle at the new location, then run the normal save. The original is never written.
    func saveAs(_ url: URL, _ done: @escaping (Bool) -> Void) {
        guard let current = handler.tokens[docToken], docReady, !saveActive else { done(false); return }
        savePreviousURL = current
        handler.tokens[docToken] = url
        web.evaluateJavaScript("window.__setHandleName(\(jsString(docToken)), \(jsString(url.lastPathComponent)))", completionHandler: nil)
        log("SAVE AS -> \(url.path)")
        performSave { [self] ok in
            if !ok, let prev = savePreviousURL { handler.tokens[docToken] = prev; web.evaluateJavaScript("window.__setHandleName(\(jsString(docToken)), \(jsString(prev.lastPathComponent)))", completionHandler: nil) }
            savePreviousURL = nil; done(ok) }
    }
    func jsString(_ s: String) -> String { String(data: try! JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)!.dropFirst().dropLast().description }
    func finishSave(_ ok: Bool, _ why: String) {
        guard saveActive else { return }
        saveActive = false; saveWatchdog?.invalidate(); web.evaluateJavaScript("window.__saveActive = false", completionHandler: nil)
        for (_, s) in sessions { s.discard() }; sessions.removeAll()
        let secs = now() - saveT0
        if ok {
            docURL = handler.tokens[docToken]
            baselineSig = saveStartSig
            if lastSig == saveStartSig { setDirty(false) } else { log("edits occurred while saving; document stays modified"); setDirty(true) }
            savePreviousURL = nil
            saveLog.append(String(format: "save ok %.2fs", secs)); log(String(format: "SAVE finished OK in %.2fs; dirty=%@", secs, dirty ? "true" : "false"))
        } else {
            saveLog.append("save FAILED: \(why)"); log("SAVE FAILED: \(why) — document remains modified, previous file untouched")
            if let prev = savePreviousURL { handler.tokens[docToken] = prev }
            if !args.contains("--no-alerts") && !testMode { let a = NSAlert(); a.alertStyle = .warning; a.messageText = "The document could not be saved."; a.informativeText = why + "\n\nThe previously saved file was not changed."; a.beginSheetModal(for: window) { _ in } }
        }
        updateWindow()
        let cb = saveDone; saveDone = nil; cb?(ok)
    }
    var testMode: Bool { FileManager.default.fileExists(atPath: controlDir.appendingPathComponent("testmode").path) }

    // MARK: unsaved-changes handling
    func askUnsaved(_ completion: @escaping (Choice) -> Void) {
        let ans = controlDir.appendingPathComponent("alert.answer")
        if let a = try? String(contentsOf: ans, encoding: .utf8) {
            try? FileManager.default.removeItem(at: ans)
            let c: Choice = a.hasPrefix("save") ? .save : (a.hasPrefix("dont") ? .dontSave : .cancel); log("TEST: alert answered \(c)"); completion(c); return }
        let alert = NSAlert()
        alert.messageText = "Do you want to save the changes made to the document “\(docURL?.lastPathComponent ?? "Untitled")”?"
        alert.informativeText = "Your changes will be lost if you don't save them."
        alert.addButton(withTitle: "Save"); alert.addButton(withTitle: "Don't Save"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { r in completion(r == .alertFirstButtonReturn ? .save : (r == .alertSecondButtonReturn ? .dontSave : .cancel)) }
    }
    /// Calls back true when it is fine to discard the current document (clean, saved, or the user chose Don't Save).
    func confirmDiscardIfDirty(_ completion: @escaping (Bool) -> Void) {
        guard dirty else { completion(true); return }
        askUnsaved { [self] c in
            switch c {
            case .cancel: completion(false)
            case .dontSave: completion(true)
            case .save: performSave { ok in completion(ok) }
            }
        }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if allowCloseNow || !dirty { purgeJournalThenQuit(); return false }
        confirmDiscardIfDirty { [self] ok in if ok { purgeJournalThenQuit() } }
        return false
    }
    func purgeJournalThenQuit() { purgeJournal { [self] in allowCloseNow = true; NSApp.terminate(nil) } }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if allowCloseNow { return .terminateNow }
        if !dirty { purgeJournal { [self] in allowCloseNow = true; NSApp.reply(toApplicationShouldTerminate: true) }; return .terminateLater }
        confirmDiscardIfDirty { [self] ok in
            if ok { purgeJournal { [self] in allowCloseNow = true; NSApp.reply(toApplicationShouldTerminate: true) } }
            else { NSApp.reply(toApplicationShouldTerminate: false) }
        }
        return .terminateLater
    }

    /// Layerling's own working copy of the open design (IndexedDB) is only a journal: removed when the document is closed cleanly.
    func purgeJournal(_ done: @escaping () -> Void) {
        let js = "for (const n of ['layerling.projectShapes','layerling-design-thumbnails']) { await new Promise(r => { const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(); }); } return 'purged'"
        web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in log("journal purge: \(r)"); try? FileManager.default.removeItem(at: supportDir.appendingPathComponent("dirty-session.json")); done() }
    }

    // MARK: crash recovery (leftover marker from a session that ended with unsaved edits)
    var recoveryPending = false
    func checkRecoveryLeftover() {
        let marker = supportDir.appendingPathComponent("dirty-session.json")
        guard FileManager.default.fileExists(atPath: marker.path) else { return }
        log("RECOVERY: previous session ended with unsaved changes; journal kept (marker \(marker.path))")
        recoveryPending = true
    }
    func offerRecovery() {
        let marker = supportDir.appendingPathComponent("dirty-session.json")
        let doc = (try? JSONSerialization.jsonObject(with: Data(contentsOf: marker)) as? [String: Any])?["doc"] as? String ?? "a document"
        func act(_ c: Choice) {
            switch c {
            case .save:   // Recover: write the journal copy to the Recovery folder (never over the original) and open that
                recoverJournal { [self] r in
                    log("RECOVERY result: \(r)")
                    let parts = r.split(separator: ":").map(String.init)
                    if parts.count >= 3, parts[0] == "recovered" {
                        try? FileManager.default.removeItem(at: marker)
                        let url = supportDir.appendingPathComponent("Recovery/\(parts[1])")
                        if docURL == nil { purgeJournalKeepingRecovery { [self] in launchAfterRecovery(url) } }
                    } else { let a = NSAlert(); a.messageText = "Nothing could be recovered."; a.beginSheetModal(for: window) { _ in } }
                }
            case .dontSave: try? FileManager.default.removeItem(at: marker); purgeJournal { log("RECOVERY: discarded by user") }
            case .cancel: log("RECOVERY: postponed")
            }
        }
        let ans = controlDir.appendingPathComponent("alert.answer")
        if let a = try? String(contentsOf: ans, encoding: .utf8) { try? FileManager.default.removeItem(at: ans); act(a.hasPrefix("save") ? .save : (a.hasPrefix("dont") ? .dontSave : .cancel)); return }
        let alert = NSAlert(); alert.messageText = "LayerlingPoC quit unexpectedly with unsaved changes."
        alert.informativeText = "The last working copy of “\((doc as NSString).lastPathComponent)” can be recovered as a new file. Your original document is not changed."
        alert.addButton(withTitle: "Recover"); alert.addButton(withTitle: "Discard"); alert.addButton(withTitle: "Not Now")
        alert.beginSheetModal(for: window) { r in act(r == .alertFirstButtonReturn ? .save : (r == .alertSecondButtonReturn ? .dontSave : .cancel)) }
    }
    func purgeJournalKeepingRecovery(_ done: @escaping () -> Void) { purgeJournal(done) }
    func launchAfterRecovery(_ url: URL) { launch(url) }
    func recoverJournal(completion: @escaping (String) -> Void) {   // extracts newest working copy to the Recovery folder (never over the original)
        let js = """
        const rec = await new Promise(res => { const q = indexedDB.open('layerling.projectShapes'); q.onerror = () => res(null); q.onsuccess = () => { const db = q.result; if (!db.objectStoreNames.contains('projectShapes')) return res(null);
          const all = db.transaction('projectShapes').objectStore('projectShapes').getAll(); all.onsuccess = () => res(all.result.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null); }; });
        if (!rec || !rec.lylPackage) return 'nothing to recover';
        const u8 = new Uint8Array(rec.lylPackage); const CH = 8 * 1024 * 1024; const name = 'recovered-' + new Date().toISOString().replace(/[:.]/g, '-') + '.lyl';
        for (let p = 0, first = true; p < u8.length; p += CH, first = false) { const r = await fetch('/__sink__/' + name + (first ? '' : '?append=1'), { method: 'POST', body: u8.subarray(p, Math.min(u8.length, p + CH)) }); if (!r.ok) return 'write failed'; }
        return 'recovered:' + name + ':' + u8.length;
        """
        web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
            if case .success(let v) = r { completion("\(v ?? "")") } else { completion("error \(r)") } }
    }

    // MARK: web view delegates
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        log(String(format: "page loaded %.3fs after navigation start", now() - navStart))
        // Harness only: remove WebKit data stores of earlier runs, once the page is up (calling this during launch raced and crashed).
        if args.contains("--cleanup-stores") && !cleanedStores {
            cleanedStores = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { WKWebsiteDataStore.fetchAllDataStoreIdentifiers { ids in for id in ids where id.uuidString != argValue("--store-id") { WKWebsiteDataStore.remove(forIdentifier: id) { _ in } } } }
        }
        if let p = pendingOpen { pendingOpen = nil; launch(p) }
        else if recoveryPending { recoveryPending = false; offerRecovery() }
    }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { log("didFail \(e)") }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { log("didFailProvisional \(e)") }
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) { log("!! WebContent process terminated") }
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, u.scheme != scheme, u.scheme != "about", u.scheme != "blob", u.host != baseHost || baseHost == nil { log("external link -> \(u) (default browser)"); NSWorkspace.shared.open(u); decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url, u.scheme?.hasPrefix("http") == true { NSWorkspace.shared.open(u) }
        return nil
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    // MARK: process info
    func webPID() -> Int32? { (web.value(forKey: "_webProcessIdentifier") as? NSNumber)?.int32Value }
    func rusage(_ pid: Int32) -> rusage_info_current? {
        var ri = rusage_info_current()
        let r = withUnsafeMutablePointer(to: &ri) { p in p.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_CURRENT, $0) } }
        return r == 0 ? ri : nil
    }
    func memory() -> [String: Any] {
        var m: [String: Any] = [:]
        if let r = rusage(getpid()) { m["app_mb"] = Double(r.ri_phys_footprint) / 1_048_576 }
        if let p = webPID(), let r = rusage(p) { m["webcontent_pid"] = p; m["webcontent_mb"] = Double(r.ri_phys_footprint) / 1_048_576; m["webcontent_peak_mb"] = Double(r.ri_lifetime_max_phys_footprint) / 1_048_576 }
        return m
    }
    func writeJSON(_ o: Any, to name: String) {
        if let d = try? JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed]) { try? d.write(to: controlDir.appendingPathComponent(name)) }
    }

    // MARK: control channel (test automation)
    let ctlQ = DispatchQueue(label: "poc.control")
    var polling = false
    var inbox: [String: String] = [:]
    static let ctlNames = ["cmd.js", "snap.request", "mem.request", "open.request", "save.request", "saveas.request", "fail.request", "close.request", "recover.request", "state.request"]
    /// File reads happen off the main thread (a slow/blocked file system must never freeze the UI); handling happens on main.
    func pollControl() {
        if polling { return }; polling = true
        ctlQ.async { [self] in
            var got: [String: String] = [:]
            let fm = FileManager.default
            for n in Controller.ctlNames {
                let u = controlDir.appendingPathComponent(n)
                if fm.fileExists(atPath: u.path) { got[n] = (try? String(contentsOf: u, encoding: .utf8)) ?? ""; try? fm.removeItem(at: u) }
            }
            DispatchQueue.main.async { [self] in polling = false; if !got.isEmpty { inbox = got; handleControl() } }
        }
    }
    func handleControl() {
        let fm = FileManager.default
        func take(_ n: String) -> String? { guard let s = inbox[n] else { return nil }; inbox[n] = nil; return s.trimmingCharacters(in: .whitespacesAndNewlines) }
        if let src = inbox["cmd.js"] {
            inbox["cmd.js"] = nil
            web.callAsyncJavaScript(src, arguments: [:], in: nil, in: .page) { [self] r in
                switch r { case .success(let v): writeJSON(["result": v ?? NSNull()], to: "cmd.out.json"); case .failure(let e): writeJSON(["error": "\(e)"], to: "cmd.out.json") } }
        }
        if take("snap.request") != nil { web.takeSnapshot(with: nil) { img, _ in
            if let img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) { try? png.write(to: resultsDir.appendingPathComponent("snap.png")) } } }
        if take("mem.request") != nil { writeJSON(memory(), to: "mem.out.json") }
        if let p = take("open.request") { openDocument(URL(fileURLWithPath: p)) }
        if take("save.request") != nil { performSave { [self] ok in writeJSON(["saved": ok, "dirty": dirty], to: "save.out.json") } }
        if let p = take("saveas.request") { saveAs(URL(fileURLWithPath: p)) { [self] ok in writeJSON(["saved": ok, "dirty": dirty, "doc": docURL?.path ?? ""], to: "save.out.json") } }
        if let m = take("fail.request") { failMode = m; log("TEST: failure mode armed: \(m)") }
        if let w = take("close.request") { log("TEST: simulated \(w)"); if w == "quit" { NSApp.terminate(nil) } else { _ = windowShouldClose(window) } }
        if take("recover.request") != nil { recoverJournal { [self] r in writeJSON(["recover": r], to: "recover.out.json") } }
        if take("state.request") != nil {
            writeJSON(["docURL": docURL?.path ?? "", "dirty": dirty, "edited": window.isDocumentEdited, "title": window.title, "editCounter": editCounter, "armed": armed, "docReady": docReady, "sig": lastSig ?? "", "baseline": baselineSig ?? "",
                       "saveActive": saveActive, "saveLog": saveLog, "memory": memory(), "coverVisible": !placeholder.isHidden, "openSeconds": docReady ? "ready" : "not ready"], to: "state.out.json")
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let controller = Controller()
app.delegate = controller
app.run()
