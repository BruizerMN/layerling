#!/usr/bin/env python3
"""Resumable, interleaved A/B open benchmark. Safe to interrupt at any time.

  ab.py --tag ab1 --pairs 10 --a baseline:builds/baseline/LayerlingHarness.app --b step2:builds/step2/LayerlingHarness.app --doc work/foshay-source.lyl

Each attempt is one full run (fresh process and data store, open the document, record time/memory/workers, every Nth run Save As + fidelity compare).
After EVERY attempt the result line is appended to runs/<tag>/results.jsonl and runs/<tag>/checkpoint.json is rewritten atomically.
Only status "ok" runs count as successes; stalls, fidelity failures and runs killed mid-way are recorded as such and never counted as successful.
Stop cleanly:  touch runs/STOP   (or runs/<tag>/STOP, or send SIGTERM/SIGINT): the current run finishes, the checkpoint is saved, the harness exits.
Resume: run the same command again; attempts continue where they stopped.
"""
import argparse, json, os, pathlib, signal, subprocess, sys, time
import soak, run_measure as rm

H = rm.H
STOP = {"flag": False}
def on_signal(sig, _frame): STOP["flag"] = True; print(f"signal {sig}: finishing the current run, then stopping", flush=True)
signal.signal(signal.SIGTERM, on_signal); signal.signal(signal.SIGINT, on_signal)

def should_stop(tag):
    return STOP["flag"] or (H / "runs" / "STOP").exists() or (H / "runs" / tag / "STOP").exists()

def save_atomic(path, obj):
    tmp = path.with_suffix(".tmp"); tmp.write_text(json.dumps(obj, indent=1)); os.replace(tmp, path)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True); ap.add_argument("--pairs", type=int, default=10)
    ap.add_argument("--a", help="label:app"); ap.add_argument("--b", help="label:app"); ap.add_argument("--variant", action="append", default=[], help="label:app (repeat for 2 or more variants; interleaved in this order)")
    ap.add_argument("--doc", required=True); ap.add_argument("--timeout", type=int, default=120); ap.add_argument("--verify-every", type=int, default=5)
    ap.add_argument("--settle-max", type=int, default=0)
    a = ap.parse_args()
    variants = [tuple(v.split(":", 1)) for v in (a.variant or [a.a, a.b])]
    out = H / "runs" / a.tag; out.mkdir(parents=True, exist_ok=True)
    ckp, jl = out / "checkpoint.json", out / "results.jsonl"
    state = json.loads(ckp.read_text()) if ckp.exists() else {"tag": a.tag, "pairs_planned": a.pairs, "attempts": {v[0]: 0 for v in variants}, "ok": {v[0]: 0 for v in variants},
                                                              "failures": [], "interrupted": [], "sessions": []}
    state["pairs_planned"] = a.pairs
    # runs that were killed mid-way (a run directory without summary.json) are recorded as interrupted, never counted
    for label, _ in variants:
        for d in sorted((H / "runs" / f"{a.tag}-{label}").glob("*")):
            if d.is_dir() and not (d / "summary.json").exists() and str(d.name) not in [x["dir"] for x in state["interrupted"]]:
                state["interrupted"].append({"label": label, "dir": d.name, "note": "run directory without a summary: the harness was stopped or the Mac was closed mid-run; not counted"})
    session = {"started": time.strftime("%Y-%m-%d %H:%M:%S"), "env": rm.Run.env(), "runs_this_session": 0}
    state["sessions"].append(session); save_atomic(ckp, state)
    subprocess.run(["pkill", "-x", "LayerlingHarness"]); time.sleep(1)
    for label, app in variants: print("warm-up", label, soak.warm_up(app, a.doc), flush=True)
    soak.settle(a.settle_max) if a.settle_max else None
    while not should_stop(a.tag):
        due = [v for v in variants if state["attempts"][v[0]] < a.pairs]
        if not due: break
        label, app = min(due, key=lambda v: (state["attempts"][v[0]], variants.index(v)))
        n = state["attempts"][label] + 1
        verify = (n == 1) or (a.verify_every and n % a.verify_every == 0) or n == a.pairs
        r = soak.OpenRun(app, a.doc, f"{a.tag}-{label}", n, [])
        r.out["env"] = rm.Run.env()
        # the attempt counts as soon as it starts: a run killed mid-way is an interrupted attempt, not a success
        o = r.open_once([], a.timeout, verify)
        rec = {k: o.get(k) for k in ("label", "run", "status", "open_to_ready_s", "peak_mb", "at_ready_mb", "settled_mb", "workers", "env", "vm", "fidelity_pass", "verified")}
        rec["variant"] = label; rec["attempt"] = n; rec["dir"] = r.dir.name
        if "diagnosis" in o: rec["diagnosis"] = o["diagnosis"]
        with open(jl, "a") as f: f.write(json.dumps(rec) + "\n")
        state["attempts"][label] += 1
        if o["status"] == "ok": state["ok"][label] += 1
        else: state["failures"].append({"variant": label, "attempt": n, "status": o["status"], "dir": r.dir.name, "class": (o.get("diagnosis") or {}).get("class")})
        session["runs_this_session"] += 1; session["last_run_finished"] = time.strftime("%H:%M:%S")
        save_atomic(ckp, state)
        w = (o.get("workers") or {}).get("stats") or {}
        print(f"[{a.tag} {label} #{n}] {o['status']} open {o.get('open_to_ready_s')}s peak {o.get('peak_mb')} MB settled {o.get('settled_mb')} MB workers-max {w.get('blobMaxAlive')} swap {o['env']['swap_used_mb']:.0f} MB" + (f" fidelity {'PASS' if o.get('fidelity_pass') else 'FAIL'}" if o.get("verified") else ""), flush=True)
    session["ended"] = time.strftime("%Y-%m-%d %H:%M:%S"); session["stopped_by"] = "request" if should_stop(a.tag) else "plan complete"
    save_atomic(ckp, state)
    print("CHECKPOINT SAVED:", json.dumps({"attempts": state["attempts"], "ok": state["ok"], "failures": len(state["failures"]), "interrupted": len(state["interrupted"]), "stopped_by": session["stopped_by"]}), flush=True)
    print("ABDONE", flush=True)
