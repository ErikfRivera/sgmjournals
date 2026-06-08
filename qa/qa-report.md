# QA report — sgmjournals.org rebuild (deep, page-by-page pass)

Independent, page-by-page QA of the rebuilt static site in `../sgmjournals`,
per `PRD-sgmjournals-QA.md` + `QA-runbook-sgmjournals.md`. Every check below was
re-derived from scratch against a clean `astro build` of `dist/` (14,302 pages),
not taken from prior reports. Scripts live in `qa/`.

**Routing model under test (important):** production is Cloudflare (host →
`/<journal>/<path>`, path preserved) → Vercel static. `public/_redirects` is
**not** deployed (`.gitignore`), and `middleware.js` only rewrites percent-junk
paths — so every clean variant URL (`.full`, `.abstract`, `cgi/content/*`,
`cgi/reprint`) must be a **real built file** or it 404s. `qa/resolve.py` mirrors
this exactly and was the authoritative Gate-B check.

## Hard gates — all GREEN ✅

| Gate | Result |
|---|---|
| **A Build integrity** | **PASS** |
| **B Backlink coverage** | **PASS — 6173/6173 (100%)** |
| **C URL & canonical correctness** | **PASS** |

---

## A. Build integrity — HARD GATE ✅ PASS
| Check | Result |
|---|---|
| A-1 `astro build` clean | **PASS** — exit 0, **14,302 pages**, 0 errors / 0 warnings / 0 unresolved imports (`qa/build-final.log`) |
| A-2 no broken internal links | **PASS** — 544,156 internal `<a>/<img>/<area>` links across 14,302 pages; **0 broken** (`qa/check_links.py`, `qa/qa-broken-links.csv` empty). Found and fixed **385** pre-existing broken links (see Fixes). |
| A-3 trailing-slash consistent | **PASS** — directory output; `vercel.json trailingSlash:false`; canonical URLs slash-free; `/x` and `/x/` both serve the same file |

## B. Coverage — HARD GATE ✅ PASS
| Check | Result |
|---|---|
| B-1 every in-archive manifest row built | **PASS** |
| B-2 every backlink Target URL → 200 | **PASS — 6173/6173 (100%)**; 6,134 served directly as real files, 39 percent-junk URLs normalized by `middleware.js` to a real canonical; **0 misses** (`qa/resolve.py`, `qa/backlink-coverage-report.csv`, `qa/qa-gaps.csv` empty) |
| B-3 gaps recreated | **PASS** — coverage source mix: archive 2,406 · generated (citation-only) 3,728 · redirect 39 |

## C. URL & canonical correctness — HARD GATE ✅ PASS
| Check | Result |
|---|---|
| C-1 one canonical per article; prefix map | **PASS** — 0 pages under `/jgv` or `/ijsb`; `intl-`/`submit-`/`m.`/`www.`/`old.` stripped; portal → root. DOI-based consolidation merged 35→ multi-URL lifecycle duplicates (early-access + manuscript-ID + final) to one canonical. |
| C-2 self-referential `rel=canonical` | **PASS** — **0** pages missing a canonical (14,302/14,302). Variant/lifecycle pages canonicalize to their clean base (fixed 20 self-canonical variants + 93 DOI-duplicate pages). |
| C-3 variant chains end in 200; no loops | **PASS** — variants are real pages or normalize via middleware; verified no loops |

## D. Content fidelity ✅ PASS
| Check | Result |
|---|---|
| D-1 title/authors/vol/issue/page/DOI vs `citation_*` | **PASS** — 491 sampled articles vs `structure.db`: **0 DOI, 0 volume, 0 firstpage mismatches**; all title "mismatches" were verifier artifacts or the built page being *more* correct (`β` vs HighWire `{beta}`, proper en-dash). `qa/check_fidelity.py` |
| D-2 body / abstract present | **PASS** — full-text body on captured articles; abstract on abstract pages; citation-only where source had none |
| D-3 scientific Unicode, no mojibake | **PASS** — corpus-wide **0** `U+FFFD` / C1-control / `ï¿½` mojibake (was 12 pages). Root cause fixed: charset-aware archive decode (windows-1250/1252/mac vs UTF-8). `qa/scan_pages.py` |
| D-4 no HighWire chrome | **PASS** — **0** real chrome `<script>`/login/ad/nav (the 9 "chrome" scan hits are legitimate body text mentioning "HighWire") |
| D-5 generated pages = citation only | **PASS** — no fabricated body text; citation metadata + "not available" note only |

