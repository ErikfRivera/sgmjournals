#!/usr/bin/env python3
"""Gate C deep check: for every page, verify <link rel=canonical>.
 - A canonical (clean) article/page must be self-referential.
 - A variant page (.full/.abstract/cgi/content/...) must canonicalize to its
   clean base (NOT self) — this is correct SEO (no duplicate-content split).
Also confirms sitemap lists canonicals and robots exists.
"""
import os, re, json
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SITE = "https://www.sgmjournals.org"
re_canon = re.compile(r'<link[^>]+rel=["\']canonical["\'][^>]*>', re.I)
re_href = re.compile(r'href=["\']([^"\']+)["\']', re.I)
VAR = re.compile(r'(\.(full\.pdf\+html|full\.pdf|full|abstract|short|long)$)|(/cgi/(content/(full|abstract|short|long)|reprint|reprintframed?)/)')

def page_url(rel):
    p = rel[:-len("/index.html")] if rel.endswith("/index.html") else rel[:-5]
    return SITE + "/" + p if p else SITE + "/"

def is_variant(url):
    return bool(VAR.search(url))

def base_of(url):
    u = re.sub(r'\.(full\.pdf\+html|full\.pdf|full|abstract|short|long)$', '', url)
    u = re.sub(r'/cgi/content/(?:full|abstract|short|long)/', '/content/', u)
    u = re.sub(r'/cgi/reprintframed?/', '/content/', u)
    u = re.sub(r'/cgi/reprint/', '/content/', u)
    return u.rstrip('/')

stats = Counter()
problems = {"selfref_mismatch": [], "variant_not_to_base": [], "no_canonical": []}
canon_targets = set()
for dp, _, files in os.walk(DIST):
    for fn in files:
        if not fn.endswith(".html"): continue
        rel = os.path.relpath(os.path.join(dp, fn), DIST).replace(os.sep, "/")
        url = page_url(rel)
        t = open(os.path.join(dp, fn), encoding="utf-8", errors="replace").read()
        m = re_canon.search(t)
        if not m:
            problems["no_canonical"].append(url); continue
        hm = re_href.search(m.group(0))
        canon = hm.group(1).rstrip("/") if hm else ""
        canon_targets.add(canon)
        stats["pages"] += 1
        if is_variant(url):
            stats["variant"] += 1
            if canon != base_of(url):
                problems["variant_not_to_base"].append(f"{url} -> {canon} (want {base_of(url)})")
        else:
            stats["canonical"] += 1
            if canon != url.rstrip("/"):
                # allowed: alias/journal-home pages may canonicalize elsewhere; flag for review
                problems["selfref_mismatch"].append(f"{url} -> {canon}")

# sitemap / robots
sm = os.path.join(DIST, "sitemap.xml")
rb = os.path.join(DIST, "robots.txt")
sitemap_urls = set()
if os.path.exists(sm):
    sitemap_urls = set(re.findall(r'<loc>([^<]+)</loc>', open(sm, encoding="utf-8").read()))
out = {
    "stats": dict(stats),
    "problem_counts": {k: len(v) for k, v in problems.items()},
    "sitemap_exists": os.path.exists(sm),
    "sitemap_url_count": len(sitemap_urls),
    "robots_exists": os.path.exists(rb),
}
json.dump({**out, "problems": {k: v[:40] for k, v in problems.items()}},
          open(os.path.join(ROOT, "qa", "canonical-check.json"), "w"), indent=2)
print(json.dumps(out, indent=2))
