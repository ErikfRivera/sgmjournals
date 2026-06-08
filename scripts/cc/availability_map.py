#!/usr/bin/env python3
"""US-CC-001: Build the article -> best-available-tier map from structure.db.

For every distinct article (journal, vol, issue, page) present in the Archivarix
archive, record the richest source available and the archive file that backs it:

  tier1-full     : full-text HTML  (/cgi/content/full/V/I/P  or  /content/V/I/P.full
                   or the .long variant)         -> render full article body
  tier2-pdf      : PDF only (no full HTML)       -> PDF-derived summary + abstract + PDF
  tier3-abstract : abstract/short only           -> render abstract
  none           : nothing usable

Writes scripts/cc/availability_map.json (slug -> record) and prints a summary.
"""
import sqlite3, os, re, json, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo
INPUT = os.path.dirname(ROOT)
CONTENT = os.path.join(INPUT, "NWK0G2ISWAUU0C6K", "sgmjournals.org", ".content.DFgjfXp1")
DB = os.path.join(CONTENT, "structure.db")
HTMLDIR = os.path.join(CONTENT, "html")
BINDIR = os.path.join(CONTENT, "binary")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "availability_map.json")

JOURNALS = {"vir", "mic", "ijs", "jmm", "jmmcr"}

def host_to_journal(h):
    if not h:
        return None
    h = h.lower().replace("https://", "").replace("http://", "")
    m = re.match(r"^(.+)\.sgmjournals\.org$", h)
    sub = m.group(1) if m else h.replace(".sgmjournals.org", "")
    sub = re.sub(r"^intl-", "", sub)
    sub = re.sub(r"^submit-", "", sub)
    sub = re.sub(r"^m\.", "", sub)
    sub = re.sub(r"^www\.", "", sub)
    sub = re.sub(r"^old\.", "", sub)
    sub = {"jgv": "vir", "ijsb": "ijs"}.get(sub, sub)
    return sub if sub in JOURNALS else None

# request_uri -> (kind, vol, issue, page) or None.  kind in full/long/abstract/short/pdf
PATTERNS = [
    ("full",     re.compile(r"^/cgi/content/full/([^/]+)/([^/]+)/([^/?#]+)$")),
    ("full",     re.compile(r"^/content/([^/]+)/([^/]+)/([^/?#]+)\.full$")),
    ("long",     re.compile(r"^/cgi/content/long/([^/]+)/([^/]+)/([^/?#]+)$")),
    ("long",     re.compile(r"^/content/([^/]+)/([^/]+)/([^/?#]+)\.long$")),
    ("abstract", re.compile(r"^/cgi/content/abstract/([^/]+)/([^/]+)/([^/?#]+)$")),
    ("abstract", re.compile(r"^/content/([^/]+)/([^/]+)/([^/?#]+)\.abstract$")),
    ("short",    re.compile(r"^/cgi/content/short/([^/]+)/([^/]+)/([^/?#]+)$")),
    ("short",    re.compile(r"^/content/([^/]+)/([^/]+)/([^/?#]+)\.short$")),
    ("pdf",      re.compile(r"^/content/([^/]+)/([^/]+)/([^/?#]+)\.full\.pdf$")),
    ("pdf",      re.compile(r"^/cgi/reprint/([^/]+)/([^/]+)/([^/?#]+?)(?:\.pdf)?$")),
]
# numeric V/I and page that is digits + optional short alpha suffix (e.g. 651, 1207a)
VALID_VIP = re.compile(r"^\d+$"), re.compile(r"^\d+$"), re.compile(r"^\d+[A-Za-z]?$")

def classify(uri):
    for kind, pat in PATTERNS:
        m = pat.match(uri)
        if not m:
            continue
        vol, issue, page = m.group(1), m.group(2), m.group(3)
        if not (VALID_VIP[0].match(vol) and VALID_VIP[1].match(issue) and VALID_VIP[2].match(page)):
            return None
        return kind, vol, issue, page
    return None

