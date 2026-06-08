#!/usr/bin/env python3
"""Capture the rendered tier of every article AS IT WAS at git HEAD (the state
before the content-completeness rebuild), keyed by slug, into cc-before.json.
Used to populate rendered_tier_before in the final report. Run before committing
the rebuilt working tree."""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
AVAIL = json.load(open(os.path.join(HERE, "availability_map.json")))
OUT = os.path.join(HERE, "cc-before.json")
PREFIX = "src/data/generated/pages/"

def classify(d):
    if d is None:
        return "missing"
    body = len(d.get("bodyHtml") or "")
    ab = len(d.get("abstractHtml") or "")
    pdf = d.get("pdfPath")
    summ = d.get("summaryHtml") or d.get("summary")
    if body > 200:
        return "tier1-full"
    if summ:
        return "tier2-summary"
    if ab > 40:
        return "tier3-abstract"
    if pdf:
        return "tier2-pdf-nosumm"
    return "tier4-stub"

# Which blobs exist at HEAD?
tracked = set(subprocess.run(["git", "-C", ROOT, "ls-tree", "-r", "--name-only", "HEAD", PREFIX],
                             capture_output=True, text=True).stdout.splitlines())

slugs = list(AVAIL.keys())
paths = [PREFIX + s + ".json" for s in slugs]
# Bulk-read HEAD blobs via git cat-file --batch
want = [(s, p) for s, p in zip(slugs, paths) if p in tracked]
proc = subprocess.Popen(["git", "-C", ROOT, "cat-file", "--batch"],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE)
before = {}
batch_in = "".join(f"HEAD:{p}\n" for _, p in want).encode()
out, _ = proc.communicate(batch_in)
# parse: <sha> <type> <size>\n<content>\n
i = 0
for (slug, p) in want:
    nl = out.index(b"\n", i)
    header = out[i:nl].decode()
    i = nl + 1
    parts = header.split()
    if len(parts) >= 3 and parts[1] == "blob":
        size = int(parts[2])
        content = out[i:i + size]
        i += size + 1
        try:
            before[slug] = classify(json.loads(content))
        except Exception:
            before[slug] = "missing"
    else:
        before[slug] = "missing"

for s in slugs:
    before.setdefault(s, "missing")

json.dump(before, open(OUT, "w"))
from collections import Counter
print("before-state tiers:", dict(Counter(before.values())))
print("written", OUT)
