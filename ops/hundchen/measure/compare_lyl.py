#!/usr/bin/env python3
"""Foshay acceptance check for .lyl files.

  compare_lyl.py A.lyl B.lyl [--baseline baseline-foshay.json] [--expect-added N] [--show] [--json]

Compares the current scene state of B against A node by node (ids normalised for the state-N prefix),
checks asset hashes and mesh blobs byte for byte, and (with --baseline) that A matches the Foshay baseline counts.
Exit code 0 = pass, 1 = a check failed. --expect-added N allows exactly N new nodes in B (intentional edits).
"""
import argparse, collections, hashlib, json, re, sys, zipfile

def load(path):
    z = zipfile.ZipFile(path)
    return z, json.loads(z.read("project.json"))

def scene(p):
    return next(x for x in p["states"] if x["id"] == p["sceneStateId"])

def canon(o):
    if isinstance(o, str): return re.sub(r"state-\d+", "S", o)
    if isinstance(o, dict): return {canon(k): canon(v) for k, v in o.items()}
    if isinstance(o, list): return [canon(v) for v in o]
    return o

def summary(p):
    c = scene(p)
    kinds = collections.Counter("group" if "groupedShapeNodeIds" in n else "leaf" for n in c["nodes"])
    return {"roots": len(c["rootNodeIds"]), "nodes": len(c["nodes"]), "groups": kinds["group"], "leaves": kinds["leaf"], "assets": len(p["assets"]),
            "features": len(p["features"]), "groupsList": len(p["groups"]), "states": len(p["states"]), "historyEntries": len(p["history"]["entries"]), "historyIndex": p["history"]["index"]}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("a"); ap.add_argument("b")
    ap.add_argument("--baseline"); ap.add_argument("--expect-added", type=int, default=0)
    ap.add_argument("--show", action="store_true"); ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    za, pa = load(a.a); zb, pb = load(a.b)
    sa, sb = summary(pa), summary(pb)
    na = {canon(n["nodeId"]): canon(n) for n in scene(pa)["nodes"]}
    nb = {canon(n["nodeId"]): canon(n) for n in scene(pb)["nodes"]}
    added, removed = set(nb) - set(na), set(na) - set(nb)
    changed = [k for k in na if k in nb and json.dumps(na[k], sort_keys=True) != json.dumps(nb[k], sort_keys=True)]
    ha = {x["sha256"] for x in pa["assets"]}; hb = {x["sha256"] for x in pb["assets"]}
    ma = {i.filename: hashlib.sha256(za.read(i)).hexdigest() for i in za.infolist() if i.filename.startswith("assets/")}
    mb = {i.filename: hashlib.sha256(zb.read(i)).hexdigest() for i in zb.infolist() if i.filename.startswith("assets/")}
    checks = {}
    if a.baseline:
        base = json.load(open(a.baseline))["scene"]
        checks["A matches Foshay baseline"] = all(sa[k] == v for k, v in base.items())
    checks["B zip integrity"] = zb.testzip() is None
    checks[f"nodes added == {a.expect_added}"] = len(added) == a.expect_added
    checks["no nodes removed"] = not removed
    checks["no nodes changed"] = not changed
    checks["asset hashes: nothing lost"] = ha <= hb
    checks["mesh blobs from A byte-identical in B"] = all(mb.get(k) == v for k, v in ma.items())
    checks["groups/features not reduced"] = sb["groups"] >= sa["groups"] and sb["features"] >= sa["features"]
    out = {"A": sa, "B": sb, "added": len(added), "removed": len(removed), "changed": len(changed), "checks": checks,
           "editor_view_same": pa["editor"].get("view") == pb["editor"].get("view"), "history_states": [sa["states"], sb["states"]]}
    if a.json: print(json.dumps(out, indent=1))
    else:
        print("A", sa); print("B", sb); print("added", len(added), "removed", len(removed), "changed", len(changed), "| camera view same:", out["editor_view_same"])
        for k, v in checks.items(): print(("PASS " if v else "FAIL ") + k)
        if a.show:
            for k in list(added)[:5]: print(" added:", k[-60:], nb[k]["definition"].get("kind"))
            for k in changed[:5]: print(" changed:", k[-60:])
    sys.exit(0 if all(checks.values()) else 1)

if __name__ == "__main__":
    main()