# tier rank for choosing the best HTML source within a tier
HTML_RANK = {"full": 4, "long": 3, "abstract": 2, "short": 1}

def main():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT hostname, request_uri, folder, filename, mimetype, filesize FROM structure WHERE enabled=1"
    ).fetchall()
    # slug -> dict with best html row + pdf row + per-kind presence
    arts = {}
    for r in rows:
        journal = host_to_journal(r["hostname"])
        if not journal:
            continue
        c = classify(r["request_uri"])
        if not c:
            continue
        kind, vol, issue, page = c
        slug = f"{journal}/content/{vol}/{issue}/{page}"
        a = arts.setdefault(slug, {"slug": slug, "journal": journal, "vol": vol,
                                   "issue": issue, "page": page,
                                   "html": None, "html_kind": None, "html_rank": -1,
                                   "pdf": None, "kinds": set(), "files": {}})
        a["kinds"].add(kind)
        ref = {"folder": r["folder"], "filename": r["filename"],
               "uri": r["request_uri"], "filesize": r["filesize"]}
        if kind == "pdf":
            # a real PDF is served as application/pdf (Archivarix stores it under
            # binary/). A /cgi/reprint/...pdf that is text/html is an HTML wall, not
            # a PDF — exclude it so it never counts as a Tier-2 source.
            if r["mimetype"] == "application/pdf":
                if a["pdf"] is None or (r["filesize"] or 0) > (a["pdf"]["filesize"] or 0):
                    a["pdf"] = ref
        else:
            # keep the largest file seen per kind (largest is most likely real content)
            prev = a["files"].get(kind)
            if prev is None or (ref["filesize"] or 0) > (prev["filesize"] or 0):
                a["files"][kind] = ref
            rank = HTML_RANK.get(kind, 0)
            if rank > a["html_rank"]:
                a["html_rank"] = rank
                a["html_kind"] = kind
                a["html"] = ref

    # finalize best tier
    out = {}
    summary = {"tier1-full": 0, "tier2-pdf": 0, "tier3-abstract": 0, "none": 0}
    fmt_summary = {"new": 0, "old": 0, "unknown": 0}
    for slug, a in arts.items():
        html_kind = a["html_kind"]
        has_full_html = html_kind in ("full", "long")
        has_abs_html = html_kind in ("abstract", "short")
        has_pdf = a["pdf"] is not None
        if has_full_html:
            best = "tier1-full"
        elif has_pdf:
            best = "tier2-pdf"
        elif has_abs_html:
            best = "tier3-abstract"
        else:
            best = "none"
        summary[best] += 1
        def fp(kind):
            f = a["files"].get(kind)
            return (f["folder"] + "/" + f["filename"]) if f else None
        def furi(kind):
            f = a["files"].get(kind)
            return f["uri"] if f else None
        rec = {
            "slug": slug, "journal": a["journal"],
            "vol": a["vol"], "issue": a["issue"], "page": a["page"],
            "best_tier": best,  # URL-based candidate tier; actual tier resolved at build
            "html_kind": html_kind,
            "html_file": (a["html"]["folder"] + "/" + a["html"]["filename"]) if a["html"] else None,
            "html_uri": a["html"]["uri"] if a["html"] else None,
            "full_file": fp("full"), "full_uri": furi("full"),
            "long_file": fp("long"), "long_uri": furi("long"),
            "abstract_file": fp("abstract"), "abstract_uri": furi("abstract"),
            "short_file": fp("short"), "short_uri": furi("short"),
            "pdf_file": (a["pdf"]["folder"] + "/" + a["pdf"]["filename"]) if a["pdf"] else None,
            "pdf_uri": a["pdf"]["uri"] if a["pdf"] else None,
        }
        out[slug] = rec

    with open(OUT, "w") as f:
        json.dump(out, f)
    print(f"Distinct articles: {len(out)}")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    print(f"Written {OUT}")

if __name__ == "__main__":
    main()
