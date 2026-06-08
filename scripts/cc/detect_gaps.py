#!/usr/bin/env python3
"""US-CC-002: detect the currently-rendered tier of every archive article and
compute the gap matrix (rendered_tier < best_available_tier).

Reads scripts/cc/availability_map.json (best tier per article) and the built page
JSON under src/data/generated/pages/<slug>.json. Emits scripts/cc/gaps.json
(list of slugs to rebuild, with current+target tier) and prints the matrix.
"""
import os, json
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PAGES = os.path.join(ROOT, "src", "data", "generated", "pages")
AVAIL = os.path.join(HERE, "availability_map.json")
GAPS = os.path.join(HERE, "gaps.json")

TIER_RANK = {"none": 0, "tier4-stub": 0, "tier3-abstract": 1, "tier2-pdf": 2,
             "tier2-summary": 2, "tier1-full": 3}

def rendered_tier(d):
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
        # has a pdf link but no summary/abstract/body -> effectively a pdf stub (below tier2)
        return "tier2-pdf-nosumm"
    # has a meta/title only
    if d.get("meta") and (d["meta"].get("title")):
        return "tier4-stub"
    return "tier4-stub"

def rank(t):
    if t == "tier2-pdf-nosumm":
        return 1.5  # better than abstract-less stub but below a real summary
    if t == "missing":
        return -1
    return TIER_RANK.get(t, 0)

def main():
    avail = json.load(open(AVAIL))
    gaps = []
    matrix = {}  # (best, rendered) -> count
    for slug, rec in avail.items():
        best = rec["best_tier"]
        fp = os.path.join(PAGES, slug + ".json")
        d = None
        if os.path.exists(fp):
            try:
                d = json.load(open(fp))
            except Exception:
                d = None
        rt = rendered_tier(d)
        matrix[(best, rt)] = matrix.get((best, rt), 0) + 1
        if rank(rt) < rank(best):
            gaps.append({"slug": slug, "best_tier": best, "rendered_tier": rt,
                         "html_file": rec.get("html_file"), "html_kind": rec.get("html_kind"),
                         "pdf_file": rec.get("pdf_file"),
                         "journal": rec["journal"], "vol": rec["vol"],
                         "issue": rec["issue"], "page": rec["page"]})
    json.dump(gaps, open(GAPS, "w"))
    # summary
    from collections import Counter
    best_counts = Counter(r["best_tier"] for r in avail.values())
    print("Best-available tier distribution:")
    for k in ("tier1-full", "tier2-pdf", "tier3-abstract", "none"):
        print(f"  {k}: {best_counts.get(k,0)}")
    print(f"\nTotal articles: {len(avail)}   Gaps (below best): {len(gaps)}")
    print("\nGap matrix (best_tier -> rendered_tier : count):")
    for (best, rt), n in sorted(matrix.items(), key=lambda x: -x[1]):
        flag = "  <-- GAP" if rank(rt) < rank(best) else ""
        print(f"  {best:16} -> {rt:20} : {n}{flag}")
    # gaps by target tier
    gt = Counter(g["best_tier"] for g in gaps)
    print("\nGaps by target tier:")
    for k, v in gt.items():
        print(f"  {k}: {v}")

if __name__ == "__main__":
    main()
