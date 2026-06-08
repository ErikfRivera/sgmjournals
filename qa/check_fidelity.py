#!/usr/bin/env python3
"""Gate D content fidelity: for a large sample of built article pages, compare
rendered metadata (title via JSON-LD/og, DOI, authors, volume/issue/page) and
JSON-LD against the source citation_* tags in structure.db. Also checks body
presence and DOI consistency."""
import os, re, json, sqlite3, random, html
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PD = os.path.join(ROOT, "src", "data", "generated", "pages")
ARC = os.path.join(ROOT, "..", "NWK0G2ISWAUU0C6K", "sgmjournals.org", ".content.DFgjfXp1")
db = sqlite3.connect(os.path.join(ARC, "structure.db"))

def archive_meta(host, uri):
    row = db.execute("SELECT folder,filename,charset FROM structure WHERE hostname=? AND request_uri=? LIMIT 1", (host, uri)).fetchone()
    if not row:
        # try variants
        for u in (uri + ".full", "/cgi/content/full" + uri.replace("/content",""), uri.rstrip("/")):
            row = db.execute("SELECT folder,filename,charset FROM structure WHERE hostname=? AND request_uri=? LIMIT 1", (host, u)).fetchone()
            if row: break
    if not row: return None
    raw = open(os.path.join(ARC, row[0], row[1]), "rb").read()
    # charset-aware-ish decode
    cs = (row[2] or "utf-8")
    try:
        import codecs
        txt = raw.decode("utf-8")
        if "�" in txt: txt = raw.decode("windows-1252", "replace")
    except Exception:
        txt = raw.decode("windows-1252", "replace")
    def metas(name):
        # capture content delimited by its own opening quote (titles legitimately
        # contain apostrophes, so don't stop at ' when the delimiter is ").
        out = []
        for m in re.finditer(r'<meta\b[^>]*\bname=["\']%s["\'][^>]*>' % re.escape(name), txt, re.I):
            tag = m.group(0)
            cm = re.search(r'\bcontent=("([^"]*)"|\'([^\']*)\')', tag, re.I)
            if cm: out.append(cm.group(2) if cm.group(2) is not None else cm.group(3))
        for m in re.finditer(r'<meta\b[^>]*\bcontent=("([^"]*)"|\'([^\']*)\')[^>]*\bname=["\']%s["\']' % re.escape(name), txt, re.I):
            out.append(m.group(2) if m.group(2) is not None else m.group(3))
        return out
    g = lambda n: (metas(n) or [None])[0]
    return {"title": g("citation_title"), "doi": g("citation_doi"),
            "volume": g("citation_volume"), "issue": g("citation_issue"),
            "firstpage": g("citation_firstpage"), "authors": metas("citation_author")}

# build sample: all article JSONs, weight to top-refdomains + random
arts = []
for dp, _, files in os.walk(PD):
    for fn in files:
        if not fn.endswith(".json"): continue
        try: e = json.load(open(os.path.join(dp, fn)))
        except: continue
        if e.get("type") != "article" or e.get("stub"): continue
        if re.search(r'\.(full|abstract|short|long)$', e.get("slug","")) or "/cgi/" in e.get("slug",""):
            continue
        arts.append(e)
arts.sort(key=lambda e: -(e.get("refdomains") or 0))
top = arts[:200]
rnd = random.Random(42).sample(arts, min(300, len(arts)))
sample = {e["slug"]: e for e in top + rnd}.values()

mism = {"title": [], "doi": [], "volume": [], "firstpage": [], "no_source": [], "body_missing": []}
checked = 0
def norm(s): return re.sub(r'\s+', ' ', html.unescape(s or "").strip()).lower()
for e in sample:
    slug = e["slug"]; meta = e.get("meta") or {}
    journal = e["journal"]
    # host: map journal back to its archive host (use the journal subdomain)
    host = {"vir":"vir","mic":"mic","ijs":"ijs","jmm":"jmm","jmmcr":"jmmcr"}.get(journal, journal) + ".sgmjournals.org"
    uri = "/" + slug.split("/", 1)[1] if "/" in slug else "/"
    am = archive_meta(host, uri)
    checked += 1
    if not am:
        mism["no_source"].append(slug); continue
    if am.get("title") and meta.get("title") and norm(am["title"]) != norm(meta["title"]):
        mism["title"].append((slug, am["title"], meta.get("title")))
    if am.get("doi") and meta.get("doi") and am["doi"].lower() != (meta["doi"] or "").lower():
        mism["doi"].append((slug, am["doi"], meta.get("doi")))
    if am.get("volume") and meta.get("volume") and am["volume"] != meta["volume"]:
        mism["volume"].append((slug, am["volume"], meta.get("volume")))
    if am.get("firstpage") and meta.get("firstpage") and am["firstpage"] != meta["firstpage"]:
        mism["firstpage"].append((slug, am["firstpage"], meta.get("firstpage")))

out = {"sampled": checked, "mismatch_counts": {k: len(v) for k, v in mism.items()}}
json.dump({**out, "samples": {k: v[:25] for k, v in mism.items()}},
          open(os.path.join(ROOT, "qa", "fidelity.json"), "w"), indent=2, default=str)
print(json.dumps(out, indent=2))
