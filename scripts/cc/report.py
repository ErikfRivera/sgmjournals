#!/usr/bin/env python3
"""US-CC-005: write content-completeness-report.csv and the per-tier upgrade
summary, and verify every article renders at its best-available (content-verified)
tier.

best_available_tier = the richest tier the archive actually supports for the
article (content-verified by the resolver; cc-progress.json).
rendered_tier_before = the tier the page rendered before this remediation (cc-before.json).
rendered_tier_after  = the tier the built page renders now (classified from the JSON).
action               = rebuilt-full | summarized-pdf | abstract | stub
"""
import json, os, csv
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PAGES = os.path.join(ROOT, "src", "data", "generated", "pages")
AVAIL = json.load(open(os.path.join(HERE, "availability_map.json")))
PROG = json.load(open(os.path.join(HERE, "cc-progress.json")))["done"]
BEFORE = json.load(open(os.path.join(HERE, "cc-before.json")))
OUT = os.path.join(ROOT, "content-completeness-report.csv")

# normalize tier labels
def norm(t):
    return {"tier2-pdf-nosumm": "tier2-pdf(no summary)", "missing": "missing",
            "tier2-summary": "tier2-pdf"}.get(t, t)

def rendered_after(slug):
    fp = os.path.join(PAGES, slug + ".json")
    if not os.path.exists(fp):
        return "missing"
    d = json.load(open(fp))
    body = len(d.get("bodyHtml") or "")
    ab = len(d.get("abstractHtml") or "")
    summ = len(d.get("summaryHtml") or "")
    pdf = d.get("pdfPath")
    if body > 200:
        return "tier1-full"
    if summ > 40:
        return "tier2-pdf"          # summary present
    if pdf and ab > 40:
        return "tier2-pdf(abstract+pdf)"
    if pdf:
        return "tier2-pdf(pdf only)"
    if ab > 40:
        return "tier3-abstract"
    return "tier4-stub"

ACTION = {"tier1-full": "rebuilt-full", "tier2-pdf": "summarized-pdf",
          "tier3-abstract": "abstract", "tier4-stub": "stub"}

# rank for "at best tier" comparison
RANK = {"tier1-full": 3, "tier2-pdf": 2, "tier2-pdf(abstract+pdf)": 1.6,
        "tier2-pdf(pdf only)": 1.4, "tier2-pdf(no summary)": 1.4,
        "tier3-abstract": 1, "tier4-stub": 0, "missing": -1}

rows = []
before_ct, after_ct, best_ct = Counter(), Counter(), Counter()
at_best = 0
for slug in sorted(AVAIL):
    best = PROG.get(slug, "tier4-stub")  # resolver's achievable tier
    bt = norm(best)
    rb = norm(BEFORE.get(slug, "missing"))
    ra = rendered_after(slug)
    best_ct[bt] += 1
    before_ct[rb] += 1
    after_ct[ra] += 1
    # at best if rendered_after meets the achievable tier's rank.
    # Tier-2's defining deliverable is the auto-summary (PRD §4), so a PDF-only
    # article only counts as "at best" once its summary is rendered.
    target_rank = RANK.get(bt, 0)
    ok = RANK.get(ra, -1) >= target_rank
    if ok:
        at_best += 1
    rows.append({
        "article": slug,
        "best_available_tier": bt,
        "rendered_tier_before": rb,
        "rendered_tier_after": ra,
        "action": ACTION.get(best, "stub"),
        "at_best_tier": "yes" if ok else "no",
        "source_file": AVAIL[slug].get("html_file") or AVAIL[slug].get("pdf_file") or "",
    })

with open(OUT, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["article", "best_available_tier",
        "rendered_tier_before", "rendered_tier_after", "action", "at_best_tier", "source_file"])
    w.writeheader()
    w.writerows(rows)

N = len(rows)
print(f"Wrote {OUT} ({N} articles)\n")
print("Best-available tier (content-verified):")
for k, v in best_ct.most_common():
    print(f"  {k}: {v}")
print("\nRendered tier BEFORE remediation:")
for k, v in before_ct.most_common():
    print(f"  {k}: {v}")
print("\nRendered tier AFTER remediation:")
for k, v in after_ct.most_common():
    print(f"  {k}: {v}")

# upgrade counts
up1 = sum(1 for r in rows if r["rendered_tier_after"] == "tier1-full"
          and BEFORE.get(r["article"], "missing") != "tier1-full")
up2 = sum(1 for r in rows if r["rendered_tier_after"].startswith("tier2")
          and not norm(BEFORE.get(r["article"], "missing")).startswith("tier2"))
up3 = sum(1 for r in rows if r["rendered_tier_after"] == "tier3-abstract"
          and norm(BEFORE.get(r["article"], "missing")) not in ("tier3-abstract",))
print(f"\nUpgraded to Tier 1 (full): {up1}")
print(f"Upgraded to Tier 2 (pdf/summary): {up2}")
print(f"Upgraded to Tier 3 (abstract): {up3}")

print(f"\nPages at best-available tier: {at_best}/{N} ({100*at_best/N:.1f}%)")
