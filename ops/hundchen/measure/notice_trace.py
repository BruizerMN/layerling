#!/usr/bin/env python3
"""Trace the page's opening progress (notice text, worker counts, document.visibilityState) once per ~2 s while Foshay opens.
  notice_trace.py builds/step2mc/LayerlingHarness.app label [--hide]"""
import json, pathlib, shutil, subprocess, sys, time, uuid
import run_measure as rm
app, label = sys.argv[1], sys.argv[2]; extra = sys.argv[3:]
H = rm.H; W = H / "runs" / "trace" / f"{label}-{time.strftime('%H%M%S')}"
for d in ("results", "control", "support"): (W / d).mkdir(parents=True, exist_ok=True)
subprocess.run(["pkill", "-x", "LayerlingHarness"]); time.sleep(1.5)
rm.launch(app, ["-ApplePersistenceIgnoreState", "YES", "--poc-root", W, "--open", H / "work" / "foshay-source.lyl", "--store-id", str(uuid.uuid4()), *extra])
t0 = time.time(); trace = []; last = None
while time.time() - t0 < 140:
    out = W / "control" / "cmd.out.json"; out.unlink(missing_ok=True)
    shutil.copy(H / "probes" / "notice.js", W / "control" / "cmd.js")
    for _ in range(40):
        if out.exists(): break
        time.sleep(0.25)
    try: r = json.loads(out.read_text()).get("result")
    except Exception: r = None
    el = round(time.time() - t0, 1)
    if r:
        key = (r.get("notice"), r.get("canvas"), r.get("vis"), r.get("blobCreated"))
        if key != last: trace.append({"t": el, **r}); last = key; print(f"t={el:6.1f}s page={r['now']/1000:6.1f}s vis={r['vis']} notice={r['notice']!r} editor={r['canvas']} blob workers created={r['blobCreated']} alive={r['blobAlive']}", flush=True)
        if r.get("canvas"): break
    time.sleep(1.0)
log = (W / "results" / "console.log").read_text(errors="ignore") if (W / "results" / "console.log").exists() else ""
print("host log:", [l for l in log.splitlines() if "open /" in l or "page loaded" in l or "hidden" in l][:4])
subprocess.run(["pkill", "-x", "LayerlingHarness"])
(W / "trace.json").write_text(json.dumps(trace, indent=1))
