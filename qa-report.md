# QA report — sgmjournals.org rebuild

Run against the built `dist/` (14,289 generated pages) and verified live at
`https://www.sgmjournals.org/`. Hard gates **A, B, C are all green**.

Reproduce: `npm run ingest && node scripts/phase4.mjs && node scripts/repair-meta.mjs && node scripts/phase3.mjs && node scripts/aliases.mjs && node scripts/fix-links.mjs && node scripts/phase5.mjs && npm run build && node scripts/qa.mjs && node scripts/qa-content.mjs`

## A. Build integrity — HARD GATE ✅ PASS
| Check | Result |
|---|---|
| A-1 `astro build` completes, no errors | **PASS** — 14,289 pages built, exit 0 |
| A-2 no broken internal links | **PASS** — 515,444 internal links crawled, **0 broken** (`qa-broken-links.csv` empty) |
| A-3 trailing-slash consistent | **PASS** — directory output; `vercel.json trailingSlash:false`; canonical URLs slash-free and 200 |

## B. Coverage — HARD GATE ✅ PASS
| Check | Result |
|---|---|
| B-1 every `in_archive=yes` manifest row built | **PASS** — 3,423 backlinked + 4,893 swept canonical pages |
| B-2 every backlink Target URL resolves to 200 | **PASS** — **6,173 / 6,173 (100%)**; 6,138 direct pages + 35 normalized; **0 404s** (`backlink-coverage-report.csv`, `qa-gaps.csv` empty) |
| B-3 page counts vs archive; gaps recreated | **PASS** — see `build-report.md`; gaps recreated as pages/citation stubs |

Approach: every distinct Ahrefs Target URL is a **real 200 page** (after the
Cloudflare host→`/<journal>/` rewrite) — not a redirect. Article variants
(`.full`, `.abstract`, `.short`, `.long`, `cgi/content/*`, `cgi/reprint`) render
the canonical's content with `rel=canonical`; `.full.pdf` URLs serve the
recovered PDF. The 35 "normalized" are corrupt referrer URLs (wiki dead-link
markup, citation-tool artifacts, trailing junk) handled by `middleware.js`, which
308s them to the clean canonical (which exists and 200s).

## C. URL & canonical correctness — HARD GATE ✅ PASS
| Check | Result |
|---|---|
| C-1 one canonical per article; journal prefix mapping | **PASS** — 0 pages under `/jgv` or `/ijsb` (mapped to `/vir`,`/ijs`); `intl-`/`submit-`/`m.`/`www.`/`old.` stripped; portal → root |
| C-2 self-referential `rel=canonical` | **PASS** — 0 pages missing canonical; variant pages canonicalize to the clean URL |
| C-3 variant chains end in 200 | **PASS** — variants are real pages; live chain verified: `vir.sgmjournals.org/…/694.full` → 301 (Cloudflare) → `www.sgmjournals.org/vir/…/694.full` → 200 |

## D. Content fidelity ✅ PASS
| Check | Result |
|---|---|
| D-1 title/authors/journal/vol/issue/page/DOI from `citation_*` | **PASS** — derived from citation meta; 690 pages whose chosen archive variant was a login wall were repaired by re-extracting from the non-walled `.abstract` variant (`repair-meta.mjs`), with CrossRef title fallback |
| D-2 full-text body / abstract present | **PASS** — `fulltext-view` body on full pages; abstract block on abstract pages |
| D-3 scientific Unicode preserved | **PASS** — spot-checked (e.g. `N₂`, `cd₁`, `Purificación`, italic taxa) — no mojibake |
| D-4 no leftover HighWire chrome | **PASS** — **0 pages** with chrome scripts/login widgets/ad slots |
| D-5 generated pages = citation only, no fabricated body | **PASS** — uncaptured/login-walled pages show citation metadata + "not available in archive" note; no invented body text |

## E. Assets ✅ PASS
| Check | Result |
|---|---|
| E-1 figure images resolve | **PASS** — **0 broken `<img>`**; recovered figures copied to `/assets/…`, missing figures shown as a labeled placeholder, chrome icons stripped |
| E-2 article PDFs downloadable + linked | **PASS** — recovered PDFs copied to their canonical path and linked from the HTML; backlinked `.full.pdf` URLs serve the PDF |

## F. SEO & structured data ✅ PASS (F-4 manual)
| Check | Result |
|---|---|
| F-1 unique title + meta description | **PASS** — 0 pages missing a description; titles are per-article (recreated variant URLs intentionally share their canonical's title and carry `rel=canonical`) |
| F-2 valid `ScholarlyArticle` JSON-LD | **PASS** — 14,083 article pages, **0 invalid** |
| F-3 `sitemap.xml` + `robots.txt` | **PASS** — sitemap lists 5,213 canonical URLs; robots present |
| F-4 Lighthouse SEO ≥ 95 | **Manual** — not scripted here; SEO fundamentals (title, description, canonical, JSON-LD, sitemap, semantic headings) are present on every article page |

## G. Design & accessibility — reviewed
| Check | Result |
|---|---|
| G-1 design applied consistently | **PASS** — one Claude Design system across home, journal-home, article, info layouts |
| G-2 responsive, alt text, heading order, contrast | **Reviewed** — mobile-first layout (drawer nav), figure `alt` preserved from source, single `<h1>` per page; full Lighthouse a11y pass recommended as a follow-up |

## Live verification (www.sgmjournals.org)

Crawled all 6,163 backlink URLs against the live domain, following the full chain
(Cloudflare host redirect → `middleware.js` → page). `backlink-live-report.csv`.

- **0 actual 404s.** Every URL whose host resolves returns 200/3xx.
- 5,080 resolve end-to-end; **1,083 fail at DNS only** (`fetch` TypeError, host has
  no DNS record) — not a site defect. Verified: 55/55 sampled DNS-failed URLs
  return 200 at their `www` path, i.e. the pages exist; only the subdomain→www
  redirect can't start without a DNS record.
- Middleware normalization confirmed live: junk URLs (e.g. `…/85/4/1029%20`,
  `…2449.full.pdf%5B%5D`) 308 to the clean canonical (200); clean variant pages
  (`/mic/cgi/content/full/150/11/3527`) serve directly with no redirect.

**Action required (DNS, outside this repo — §7 non-goal):** add proxied DNS
records (as `vir`/`mic`/`ijs` already have) for these hosts so the existing
Cloudflare bulk redirect fires:
`jmm`, `jmmcr`, `ijsb`, `mgen`, `intl`, `intl-vir`, `intl-mic`, `intl-jmm`,
`submit-vir`, `submit-mic` (.sgmjournals.org). Once added, live resolution
reaches 6,163/6,163.

## Outputs
- `backlink-coverage-report.csv` — every target URL → status / in-site path / kind (all `resolved`)
- `qa-broken-links.csv` — empty (0 broken internal links)
- `qa-gaps.csv` — empty (0 gaps)
- `build-report.md` — page counts per type/journal

## Summary
Backlinked URLs resolving: 6173/6173 (100%) — every backlinked URL has a real
page at its canonical `www` path (0 site 404s). Live end-to-end is 5,080/6,163
pending DNS records for 10 legacy subdomains (jmm, jmmcr, ijsb, mgen, intl, and
intl-/submit- variants); the pages themselves all exist and resolve at `www`.
