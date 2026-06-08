# sgmjournals.org — static rebuild

A single-domain static [Astro](https://astro.build) rebuild of the defunct
multi-subdomain Society for General Microbiology journal platform, served from
`https://www.sgmjournals.org/`. Content is rebuilt from an Archivarix recovery
of the original HighWire site — never re-scraped from the web.

## Architecture

- **`scripts/ingest.mjs`** — the content pipeline. Reads `structure.db` (SQLite
  index of every recovered object) and `sgm_rebuild_manifest.csv` (the
  prioritized, backlink-ranked work queue), extracts each page from its recovered
  HTML, and emits:
  - `src/data/generated/pages/**/*.json` — one structured entry per page
  - `public/assets/**` — copied figures and PDFs
  - `public/_redirects` — every recovered URL variant → its canonical article URL
  - `progress.json` — resumable build state (`--reset` to rebuild from scratch)
  - `unbuilt.csv` — pages with no recovered source / deferred
  - `scripts/lib/` — `db.mjs` (structure.db + asset resolution), `extract.mjs`
    (HighWire → clean content via cheerio), `csv.mjs`, `paths.mjs`.
- **`src/pages/index.astro`** — site root (journal portfolio).
- **`src/pages/[...slug].astro`** — catch-all that renders every generated entry
  (article / journal-home / info-page) inside the design system.
- **`src/styles/`** — the Claude Design system (tokens + base utilities + site
  layout), with `extra.css` extending it to the article full-text surface.
- **`src/lib/journals.js`** — the canonical journal portfolio (codes, names,
  per-journal accent colors, ISSNs).

## Build

```bash
npm install
npm run ingest        # process the whole manifest (resumable); or --limit N
npm run build         # astro build -> dist/
npm run preview
```

The ingest script reads the archive from the sibling cowork input directory
(`../`), so it must run on a machine that has the archive present.

## URL model

One canonical URL per article:

```
https://www.sgmjournals.org/<journal>/content/<vol>/<issue>/<page>
```

Per-journal path prefixes: `/vir`, `/mic`, `/ijs`, `/jmm`, `/jmmcr`.
Journal-code mapping applied during ingest: `jgv → vir`, `ijsb → ijs`;
`intl-` / `submit-` / `m.` prefixes stripped to the base journal; portal hosts
(`sgmjournals.org`, `www`, `intl`) → site root.

Every recovered variant (`.full`, `.abstract`, `.short`, `.long`,
`.full.pdf+html`, `cgi/content/full`, `cgi/reprint`, …) is mapped to the canonical
article URL in `public/_redirects`, and every page emits `<link rel="canonical">`.

## Cloudflare host-level redirects (already deployed — documented, not built here)

The subdomain → `www` redirects are configured **outside this repo** as a
Cloudflare Bulk Redirect (list `journalsubdomains`, 19 entries, 301, subpath
matching + preserve path suffix + preserve query). They prefix the journal path
and preserve the rest of the URL, e.g.:

```
vir.sgmjournals.org/*  →  www.sgmjournals.org/vir/*
mic.sgmjournals.org/*  →  www.sgmjournals.org/mic/*
ijs.sgmjournals.org/*  →  www.sgmjournals.org/ijs/*
jmm.sgmjournals.org/*  →  www.sgmjournals.org/jmm/*
jgv.sgmjournals.org/*  →  www.sgmjournals.org/vir/*   (alias)
ijsb.sgmjournals.org/* →  www.sgmjournals.org/ijs/*   (alias)
intl-*/submit-*/m.*    →  base journal
apex + intl            →  site root
```

These fire only for hosts whose DNS is proxied through Cloudflare. The in-site
variant → canonical redirects (`public/_redirects`) handle the path-level
canonicalization after the host rewrite.

## Pipeline order

```bash
npm run ingest          # Phase 1-2: backlinked manifest (3,423 pages)
node scripts/phase4.mjs # Phase 4: bounded sweep of remaining archive articles
node scripts/phase3.mjs # Phase 3: pmidlookup resolver + citation stubs
node scripts/aliases.mjs# Recreate a real page at every Ahrefs backlink-target URL
node scripts/phase5.mjs # Phase 5: sitemap.xml, robots.txt, build-report.md
npm run build           # astro build -> dist/
```

Run phase4 before phase3 (stubs fill genuine gaps) and aliases after both
(it reuses the canonical content). `npm run build` raises the Node heap
(`--max-old-space-size`) because getStaticPaths loads all generated entries.

## Backlinked URLs are recreated, not redirected

Every distinct target URL in the Ahrefs export is rebuilt as a **real 200 page**
at its in-site path (after the Cloudflare host→`/<journal>/` rewrite): article
variants (`.full`, `.abstract`, `.short`, `.long`, `cgi/content/full|abstract|…`,
`cgi/reprint`) render the same content as their canonical and carry
`rel="canonical"` → the clean URL; `.full.pdf` URLs serve the recovered PDF; info
/ misc pages are rebuilt from the archive (or a minimal stub when not recovered).
These recreated pages are excluded from `sitemap.xml` (the canonical is listed).
There are **no in-site variant→canonical redirects** — the only redirects are the
host-level subdomain→`www` rules in Cloudflare (documented below).

## Deploy (Vercel, from Git)

`vercel.json` configures a Git-driven build: `npm run build`, output `dist/`.
The generated data and assets are committed so Vercel builds without the archive.
`npm install --omit=dev` skips the ingest-only native deps (better-sqlite3,
cheerio) — run a full `npm install` locally before re-running the pipeline.

## Status

All phases complete. ~14,000 pages built: ~4,750 indexable canonical pages
(full-text articles + journal homes + info pages), ~4,360 noindex citation/
metadata-only pages, and ~5,000 recreated backlink-variant pages (real 200s with
`rel=canonical` to the clean URL). See `build-report.md` for current counts and
`unbuilt.csv` for rows with no recovered source.

Phase 4 is a **bounded** sweep (distinct articles with recovered full text); the
~130K raw HTML rows include figure/expansion/TOC files that are intentionally not
turned into pages.
