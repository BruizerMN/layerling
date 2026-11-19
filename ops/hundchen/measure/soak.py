#!/usr/bin/env python3
"""Consecutive full-document opens, every outcome counted.

  soak.py --label step2 --app builds/step2/LayerlingHarness.app --doc work/foshay-source.lyl --runs 50 [--verify-every 10] [-- <extra host app args>]

Each run: fresh WebKit data store, fresh process, open the document, wait for the editor to be ready (timeout), record time, memory
and worker bookkeeping; every Nth run (and the first and last) also does a Save As and the Foshay acceptance compare.
A run that does not become ready is NOT retried and NOT dropped: diagnostics are captured (host log, page health probe, a sample of the
WebContent process, a snapshot) and it is classified as a product stall or a harness/environment failure.
Output: runs/<label>/soak.jsonl (one line per run) and a summary on stdout.
"""
import argparse, json, os, pathlib, shutil, statistics, subprocess, sys, time, uuid
import run_measure as rm

H = rm.H

def vm_state():
    try:
        out = subprocess.run(["prlctl", "list", "-a", "-o", "status,name"], capture_output=True, text=True, timeout=10).stdout.strip().splitlines()
        return "; ".join(" ".join(l.split()) for l in out[1:])
    except Exception:
        return "n/a"

class OpenRun(rm.Run):
    def open_once(self, extra, ready_timeout, verify):
        sid = str(uuid.uuid4())
        rm.sh("pkill", "-x", "LayerlingHarness"); time.sleep(1.5)
        rm.launch(self.app, ["-ApplePersistenceIgnoreState", "YES", "--poc-root", self.work, "--open", self.copy, "--store-id", sid, "--cleanup-stores", *extra])
        self.out["vm"] = vm_state()
        status = "ok"; diag = None
        try:
            self.wait(lambda: "document ready" in self.log(), ready_timeout, "document ready")
            o, r = self.t(r"open /"), self.t(r"document ready")
            self.out["open_to_ready_s"] = round(r - o, 1)
            time.sleep(4)
            self.out["peak_mb"] = self.peak(o, r + 4); self.out["at_ready_mb"] = self.at(r); self.out["settled_mb"] = self.at(r + 4)
            self.out["workers"] = self.runjs("worker-stats.js", 30)
            ph = (self.out["workers"] or {}).get("phase") or []
            self.out["page_visible_at_start"] = bool(ph) and "vis=visible" in ph[0][1]
            if verify:
                sa = self.saveas; res = self.work / "control" / "save.out.json"; res.unlink(missing_ok=True)
                self.request("saveas.request", str(sa)); self.wait(res.exists, 240, "save as")
                self.out["verified"] = True
        except TimeoutError as e:
            status = "stall"; diag = self.diagnose(ready_timeout)
        finally:
            shutil.copy(self.work / "results" / "mem-timeline.csv", self.dir / "mem-timeline.csv") if (self.work / "results" / "mem-timeline.csv").exists() else None
            (self.dir / "console.log").write_text(self.log())
            rm.sh("pkill", "-x", "LayerlingHarness")
        if verify and status == "ok":
            r = rm.sh(sys.executable, H / "compare_lyl.py", self.doc, self.saveas, "--baseline", H / "baseline-foshay.json", "--expect-added", "0", "--json", capture_output=True, text=True)
            if os.environ.get("KEEP_SAVEAS") != "1":
              try: self.saveas.unlink()  # the big verification file is not kept; its verdict is
              except OSError: pass
            self.out["fidelity_pass"] = r.returncode == 0
            if r.returncode != 0: status = "fidelity-fail"
        if status == "ok" and self.out.get("page_visible_at_start") is False: status = "invalid-environment"
        if status == "stall" and (diag or {}).get("class", "").startswith("environment"): status = "invalid-environment"
        self.out["status"] = status
        if diag: self.out["diagnosis"] = diag
        (self.dir / "summary.json").write_text(json.dumps(self.out, indent=1))
        return self.out

    def diagnose(self, timeout):
        log = self.log(); d = {"timeout_s": timeout}
        d["page_loaded"] = "page loaded" in log; d["open_issued"] = "open /" in log; d["file_served"] = "served " in log
        d["webcontent_terminated"] = "WebContent process terminated" in log
        d["faults_injected"] = log.count("fault.injected"); d["worker_errors"] = log.count("worker.error")
        try: d["page"] = self.runjs("health.js", 20); d["page_responsive"] = True
        except Exception as e: d["page_responsive"] = False; d["page_error"] = str(e)[:80]
        try:
            m = self.mem(); d["memory"] = m
            if m.get("webcontent_pid"):
                s = subprocess.run(["sample", str(m["webcontent_pid"]), "3"], capture_output=True, text=True, timeout=30).stdout
                (self.dir / "webcontent-sample.txt").write_text(s)
                d["sample_saved"] = True
        except Exception as e: d["memory_error"] = str(e)[:80]
        ph = (d.get("page") or {}).get("phase") or []
        d["page_visible_at_start"] = bool(ph) and "vis=visible" in ph[0][1]
        if ph and not d["page_visible_at_start"]: d["class"] = "environment: the host page was HIDDEN (window not on the active Space / covered?): not a valid run"
        elif not d["page_loaded"]: d["class"] = "harness: app did not reach page load"
        elif not d["open_issued"]: d["class"] = "harness: open request never issued"
        elif d["webcontent_terminated"]: d["class"] = "product/environment: WebContent process terminated (memory?)"
        elif not d["page_responsive"]: d["class"] = "product: page unresponsive"
        else: d["class"] = "product: opening stalled with a responsive page"
        return d

