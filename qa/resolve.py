#!/usr/bin/env python3
"""Authoritative offline Gate-B resolver.

Mirrors PRODUCTION routing exactly:
  1. Cloudflare: <host>.sgmjournals.org/<path> -> www.sgmjournals.org/<journal>/<path>
     (path + query preserved verbatim; NO cgi/.full transformation by Cloudflare)
  2. Vercel static: serves the file at that path. public/_redirects is NOT deployed
     (per .gitignore). middleware.js only rewrites NON-safe (percent-junk) paths.
  So a clean variant path (.full/.abstract/cgi/content/...) must be a REAL file in dist
  or it 404s. A junk path is normalized by middleware.canonical() then must be a real file.

Outputs qa/resolve-report.csv with one row per distinct backlink Target URL.
"""
import csv, re, os, sys
from urllib.parse import urlparse, unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # sgmjournals/
DIST = os.path.join(ROOT, "dist")
BACK = os.path.join(ROOT, "..", "sgmjournals.org-backlinks-subdomains_2026-06-07_19-43-12.csv")

# host (without .sgmjournals.org) -> journal path prefix ("" = root)
def journal_for(host):
    h = host.lower()
    if h.endswith(".sgmjournals.org"):
        sub = h[:-len(".sgmjournals.org")]
    elif h == "sgmjournals.org":
        sub = ""
    else:
        sub = h
    # strip leading m./www./old./intl-/submit-/intl-
    sub = re.sub(r'^(m|www|old)\.', '', sub)
    sub = re.sub(r'^(intl|submit)-', '', sub)
    sub = sub.lstrip('.')
    if sub in ("", "intl", "www"):
        return ""          # portal/root
    return {"jgv": "vir", "ijsb": "ijs"}.get(sub, sub)

SAFE = re.compile(r'^/[A-Za-z0-9._~+/-]*$')
VARIANT = re.compile(r'\.(full\.pdf\+html|full\.pdf|full|abstract|short|long|pdf)$', re.I)

def mw_canonical(p):
    """Replicate middleware.js canonical() for junk paths."""
    c = re.split(r'[^A-Za-z0-9._~+/-]', p)[0]
    c = re.sub(r'^(/[a-z]+)/cgi/content/(?:full|abstract|short|long)/', r'\1/content/', c)
    c = re.sub(r'^(/[a-z]+)/cgi/reprintframed?/', r'\1/content/', c)
    c = re.sub(r'^(/[a-z]+)/cgi/reprint/', r'\1/content/', c)
    c = re.sub(r'^(/[a-z]+)/cgi/doi/[^/]+/', r'\1/content/', c)
    c = VARIANT.sub('', c)
    c = re.sub(r'/+$', '', c)
    return c

def prod_path(target):
    """Return the on-www path Vercel must serve for a backlink target URL."""
    pr = urlparse(target)
    jp = journal_for(pr.netloc)
    path = pr.path
    if not path.startswith("/"):
        path = "/" + path
    if jp:
        full = "/" + jp + path
    else:
        full = path
    # collapse duplicate slashes
    full = re.sub(r'/{2,}', '/', full)
    return full

def dist_exists(path):
    """Does dist serve a 200 for this clean path? Returns matched file or None."""
    # strip query/fragment already gone. decode is NOT applied here (clean paths only).
    p = path
    if p != "/" :
        p = p.rstrip("/")
    rel = p.lstrip("/")
    base = os.path.join(DIST, rel)
    # 1. directory-format page
    if os.path.isfile(os.path.join(base, "index.html")):
        return base + "/index.html"
    # 2. file.html
    if os.path.isfile(base + ".html"):
        return base + ".html"
    # 3. literal file (pdf, etc.)
    if os.path.isfile(base):
        return base
    # 4. root
    if p == "" or p == "/":
        if os.path.isfile(os.path.join(DIST, "index.html")):
            return os.path.join(DIST, "index.html")
    return None

def resolve(target):
    """Return (status, served_path, dist_file, mode)."""
    full = prod_path(target)
    # is the raw path clean/safe?
    if SAFE.match(full):
        f = dist_exists(full)
        if f:
            return ("OK", full, f, "direct")
        return ("MISS", full, "", "direct")
    # junk path -> middleware normalizes
    decoded = unquote(full)
    clean = mw_canonical(decoded)
    f = dist_exists(clean)
    if f:
        return ("OK", clean, f, "middleware")
    # also try just decoding (no canonical) in case it's a real decoded file
    f2 = dist_exists(decoded.rstrip('/')) if SAFE.match(decoded) else None
    if f2:
        return ("OK", decoded, f2, "decoded")
    return ("MISS", clean or full, "", "middleware")

def main():
    csv.field_size_limit(10**7)
    seen = set()
    with open(BACK, encoding="utf-16") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            t = (row.get("Target URL") or "").strip()
            if t:
                seen.add(t)
    rows = []
    miss = 0
    for t in sorted(seen):
        status, served, df, mode = resolve(t)
        if status != "OK":
            miss += 1
        rows.append({"target_url": t, "status": status, "served_path": served,
                     "mode": mode, "dist_file": os.path.relpath(df, DIST) if df else ""})
    out = os.path.join(ROOT, "qa", "resolve-report.csv")
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["target_url","status","served_path","mode","dist_file"])
        w.writeheader(); w.writerows(rows)
    print(f"distinct targets: {len(rows)}")
    print(f"OK: {len(rows)-miss}    MISS: {miss}")
    print(f"-> {out}")

if __name__ == "__main__":
    main()
