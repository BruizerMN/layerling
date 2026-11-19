#!/usr/bin/env python3
"""Worker failure and stall recovery tests in the real WKWebView host (inflate workers only: faults apply to the first N blob workers).

  fault_tests.py --label step2-faults --app builds/step2/LayerlingHarness.app --doc work/foshay-source.lyl --timeout 240 \
                 --case throw:1:30 --case error:1:30 --case hang:1:30 --case hang:1:1

A case is MODE[:EVERY[:LIMIT]]: MODE throw (Worker creation throws) | error (an error event) | hang (never answers); EVERY = every Nth blob worker;
LIMIT = only among the first LIMIT blob workers (the unpack phase, before the repack starts its own). Every case does a Save As and the Foshay compare.
"""
import argparse, json, re, sys, time
import soak, run_measure as rm

ap = argparse.ArgumentParser()
ap.add_argument("--label", required=True); ap.add_argument("--app", required=True); ap.add_argument("--doc", required=True)
ap.add_argument("--timeout", type=int, default=240); ap.add_argument("--case", action="append", required=True)
a = ap.parse_args()
print("warm-up:", soak.warm_up(a.app, a.doc), flush=True)
rows = []
for i, spec in enumerate(a.case, 1):
    r = soak.OpenRun(a.app, a.doc, a.label + "-" + spec.replace(":", "_"), i, [])
    r.out["env"] = rm.Run.env(); r.out["fault"] = spec
    o = r.open_once(["--worker-fault", spec], a.timeout, True)
    log = (r.dir / "console.log").read_text(errors="ignore")
    o["fallback_warnings"] = len(re.findall(r"inflated in place", log))
    o["faults_injected"] = len(re.findall(r"fault.injected", log))
    (r.dir / "summary.json").write_text(json.dumps(o, indent=1))
    ws = (o.get("workers") or {}).get("stats") or {}
    rows.append((spec, o["status"], o.get("open_to_ready_s"), o["faults_injected"], o["fallback_warnings"], ws.get("blobCreated"), ws.get("blobMaxAlive"), ws.get("blobAlive"), o.get("fidelity_pass"), (o.get("diagnosis") or {}).get("class")))
    print(f"[{a.label} {spec}] status={o['status']} open={o.get('open_to_ready_s')}s faults={o['faults_injected']} fallbacks={o['fallback_warnings']} workers created/maxAlive/aliveAtEnd={ws.get('blobCreated')}/{ws.get('blobMaxAlive')}/{ws.get('blobAlive')} fidelity={o.get('fidelity_pass')} {(o.get('diagnosis') or {}).get('class') or ''}", flush=True)
print("FAULTDONE")