## E. Assets ✅ PASS
| Check | Result |
|---|---|
| E-1 figure images resolve | **PASS** — 0 broken `<img src>` (covered by A-2 link crawl) |
| E-2 article PDFs downloadable + linked | **PASS** — **190/190** recovered PDFs present in `dist` and linked from their page (0 missing, 0 unlinked); 1,110 PDFs total. `.full.pdf` backlinks without a recovered PDF fall back to the article page (no 404). |

## F. SEO & structured data ✅ PASS
| Check | Result |
|---|---|
| F-1 unique title + meta description | **PASS** — 0 pages missing title/description. Indexable duplicate-title groups cut 46→14 (info-page titles fixed, lifecycle URLs de-duped from sitemap, fragment pages noindexed). Remaining dups are faithful recurring-series articles (IJS Validation/Notification Lists) — not defects. |
| F-2 valid `ScholarlyArticle` JSON-LD | **PASS** — 400 sampled indexable articles: **0 parse failures, 0 missing**; headline 100%, journal 100%, vol/issue/page 98%. **Author coverage on indexable articles raised ~50% → 99%** by fixing a case-sensitivity bug in `dc.Contributor` extraction + cross-capture metadata recovery (2,246 pages). |
| F-3 sitemap + robots | **PASS** — `sitemap.xml` (well-formed, 5,125 canonical indexable URLs) + `robots.txt` present |
| F-4 Lighthouse SEO ≥ 95 | **PASS** — 5/5 sampled **indexable** article pages scored **SEO 100** (Chrome headless). Noindex citation stubs intentionally score lower (the `noindex` is the only failing audit). |

## G. Design & accessibility — reviewed
| Check | Result |
|---|---|
| G-1 design consistent | **PASS** — single Claude Design system across home, journal-home, article, info layouts |
| G-2 responsive, alt, headings, contrast | **PASS / reviewed** — **single `<h1>` per page** (fixed 12 double-`<h1>` info pages by demoting body `<h1>`→`<h2>`); 0 images missing `alt`; Lighthouse a11y 81–88 on samples (minor contrast/landmark items noted for follow-up, soft gate) |

---

## Fixes applied this pass (committed to source, reproducible)
1. **Charset-aware archive decode** (`lib/db.mjs` `decodeArchive`, `ingest.mjs`): legacy windows-1250/1252/mac-centraleurope captures were read as UTF-8, collapsing £, apostrophes, en-dashes, Š → `U+FFFD`. Scoring decoder picks the table with fewest replacement/C1 chars. Repaired 11 mojibake pages from source (`repair-charset.mjs`) + 1 double-encoded (`ï¿½`).
2. **Internal-link integrity** (`fix-links.mjs`): now also sanitizes `<area>` image-map links and mangled protocol-relative (`//misc/…`) links; demotes body `<h1>`→`<h2>`. 385 broken internal links → 0.
3. **Canonical correctness**: `fix-variant-canonical.mjs` (variant self-canonical → clean base, 20), `fix-doi-canonical.mjs` (lifecycle/format duplicates → one canonical by DOI, 93 pages).
4. **Metadata recovery** (`recover-meta.mjs` + case-insensitive `extractMeta`): recovered authors for 2,246 pages and real titles for 207 from sibling archive captures (`dc.Contributor`/`citation_author`) the main ingest had missed. Pure citation metadata — no fabrication.
5. **SEO hygiene**: `fix-info-titles.mjs` (descriptive, unique info-page titles; noindex thin tool/feed endpoints), `fix-noindex-fragments.mjs` (figure/table/suppl fragment pages → noindex), sitemap de-dup (journal-home trailing slash; lifecycle URLs).

## Outputs (in `qa/`)
- `per-page-report.csv` — 6,173 backlinked URLs × {exists, canonical-OK, links-OK, seo-OK, content-OK, source}
- `backlink-coverage-report.csv` — every target URL → status / canonical / source
- `qa-broken-links.csv` (empty), `qa-gaps.csv` (empty), `resolve-report.csv`, `scan-summary.json`, `canonical-check.json`, `fidelity.json`, `link-check.json`, `lh/`

## Summary
```
Backlinked URLs resolving: 6173/6173 (100%)
Pages with all checks passing: 6173/6173 (100%)
```
Hard gates A, B, C are all green. D–F pass with no critical defects; G reviewed.
