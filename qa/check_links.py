#!/usr/bin/env python3
"""Gate A-2 / E: verify every internal <a href> and <img src>/asset resolves to
a real file in dist. Builds the set of all served paths once, then checks each
distinct internal link target against it."""
import os, re, sys, json
from urllib.parse import urlparse, unquote
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
HOSTS = ("www.sgmjournals.org", "sgmjournals.org")

# 1. Build set of valid served paths (normalized, no trailing slash, leading /)
served = set()
asset_files = set()
for dp, dirs, files in os.walk(DIST):
    for fn in files:
        full = os.path.join(dp, fn)
        rel = "/" + os.path.relpath(full, DIST).replace(os.sep, "/")
        if fn == "index.html":
            d = rel[:-len("/index.html")] or "/"
            served.add(d.rstrip("/") or "/")
        elif fn.endswith(".html"):
            served.add(rel[:-5])      # /foo.html -> /foo
            served.add(rel)           # also literal
        else:
            served.add(rel)           # literal asset (pdf, css, svg, png...)
        asset_files.add(rel)
served.add("/")

def is_served(path):
    p = unquote(path)
    if p != "/":
        p = p.rstrip("/")
    if p in served or p == "" and "/" in served:
        return True
    if p == "":
        return "/" in served
    # try literal file
    if p in asset_files:
        return True
    return False

# 2. Extract internal links from every page
re_attr = re.compile(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', re.I)
broken = defaultdict(list)   # target -> [pages]
n_pages = 0
n_links = 0
distinct = set()
page_targets = []
for dp, dirs, files in os.walk(DIST):
    for fn in files:
        if not fn.endswith(".html"):
            continue
        full = os.path.join(dp, fn)
        rel = "/" + os.path.relpath(full, DIST).replace(os.sep, "/")
        pageurl = rel[:-len("/index.html")] if fn == "index.html" else rel[:-5]
        pageurl = pageurl or "/"
        try:
            t = open(full, encoding="utf-8", errors="replace").read()
        except Exception:
            continue
        n_pages += 1
        for m in re_attr.finditer(t):
            raw = m.group(1).strip()
            if not raw:
                continue
            # skip non-internal schemes / anchors
            low = raw.lower()
            if low.startswith(("mailto:", "tel:", "javascript:", "data:", "#")):
                continue
            pr = urlparse(raw)
            if pr.scheme in ("http", "https"):
                if pr.netloc.lower() not in HOSTS:
                    continue   # external link, out of scope
                path = pr.path
            elif pr.scheme:
                continue
            else:
                path = pr.path  # relative or root-relative
                if not path.startswith("/"):
                    # resolve relative to page dir
                    base = pageurl if pageurl.endswith("/") else pageurl.rsplit("/", 1)[0] + "/"
                    path = os.path.normpath(os.path.join(base, path))
            if not path:
                continue
            n_links += 1
            key = path.split("#")[0].split("?")[0]
            if not key:
                continue
            distinct.add(key)

# 3. Check distinct targets once
broken_targets = sorted(k for k in distinct if not is_served(k))
out = {
    "pages_scanned": n_pages,
    "internal_links_seen": n_links,
    "distinct_internal_targets": len(distinct),
    "broken_distinct_targets": len(broken_targets),
}
with open(os.path.join(ROOT, "qa", "link-check.json"), "w") as f:
    json.dump({**out, "broken_samples": broken_targets[:200]}, f, indent=2)
print(json.dumps(out, indent=2))
if broken_targets:
    print("\nFirst broken targets:")
    for b in broken_targets[:40]:
        print("  ", b)