def warm_up(app, doc):
    """First launch of a freshly built app: macOS checks the new binary's first access to ~/Documents, which delayed the open request by seconds
    (and, before this was understood, looked like a stalled opening). Launch it once, uncounted but reported, so measured runs start from a settled app."""
    app = pathlib.Path(app); marker = app / "Contents" / ".warmed"
    if marker.exists(): return {"warm_up": "already done"}
    r = OpenRun(app, doc, "warmup", 0, [])
    sid = str(uuid.uuid4()); rm.sh("pkill", "-x", "LayerlingHarness"); time.sleep(1.5)
    t0 = time.time()
    rm.launch(app, ["-ApplePersistenceIgnoreState", "YES", "--poc-root", r.work, "--open", r.copy, "--store-id", sid])
    try: r.wait(lambda: "open /" in r.log(), 120, "open issued"); issued = r.t(r"open /")
    except TimeoutError: issued = None
    time.sleep(8); rm.sh("pkill", "-x", "LayerlingHarness"); marker.write_text("warmed\n")
    return {"warm_up": "done", "open_issued_at_s": issued, "took_s": round(time.time() - t0)}

def settle(max_s=300):
    t0 = time.time(); e = rm.Run.env()
    while time.time() - t0 < max_s and (e["load1"] or 0) > 2.0:
        time.sleep(10); e = rm.Run.env()
    return {"waited_s": round(time.time() - t0), **e}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True); ap.add_argument("--app", required=True); ap.add_argument("--doc", required=True)
    ap.add_argument("--runs", type=int, default=50); ap.add_argument("--settle-max", type=int, default=300); ap.add_argument("--no-verify", action="store_true"); ap.add_argument("--timeout", type=int, default=120); ap.add_argument("--verify-every", type=int, default=10)
    ap.add_argument("extra", nargs="*")
    a = ap.parse_args()
    outdir = H / "runs" / a.label; outdir.mkdir(parents=True, exist_ok=True)
    jl = outdir / "soak.jsonl"
    print("warm-up:", warm_up(a.app, a.doc), flush=True)
    start_env = settle(a.settle_max); print("settled:", start_env, flush=True)
    import ab  # shared stop handling (signals, STOP files) and atomic checkpoint writes
    ckp = outdir / "checkpoint.json"
    state = json.loads(ckp.read_text()) if ckp.exists() else {"label": a.label, "runs_planned": a.runs, "attempts": 0, "ok": 0, "failures": [], "interrupted": [], "sessions": []}
    state["runs_planned"] = a.runs
    for d in sorted(outdir.glob("*")):
        if d.is_dir() and not (d / "summary.json").exists() and d.name not in [x["dir"] for x in state["interrupted"]]:
            state["interrupted"].append({"dir": d.name, "note": "run directory without a summary: stopped mid-run; not counted"})
    session = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "env": rm.Run.env(), "resumed_from_attempt": state["attempts"]}
    state["sessions"].append(session); ab.save_atomic(ckp, state)
    results = []
    for n in range(state["attempts"] + 1, a.runs + 1):
        if ab.should_stop(a.label): print("STOP requested: checkpoint kept, resume later with the same command", flush=True); break
        verify = (not a.no_verify) and (n == 1 or n == a.runs or (a.verify_every and n % a.verify_every == 0))
        r = OpenRun(a.app, a.doc, a.label, n, [])
        r.out["env"] = rm.Run.env()
        o = r.open_once(a.extra, a.timeout, verify)
        results.append(o)
        if o["status"] == "invalid-environment":
            print("INVALID ENVIRONMENT: the page was hidden; stopping so this is fixed rather than counted. Check the window[...] log line (activeSpace/occlusionVisible).", flush=True)
            (outdir / "STOP").write_text("invalid environment\n")
        state["attempts"] += 1
        if o["status"] == "ok": state["ok"] += 1
        else: state["failures"].append({"attempt": n, "status": o["status"], "dir": r.dir.name, "class": (o.get("diagnosis") or {}).get("class")})
        ab.save_atomic(ckp, state)
        with open(jl, "a") as f: f.write(json.dumps({k: o.get(k) for k in ("label", "run", "status", "open_to_ready_s", "peak_mb", "at_ready_mb", "settled_mb", "workers", "env", "vm", "fidelity_pass", "verified")} | ({"diagnosis": o["diagnosis"]} if "diagnosis" in o else {})) + "\n")
        print(f"[{a.label} {n}/{a.runs}] {o['status']} open {o.get('open_to_ready_s')}s peak {o.get('peak_mb')} MB settled {o.get('settled_mb')} MB blob-workers-max {(o.get('workers') or {}).get('stats', {}).get('blobMaxAlive') if o.get('workers') else None}" + (f" [{o['diagnosis']['class']}]" if 'diagnosis' in o else ""), flush=True)
    session["ended"] = time.strftime("%Y-%m-%d %H:%M:%S"); ab.save_atomic(ckp, state)
    ok = [r for r in results if r["status"] == "ok"]
    def st(k): v = [r[k] for r in ok if r.get(k) is not None]; return f"median {statistics.median(v):.1f} min {min(v)} max {max(v)}" if v else "n/a"
    print(f"SOAK {a.label}: {len(ok)}/{len(results)} ok; statuses { {s: sum(r['status']==s for r in results) for s in set(r['status'] for r in results)} }")
    print("open s:", st("open_to_ready_s"), "| peak MB:", st("peak_mb"), "| settled MB:", st("settled_mb"))
    print("SOAKDONE")
