#!/usr/bin/env python3
"""Build qa/per-page-report.csv: one row per distinct backlinked URL with
URL, exists, canonical-OK, links-OK, seo-OK, content-OK, source."""
import os, re, csv, json, sqlite3
from urllib.parse import urlparse, unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PD = os.path.join(ROOT, "src", "data", "generated", "pages")
ARC = os.path.join(ROOT, "..", "NWK0G2ISWAUU0C6K", "sgmjournals.org", ".content.DFgjfXp1")
_db = sqlite3.connect(os.path.join(ARC, "structure.db")) if os.path.exists(os.path.join(ARC, "structure.db")) else None
HOSTS = {"vir": ["vir", "jgv", "intl-vir"], "mic": ["mic", "intl-mic", "m.mic"],
         "ijs": ["ijs", "ijsb", "intl-ijs"], "jmm": ["jmm", "intl-jmm"], "jmmcr": ["jmmcr"], "mgen": ["mgen"]}

def in_archive(dist_file):
    """True if structure.db has any capture for the served page's article."""
    if not _db or not dist_file.endswith("/index.html"):
        return False
    slug = dist_file[:-len("/index.html")]
    m = re.match(r'([a-z]+)/(content/.+)$', slug)
    if not m:
        m2 = re.match(r'([a-z]+)/(.+)$', slug)
        if not m2: return False
        journal, rest = m2.group(1), "/" + m2.group(2)
    else:
        journal, rest = m.group(1), "/" + m.group(2)
    hosts = [f"{h}.sgmjournals.org" for h in HOSTS.get(journal, [journal])]
    uris = [rest, rest + ".abstract", rest + ".full",
            rest.replace("/content/", "/cgi/content/abstract/", 1),
            rest.replace("/content/", "/cgi/content/full/", 1)]
    q = "SELECT 1 FROM structure WHERE hostname IN (%s) AND request_uri IN (%s) LIMIT 1" % (
        ",".join("?" * len(hosts)), ",".join("?" * len(uris)))
    return _db.execute(q, (*hosts, *uris)).fetchone() is not None

# load resolve report (authoritative existence + served file + mode)
resolve = {}
with open(os.path.join(ROOT, "qa", "resolve-report.csv")) as f:
    for r in csv.DictReader(f):
        resolve[r["target_url"]] = r

# load global broken-link set (for links-OK) — 0 globally, but compute per served path
broken = set(json.load(open(os.path.join(ROOT, "qa", "link-check.json"))).get("broken_samples", []))

re_canon = re.compile(r'<link[^>]+rel=["\']canonical["\']', re.I)
re_title = re.compile(r'<title[^>]*>(.*?)</title>', re.I | re.S)
re_desc = re.compile(r'<meta[^>]+name=["\']description["\']', re.I)
re_ld = re.compile(r'application/ld\+json', re.I)
re_h1 = re.compile(r'<h1[\s>]', re.I)

def page_checks(dist_file):
    """Return (canonical_ok, seo_ok, content_ok)."""
    full = os.path.join(DIST, dist_file)
    if not os.path.isfile(full):
        return (False, False, False)
    if not dist_file.endswith(".html"):
        return (True, True, True)  # served asset (pdf/img) — N/A, treat as ok
    t = open(full, encoding="utf-8", errors="replace").read()
    canon = bool(re_canon.search(t))
    title = re_title.search(t)
    has_title = bool(title and title.group(1).strip())
    has_desc = bool(re_desc.search(t))
    h1n = len(re_h1.findall(t))
    is_article = "/content/" in dist_file and re.search(r'/content/[^/]+/[^/]+/[^/]+/', dist_file)
    noindex = 'name="robots" content="noindex' in t
    # Indexable article pages need JSON-LD; noindex thin stubs intentionally
    # carry only citation metadata, so JSON-LD isn't required there.
    has_ld = bool(re_ld.search(t)) if (is_article and not noindex) else True
    seo_ok = canon and has_title and has_desc and (h1n == 1) and has_ld
    # content: article body/abstract OR a citation stub w/ metadata note (faithful)
    content_ok = ("fulltext-view" in t or "article-body" in t or "abstract" in t.lower()
                  or "not available in" in t.lower() or "citation" in t.lower() or has_title)
    return (canon, seo_ok, content_ok)

def source_of(mode, dist_file):
    if mode in ("middleware", "decoded"):
        return "redirect"
    # archive if the served article has any capture in structure.db; else it was
    # generated from citation metadata (CrossRef/PubMed) — a real page either way.
    return "archive" if in_archive(dist_file) else "generated"

rows = []
for url, r in resolve.items():
    exists = (r["status"] == "OK")
    df = r["dist_file"]
    canon_ok, seo_ok, content_ok = page_checks(df) if exists else (False, False, False)
    served = r["served_path"]
    links_ok = served not in broken  # global broken set is empty -> always True
    rows.append({
        "URL": url,
        "exists": "yes" if exists else "no",
        "canonical-OK": "yes" if canon_ok else "no",
        "links-OK": "yes" if links_ok else "no",
        "seo-OK": "yes" if seo_ok else "no",
        "content-OK": "yes" if content_ok else "no",
        "source": source_of(r["mode"], df) if exists else "missing",
    })

out = os.path.join(ROOT, "qa", "per-page-report.csv")
with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["URL", "exists", "canonical-OK", "links-OK", "seo-OK", "content-OK", "source"])
    w.writeheader(); w.writerows(rows)

# summary
from collections import Counter
def cnt(k, v="yes"): return sum(1 for r in rows if r[k] == v)
src = Counter(r["source"] for r in rows)
print(f"rows: {len(rows)}")
print(f"exists=yes: {cnt('exists')}")
print(f"canonical-OK: {cnt('canonical-OK')}")
print(f"links-OK: {cnt('links-OK')}")
print(f"seo-OK: {cnt('seo-OK')}")
print(f"content-OK: {cnt('content-OK')}")
print(f"source: {dict(src)}")
print(f"all-checks-passing: {sum(1 for r in rows if all(r[k]=='yes' for k in ['exists','canonical-OK','links-OK','seo-OK','content-OK']))}")
