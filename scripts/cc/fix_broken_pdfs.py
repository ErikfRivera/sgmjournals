#!/usr/bin/env python3
"""Some 'tier2-pdf' articles are backed only by a corrupt/0-page reprint PDF that
cannot be opened, extracted, or OCR'd. The PDF is not a usable source, so the
article's true best-available tier is its abstract (if present) or a citation
stub. Reclassify those: drop the broken PDF link, set the correct tier, and fix
the progress map so the report reflects reality."""
import json, os, glob
import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PAGES = os.path.join(ROOT, "src", "data", "generated", "pages")
PROGF = os.path.join(HERE, "cc-progress.json")
prog = json.load(open(PROGF))

fixed_t3 = fixed_t4 = still_ok = 0
for cf in glob.glob(HERE + "/pdfcache/*.json"):
    rec = json.load(open(cf))
    if not rec.get("scanned"):
        continue
    slug = rec["slug"]
    pf = os.path.join(PAGES, slug + ".json")
    if not os.path.exists(pf):
        continue
    d = json.load(open(pf))
    pdfPath = d.get("pdfPath")
    asset = os.path.join(ROOT, "public", pdfPath.lstrip("/")) if pdfPath else None
    # is the backing PDF usable?
    usable = False
    if asset and os.path.exists(asset):
        try:
            doc = fitz.open(asset)
            if doc.page_count > 0 and len("".join(p.get_text() for p in doc)) > 200:
                usable = True
            doc.close()
        except Exception:
            usable = False
    if usable:
        still_ok += 1
        continue
    # unusable PDF -> reclassify
    if asset and os.path.exists(asset):
        try: os.remove(asset)
        except Exception: pass
    d["pdfPath"] = None
    d.pop("needsSummary", None)
    d["summaryHtml"] = ""
    if len(d.get("abstractHtml") or "") > 40:
        d["ccTier"] = "tier3-abstract"
        prog["done"][slug] = "tier3-abstract"
        fixed_t3 += 1
    else:
        d["ccTier"] = "tier4-stub"
        prog["done"][slug] = "tier4-stub"
        fixed_t4 += 1
    json.dump(d, open(pf, "w"))
    rec["broken_pdf"] = True
    json.dump(rec, open(cf, "w"))

json.dump(prog, open(PROGF, "w"))
print(f"reclassified to tier3-abstract: {fixed_t3}")
print(f"reclassified to tier4-stub: {fixed_t4}")
print(f"scanned PDFs that were actually usable: {still_ok}")
