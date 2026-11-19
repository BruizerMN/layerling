#!/usr/bin/env python3
"""Save As -> reopen -> Save As again, compared with the original at each step (the document must survive a full round trip through Open and Save As)."""
import json, os, subprocess, sys
os.environ["KEEP_SAVEAS"] = "1"
import soak, run_measure as rm
app, doc = sys.argv[1], sys.argv[2]
r1 = soak.OpenRun(app, doc, "reopen-gen1", 1, []); r1.out["env"] = rm.Run.env()
o1 = r1.open_once([], 150, True); print("gen1:", o1["status"], "open", o1.get("open_to_ready_s"), "s, fidelity", o1.get("fidelity_pass"), flush=True)
gen1 = r1.saveas
r2 = soak.OpenRun(app, str(gen1), "reopen-gen2", 1, []); r2.out["env"] = rm.Run.env()
o2 = r2.open_once([], 150, True); print("gen2 (opened the Save As file):", o2["status"], "open", o2.get("open_to_ready_s"), "s, fidelity vs gen1", o2.get("fidelity_pass"), flush=True)
gen2 = r2.saveas
for a, b, label in ((doc, str(gen2), "original -> gen2"), (str(gen1), str(gen2), "gen1 -> gen2")):
    p = subprocess.run([sys.executable, str(rm.H / "compare_lyl.py"), a, b, "--expect-added", "0"], capture_output=True, text=True)
    print(f"compare {label}:", "PASS" if p.returncode == 0 else "FAIL", "|", " ".join(l for l in p.stdout.splitlines() if l.startswith(("added", "PASS", "FAIL")))[:240], flush=True)
print("REOPENDONE")
