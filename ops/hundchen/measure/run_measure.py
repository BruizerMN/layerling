#!/usr/bin/env python3
"""Foshay measurement run (macOS reference runner; drives the WKWebView harness app through its control files).

  run_measure.py --label before --app builds/before/LayerlingHarness.app --doc work/foshay-source.lyl [--runs 3] [--ls key=value ...]

Per run (fresh WebKit data store, fresh work dir, document opened from a private copy):
  open -> ready time, WebContent memory peak/settled, debug DOM elements, two identifiable edits with
  jank/notice/working-copy-write timings, Save As + node-by-node comparison against the Foshay baseline.
Results: runs/<label>/<stamp>-runN/summary.json (+ console.log, mem-timeline.csv, probe outputs).
"""
import argparse, csv, json, os, pathlib, re, shutil, statistics, subprocess, sys, time, uuid

H = pathlib.Path(__file__).resolve().parent
SCRATCH = pathlib.Path(os.environ.get("LAYERLING_SCRATCH", "/private/tmp/layerling-harness"))  # big throwaway files (Save As outputs), outside the backup/index scope

def sh(*a, **k): return subprocess.run(list(map(str, a)), **k)

def launch(app, app_args):
    """Start the host app's executable directly. Going through `open` (LaunchServices) on a freshly built, ad-hoc-signed bundle made macOS vet it first:
    the whole launch was delayed by 20 s or more (148 s under load), which looked like a stalled opening. A direct start has no such delay."""
    binary = pathlib.Path(app) / "Contents" / "MacOS" / "LayerlingHarness"
    return subprocess.Popen([str(binary), *map(str, app_args)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)

class Run:
    def __init__(self, app, doc, label, n, extra):
        self.app, self.doc, self.extra = pathlib.Path(app), pathlib.Path(doc), extra
        self.dir = H / "runs" / label / f"{time.strftime('%Y%m%d-%H%M%S')}-run{n}"
        self.work = self.dir / "work"
        for d in ("results", "control", "support"): (self.work / d).mkdir(parents=True, exist_ok=True)
        # The source document is opened directly (read-only, never written: Save As goes elsewhere). Cloning 58 MB into every run directory made
        # the backup agent and the antivirus scanner chew on new files each run, which loaded the Mac and slowed the openings being measured.
        self.copy = self.doc
        SCRATCH.mkdir(parents=True, exist_ok=True)
        self.saveas = SCRATCH / f"{label}-{self.dir.name}-saveas.lyl"
        self.out = {"label": label, "run": n, "env": self.env()}

    @staticmethod
    def env():
        """Machine state at the start of a run: runs under heavy swap are noisy and are flagged."""
        def cmd(*a): return subprocess.run(list(a), capture_output=True, text=True).stdout.strip()
        swap = cmd("sysctl", "-n", "vm.swapusage")
        m = re.search(r"used = ([\d.]+)M", swap)
        free = re.search(r"free percentage: (\d+)%", cmd("memory_pressure"))
        load = re.search(r"load averages?: ([\d.]+)", cmd("uptime"))
        try:
            vm = "; ".join(" ".join(l.split()) for l in cmd("prlctl", "list", "-a", "-o", "status,name").splitlines()[1:]) or "n/a"
        except Exception:
            vm = "n/a"
        return {"vm": vm, "swap_used_mb": float(m.group(1)) if m else None, "free_pct": int(free.group(1)) if free else None, "load1": float(load.group(1)) if load else None, "macos": cmd("sw_vers", "-productVersion")}

    def log(self):
        f = self.work / "results" / "console.log"
        return f.read_text(errors="ignore") if f.exists() else ""
    def t(self, pattern, last=False):
        m = re.findall(r"\[([\d.]+)\] " + pattern, self.log())
        return float(m[-1 if last else 0]) if m else None
    def wait(self, pred, timeout, what):
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = pred()
            if v: return v
            time.sleep(0.5)
        raise TimeoutError(what)
    def runjs(self, probe, timeout=240):
        out = self.work / "control" / "cmd.out.json"; out.unlink(missing_ok=True)
        shutil.copy(H / "probes" / probe, self.work / "control" / "cmd.js")
        self.wait(out.exists, timeout, probe); time.sleep(0.3)
        d = json.loads(out.read_text()); return d.get("result", d)
    def request(self, name, content="x"): (self.work / "control" / name).write_text(content)
    def mem(self):
        o = self.work / "control" / "mem.out.json"; o.unlink(missing_ok=True); self.request("mem.request")
        self.wait(o.exists, 20, "mem"); time.sleep(0.2); return json.loads(o.read_text())
    def timeline(self):
        rows = list(csv.DictReader(open(self.work / "results" / "mem-timeline.csv")))
        return [(float(r["t_s"]), float(r["webcontent_mb"])) for r in rows if r["webcontent_mb"]]
    def peak(self, a, b):
        v = [m for t, m in self.timeline() if a <= t <= b]; return round(max(v)) if v else None
    def at(self, t):
        tl = self.timeline(); return round(min(tl, key=lambda x: abs(x[0] - t))[1]) if tl else None

    def go(self):
        sid = str(uuid.uuid4())
        sh("pkill", "-x", "LayerlingHarness"); time.sleep(1.5)
        args = ["-ApplePersistenceIgnoreState", "YES", "--poc-root", self.work, "--open", self.copy, "--store-id", sid, "--cleanup-stores"]
        for kv in self.extra: args += ["--ls", kv]
        launch(self.app, args)
        try:
            self.wait(lambda: "document ready" in self.log(), 300, "document ready")
            o, r = self.t(r"open /"), self.t(r"document ready")
            self.out["open_to_ready_s"] = round(r - o, 1)
            time.sleep(10)
            self.out["open_peak_mb"] = self.peak(o, r + 10); self.out["at_ready_mb"] = self.at(r); self.out["settled_mb"] = self.at(r + 10)
            self.out["debug_elements"] = self.runjs("debug-elements.js")
            self.out["edits"] = []
            for i in (1, 2):
                e = self.runjs("edit-probe.js")
                j = self.runjs("await-journal.js", 200)
                tn = o + (e["tClickPerf"] - e["launchAtPerf"]) / 1000.0
                e["journal_write_after_click_ms"] = j["idbPutAfterClickMs"]
                e["wc_peak_mb_during_edit"] = self.peak(tn, tn + (j["idbPutAfterClickMs"] or 60000) / 1000.0 + 20)
                e["wc_settled_after_mb"] = round(self.mem().get("webcontent_mb", 0))
                self.out["edits"].append(e)
            self.out["lifetime_peak_mb"] = round(self.mem().get("webcontent_peak_mb", 0))
            # Save As to a new file, then verify fidelity against the Foshay baseline
            sa = self.saveas; res = self.work / "control" / "save.out.json"; res.unlink(missing_ok=True)
            self.request("saveas.request", str(sa)); self.wait(res.exists, 240, "save as")
            ss, sf = self.t(r"SAVE started", True), self.t(r"SAVE finished OK in")
            self.out["saveas_s"] = round(float(re.findall(r"SAVE finished OK in ([\d.]+)s", self.log())[-1]), 1) if sf else None
            self.out["saveas_peak_mb"] = self.peak(ss, sf) if ss and sf else None
        finally:
            shutil.copy(self.work / "results" / "mem-timeline.csv", self.dir / "mem-timeline.csv")
            (self.dir / "console.log").write_text(self.log())
            sh("pkill", "-x", "LayerlingHarness")
        r = sh(sys.executable, H / "compare_lyl.py", self.doc, sa, "--baseline", H / "baseline-foshay.json", "--expect-added", "2", "--json", capture_output=True, text=True)
        try: cmp = json.loads(r.stdout)
        except Exception: cmp = {"error": r.stdout[-300:] + r.stderr[-300:]}
        self.out["fidelity_pass"] = r.returncode == 0; self.out["fidelity"] = cmp
        (self.dir / "summary.json").write_text(json.dumps(self.out, indent=1))
        return self.out

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True); ap.add_argument("--app", required=True); ap.add_argument("--doc", required=True)
    ap.add_argument("--runs", type=int, default=3); ap.add_argument("--ls", action="append", default=[])
    a = ap.parse_args()
    for n in range(1, a.runs + 1):
        o = Run(a.app, a.doc, a.label, n, a.ls).go()
        print(f"[{a.label} run {n}] open {o['open_to_ready_s']}s peak {o['open_peak_mb']} MB ready {o['at_ready_mb']} settled {o['settled_mb']} "
              f"edit1 jank {o['edits'][0]['blockedMsOver100']}ms journal {o['edits'][0]['journal_write_after_click_ms']}ms save {o['saveas_s']}s fidelity {'PASS' if o['fidelity_pass'] else 'FAIL'} "
              f"debug-state chars {o['debug_elements']['state_chars']}", flush=True)
