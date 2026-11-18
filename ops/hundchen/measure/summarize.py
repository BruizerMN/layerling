#!/usr/bin/env python3
"""Aggregate harness runs:  summarize.py runs/before runs/after [...]  -> markdown table (median [min-max])."""
import json, pathlib, statistics, sys

def col(rows, f):
    v = [x for x in (f(r) for r in rows) if x is not None]
    if not v: return "n/a"
    return f"{statistics.median(v):.1f} [{min(v):.1f}-{max(v):.1f}]" if any(isinstance(x, float) for x in v) else f"{int(statistics.median(v))} [{min(v)}-{max(v)}]"

METRICS = [
    ("open -> ready (s)", lambda r: r["open_to_ready_s"]),
    ("open: WebContent peak (MB)", lambda r: r["open_peak_mb"]),
    ("at ready (MB)", lambda r: r["at_ready_mb"]),
    ("settled +10 s (MB)", lambda r: r["settled_mb"]),
    ("debug state element (chars)", lambda r: r["debug_elements"]["state_chars"] or 0),
    ("edit 1: notice latency (ms)", lambda r: r["edits"][0]["noticeMs"]),
    ("edit 1: blocked frames > 100 ms (ms total, 15 s)", lambda r: r["edits"][0]["blockedMsOver100"]),
    ("edit 1: longest frame gap (ms)", lambda r: r["edits"][0]["maxFrameGapMs"]),
    ("edit 1: project-list write after click (ms)", lambda r: r["edits"][0]["firstProjectWriteMs"]),
    ("edit 1: IndexedDB repack write after click (ms)", lambda r: r["edits"][0]["journal_write_after_click_ms"]),
    ("edit 1: WebContent peak while repacking (MB)", lambda r: r["edits"][0]["wc_peak_mb_during_edit"]),
    ("edit 2: blocked frames > 100 ms (ms total, 15 s)", lambda r: r["edits"][1]["blockedMsOver100"]),
    ("edit 2: IndexedDB repack write after click (ms)", lambda r: r["edits"][1]["journal_write_after_click_ms"]),
    ("after edits: settled (MB)", lambda r: r["edits"][1]["wc_settled_after_mb"]),
    ("Save As (s)", lambda r: r["saveas_s"]),
    ("Save As: WebContent peak (MB)", lambda r: r["saveas_peak_mb"]),
    ("lifetime peak (MB)", lambda r: r["lifetime_peak_mb"]),
]
sets = {}
for d in sys.argv[1:]:
    p = pathlib.Path(d); sets[p.name] = [json.loads(f.read_text()) for f in sorted(p.glob("*/summary.json"))]
names = list(sets)
print("| metric | " + " | ".join(f"{n} (n={len(sets[n])})" for n in names) + " |"); print("|---|" + "---|" * len(names))
for label, f in METRICS: print(f"| {label} | " + " | ".join(col(sets[n], f) for n in names) + " |")
print("| swap used at start (MB) | " + " | ".join(col(sets[n], lambda r: (r.get("env") or {}).get("swap_used_mb")) for n in names) + " |")
print("| load average at start | " + " | ".join(col(sets[n], lambda r: (r.get("env") or {}).get("load1")) for n in names) + " |")
print("| fidelity vs Foshay baseline | " + " | ".join(f"{sum(r['fidelity_pass'] for r in sets[n])}/{len(sets[n])} pass" for n in names) + " |")
