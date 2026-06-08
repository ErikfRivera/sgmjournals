#!/usr/bin/env python3
"""Tier-2 step 1: extract & clean text from each PDF-only article's PDF.

Reads the resolved tiers (cc-progress.json), locates each tier2-pdf article's PDF
(public/assets/...), extracts text with PyMuPDF, cleans running headers/footers and
de-hyphenates line breaks, and caches the result to scripts/cc/pdfcache/<safe>.json
(resumable). Flags scanned PDFs (too little text/page) for which OCR would be needed.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ASSETS = os.path.join(ROOT, "public", "assets")
PAGES = os.path.join(ROOT, "src", "data", "generated", "pages")
PROG = os.path.join(HERE, "cc-progress.json")
CACHE = os.path.join(HERE, "pdfcache")
os.makedirs(CACHE, exist_ok=True)

import fitz  # PyMuPDF

def safe(slug):
    return slug.replace("/", "__")

def clean_text(pages):
    # drop lines that repeat across many pages (running headers/footers)
    from collections import Counter
    line_counts = Counter()
    for p in pages:
        for ln in set(l.strip() for l in p.splitlines() if l.strip()):
            line_counts[ln] += 1
    n = len(pages)
    repeated = {ln for ln, c in line_counts.items() if c >= max(3, n * 0.5) and len(ln) < 120}
    out_lines = []
    for p in pages:
        for ln in p.splitlines():
            s = ln.strip()
            if s in repeated:
                continue
            if re.fullmatch(r"\d{1,4}", s):  # bare page numbers
                continue
            out_lines.append(ln)
    text = "\n".join(out_lines)
    # de-hyphenate words split across line breaks
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    # collapse intra-paragraph single newlines into spaces, keep blank-line breaks
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def main():
    prog = json.load(open(PROG))
    tier2 = sorted(s for s, t in prog["done"].items() if t == "tier2-pdf")
    print(f"tier2-pdf articles: {len(tier2)}")
    done = scanned = missing = ok = 0
    for slug in tier2:
        cf = os.path.join(CACHE, safe(slug) + ".json")
        if os.path.exists(cf):
            done += 1
            continue
        # find pdf path from the page entry
        try:
            entry = json.load(open(os.path.join(PAGES, slug + ".json")))
        except Exception:
            missing += 1
            continue
        pdfPath = entry.get("pdfPath")
        if not pdfPath:
            missing += 1
            continue
        pf = os.path.join(ROOT, "public", pdfPath.lstrip("/"))
        if not os.path.exists(pf):
            missing += 1
            continue
        try:
            doc = fitz.open(pf)
            pages = [pg.get_text() for pg in doc]
            npages = len(pages)
            doc.close()
        except Exception as e:
            missing += 1
            continue
        raw = "".join(pages)
        chars_per_page = (len(raw) / npages) if npages else 0
        rec = {"slug": slug, "pages": npages, "chars": len(raw),
               "chars_per_page": round(chars_per_page)}
        if chars_per_page < 200:  # scanned image PDF — needs OCR (unavailable here)
            rec["scanned"] = True
            rec["text"] = clean_text(pages)
            scanned += 1
        else:
            rec["text"] = clean_text(pages)
            ok += 1
        json.dump(rec, open(cf, "w"))
    print(f"extracted ok={ok} scanned(low-text)={scanned} already={done} missing/err={missing}")

if __name__ == "__main__":
    main()
