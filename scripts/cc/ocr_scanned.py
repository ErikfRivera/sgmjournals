#!/usr/bin/env python3
"""OCR fallback for scanned Tier-2 PDFs (flagged scanned=true by extract_pdf_text).
Runs ocrmypdf (Tesseract) to add a text layer, re-extracts with PyMuPDF, and
updates the cache so the summarizer picks them up. Resumable."""
import json, os, glob, subprocess, tempfile
import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(HERE, "pdfcache")
PAGES = os.path.join(ROOT, "src", "data", "generated", "pages")

def clean(pages):
    import re
    from collections import Counter
    lc = Counter()
    for p in pages:
        for ln in set(l.strip() for l in p.splitlines() if l.strip()):
            lc[ln] += 1
    n = len(pages)
    rep = {ln for ln, c in lc.items() if c >= max(3, n * 0.5) and len(ln) < 120}
    out = []
    for p in pages:
        for ln in p.splitlines():
            s = ln.strip()
            if s in rep or re.fullmatch(r"\d{1,4}", s):
                continue
            out.append(ln)
    t = "\n".join(out)
    t = re.sub(r"(\w)-\n(\w)", r"\1\2", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()

scanned = []
for f in glob.glob(CACHE + "/*.json"):
    d = json.load(open(f))
    if d.get("scanned") and not d.get("ocr_done"):
        scanned.append((f, d))
print(f"scanned PDFs to OCR: {len(scanned)}")
ok = fail = 0
for f, d in scanned:
    slug = d["slug"]
    try:
        entry = json.load(open(os.path.join(PAGES, slug + ".json")))
        pdfPath = entry.get("pdfPath")
        src = os.path.join(ROOT, "public", pdfPath.lstrip("/"))
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            out = tmp.name
        r = subprocess.run(["ocrmypdf", "--force-ocr", "--quiet", src, out],
                           capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            print(f"  ocr fail {slug}: {r.stderr[:100]}")
            fail += 1
            os.unlink(out)
            continue
        doc = fitz.open(out)
        pages = [pg.get_text() for pg in doc]
        doc.close()
        os.unlink(out)
        txt = clean(pages)
        d["text"] = txt
        d["chars"] = sum(len(p) for p in pages)
        d["ocr_done"] = True
        if len(txt) > 400:
            d.pop("scanned", None)
        json.dump(d, open(f, "w"))
        ok += 1
        print(f"  OCR ok {slug}: {len(txt)} chars")
    except Exception as e:
        fail += 1
        print(f"  ERR {slug}: {e.__class__.__name__}: {str(e)[:100]}")
print(f"OCR done: ok={ok} fail={fail}")
