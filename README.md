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

## Status

Phase 0 (scaffold + ingest) and Phase 1 (site root + journal homes) complete;
articles render end-to-end. The pipeline walks the manifest top-to-bottom by
referring-domain rank. See the PRD in the cowork input directory for the full
phase plan.
