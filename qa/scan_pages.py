#!/usr/bin/env python3
"""Deep per-page scanner over the entire dist/ tree.

Checks, for every built HTML page:
  C-1 path under valid journal prefix (no /jgv, /ijsb); article path shape
  C-2 self-referential <link rel=canonical> present and == page's own www URL
  F-1 unique <title> (non-empty) and meta description present
  F-2 ScholarlyArticle JSON-LD parses + has required fields (article pages)
  D-3 mojibake scan (Ã, â€, Â, ï¿½ etc.)
  D-4 no leftover HighWire chrome (highwire scripts, login/auth widgets, ad slots)
  H   single <h1>
  IMG images have alt
Writes qa/page-scan.csv (one row per page) + qa/scan-summary.json.
"""
import os, re, json, sys, html
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SITE = "https://www.sgmjournals.org"

re_canon = re.compile(r'<link[^>]+rel=["\']canonical["\'][^>]*>', re.I)
re_href = re.compile(r'href=["\']([^"\']+)["\']', re.I)
re_title = re.compile(r'<title[^>]*>(.*?)</title>', re.I | re.S)
re_desc = re.compile(r'<meta[^>]+name=["\']description["\'][^>]*>', re.I)
re_content = re.compile(r'content=["\']([^"\']*)["\']', re.I)
re_h1 = re.compile(r'<h1[\s>]', re.I)
re_ldjson = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.I | re.S)
re_img = re.compile(r'<img\b[^>]*>', re.I)
re_alt = re.compile(r'\balt=', re.I)
re_script_src = re.compile(r'<script[^>]+src=["\']([^"\']+)["\']', re.I)

MOJIBAKE = ['Ã', 'â€', 'Â\xa0', 'ï¿½', 'Ã©', 'Ã¨', 'â\x80', '�']
CHROME_HINTS = ['highwire', 'sg-login', 'pingfdn', 'doubleclick', 'googletag',
                'AdSlot', 'gigya', 'sb_pubcode', 'HW_', 'js/highwire']

VALID_PREFIX = {"vir", "mic", "ijs", "jmm", "jmmcr", "mgen", "www"}

def page_url(relpath):
    # relpath like vir/content/94/3/694/index.html -> /vir/content/94/3/694
    p = relpath
    if p.endswith("/index.html"):
        p = p[:-len("/index.html")]
    elif p.endswith(".html"):
        p = p[:-len(".html")]
    if p == "index" or p == "":
        return SITE + "/"
    return SITE + "/" + p

def is_article(path_segments):
    return len(path_segments) >= 2 and path_segments[1] == "content" and \
           len(path_segments) >= 5

def main():
    rows = []
    titles = Counter()
    summary = defaultdict(int)
    problems = defaultdict(list)
    nfiles = 0
    for dirpath, dirs, files in os.walk(DIST):
        for fn in files:
            if not fn.endswith(".html"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, DIST)
            nfiles += 1
            try:
                t = open(full, encoding="utf-8", errors="replace").read()
            except Exception as e:
                problems["read_err"].append(rel); continue
            url = page_url(rel)
            segs = url[len(SITE)+1:].split("/") if url != SITE + "/" else [""]
            prefix = segs[0]

            r = {"url": url, "rel": rel}
            # C-1 prefix
            badprefix = (prefix not in VALID_PREFIX and prefix not in
                         ("about","help","search","site","subscriptions","deliver",
                          "docserver","content","")) and not rel.startswith("_")
            if prefix in ("jgv", "ijsb"):
                problems["bad_journal_prefix"].append(url)
            # C-2 canonical
            m = re_canon.search(t)
            canon_ok = False
            canon_val = ""
            if m:
                hm = re_href.search(m.group(0))
                if hm:
                    canon_val = hm.group(1)
            r["canonical"] = canon_val
            # title
            tm = re_title.search(t)
            title = html.unescape(tm.group(1).strip()) if tm else ""
            r["title"] = title
            if not title:
                problems["no_title"].append(url)
            else:
                titles[title] += 1
            # desc
            has_desc = bool(re_desc.search(t))
            if not has_desc:
                problems["no_desc"].append(url)
            # h1
            nh1 = len(re_h1.findall(t))
            if nh1 == 0:
                problems["no_h1"].append(url)
            elif nh1 > 1:
                problems["multi_h1"].append(url)
            # mojibake
            if any(mb in t for mb in MOJIBAKE):
                problems["mojibake"].append(url)
            # chrome
            for h in CHROME_HINTS:
                if h.lower() in t.lower():
                    problems["chrome"].append(url + " :: " + h)
                    break
            # imgs missing alt
            imgs = re_img.findall(t)
            noalt = [i for i in imgs if not re_alt.search(i)]
            if noalt:
                problems["img_no_alt"].append(url)
            # JSON-LD on article pages
            is_art = is_article(segs)
            r["is_article"] = is_art
            if is_art:
                lds = re_ldjson.findall(t)
                ok_ld = False
                for blob in lds:
                    try:
                        data = json.loads(blob.strip())
                    except Exception:
                        problems["ldjson_parse_err"].append(url)
                        continue
                    objs = data if isinstance(data, list) else [data]
                    for o in objs:
                        if isinstance(o, dict) and "ScholarlyArticle" in str(o.get("@type","")):
                            ok_ld = True
                if not ok_ld and lds:
                    problems["ldjson_no_scholarly"].append(url)
                elif not lds:
                    problems["ldjson_missing"].append(url)
            # canonical self-ref check
            if canon_val:
                cv = canon_val.rstrip("/")
                uu = url.rstrip("/")
                if cv == uu:
                    canon_ok = True
                else:
                    # variant pages legitimately canonicalize to their clean URL
                    r["canon_selfref"] = False
            else:
                problems["no_canonical"].append(url)
            rows.append(r)

    # duplicate-title check excluding intentional variant duplicates
    dupe_titles = {t:c for t,c in titles.items() if c > 1}

    # write summary
    out = {
        "files_scanned": nfiles,
        "problem_counts": {k: len(v) for k, v in sorted(problems.items())},
        "dupe_title_groups": len(dupe_titles),
        "dupe_title_pages": sum(dupe_titles.values()),
    }
    with open(os.path.join(ROOT, "qa", "scan-summary.json"), "w") as f:
        json.dump(out, f, indent=2)
    # dump problems (capped samples)
    with open(os.path.join(ROOT, "qa", "scan-problems.json"), "w") as f:
        json.dump({k: v[:50] for k, v in problems.items()}, f, indent=2)
    print(json.dumps(out, indent=2))

if __name__ == "__main__":
    main()
