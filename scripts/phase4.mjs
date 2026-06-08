#!/usr/bin/env node
// Phase 4 (bounded sweep): build every distinct article in structure.db that has
// recovered full text and isn't already built, skipping variant/figure/TOC noise.
//
//   node scripts/phase4.mjs            # process all
//   node scripts/phase4.mjs --limit N  # cap new builds (smoke test)
import fs from 'node:fs';
import path from 'node:path';
import { db, fileForRow, copyAsset } from './lib/db.mjs';
import { extractArticle } from './lib/extract.mjs';
import { DATA_DIR, PUBLIC_DIR, PROGRESS_JSON, hostToJournal } from './lib/paths.mjs';

const args = process.argv.slice(2);
const LIMIT = args.indexOf('--limit') >= 0 ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;

const PAGES_DIR = path.join(DATA_DIR, 'pages');
const prog = JSON.parse(fs.readFileSync(PROGRESS_JSON, 'utf-8'));
prog.built ||= {}; prog.redirects ||= {}; prog.pmidIndex ||= {};

const VARIANT_RANK = { full: 5, '': 4, long: 3, abstract: 2, short: 1 };

// Parse a /content/... request_uri into a canonical slug + variant rank.
function parseArticle(host, uri) {
  const journal = hostToJournal(host);
  if (!journal || !['vir', 'mic', 'ijs', 'jmm', 'jmmcr'].includes(journal)) return null;
  const m = uri.match(/^\/content\/(.+)$/);
  if (!m) return null;
  let rest = m[1];
  // reject anything with a query/fragment (e.g. "?ck=nck") — never a real article
  if (/[?#]/.test(rest)) return null;
  // reject figure/supplement/expansion/pdf/asset paths
  if (/expansion|suppl|\/F\d|\/T\d|\/DC\d|\.pdf|\.gif|\.jpg|\.jpeg|\.png|\.cited|\.figures-only|\.article-info|\/embed/i.test(rest)) return null;
  // variant suffix
  let variant = '';
  const vm = rest.match(/\.(full|abstract|short|long)$/);
  if (vm) { variant = vm[1]; rest = rest.slice(0, -(vm[0].length)); }
  // 3-segment V/I/P
  const seg = rest.match(/^([^/]+)\/([^/]+)\/([^/]+)$/);
  if (seg) {
    const [, vol, issue, page] = seg;
    if (/[{}\[\]<>"'\s|\\^`%.]/.test(page) || /[{}\[\]<>"'\s|\\^`%?#]/.test(vol + issue)) return null;
    return { journal, slug: `${journal}/content/${vol}/${issue}/${page}`, vol, issue, page, variant };
  }
  // single-segment DOI-style id (e.g. mic.0.053959-0)
  if (!rest.includes('/') && /^[a-z]+\.[0-9]/i.test(rest)) {
    if (/[{}\[\]<>"'\s|\\^`%?#]/.test(rest)) return null;
    return { journal, slug: `${journal}/content/${rest}`, id: rest, variant };
  }
  return null;
}

// Collect best source row per canonical slug.
const rows = db().prepare(
  `SELECT hostname, request_uri, folder, filename, mimetype FROM structure
   WHERE mimetype IN ('text/html','application/xhtml+xml') AND request_uri LIKE '/content/%'`
).all();

const best = new Map(); // slug -> { rank, row, parsed }
for (const r of rows) {
  const p = parseArticle(r.hostname, r.request_uri);
  if (!p) continue;
  const rank = VARIANT_RANK[p.variant] ?? 0;
  const cur = best.get(p.slug);
  if (!cur || rank > cur.rank) best.set(p.slug, { rank, row: r, parsed: p });
}
console.log(`Candidate distinct articles in archive: ${best.size}`);

function articleVariants(slug) {
  const m = slug.match(/^([a-z]+)\/content\/(.+)$/);
  if (!m) return [];
  const [, journal, rest] = m;
  const base = '/' + slug;
  return [
    `/${journal}/content/${rest}.full`, `/${journal}/content/${rest}.abstract`,
    `/${journal}/content/${rest}.short`, `/${journal}/content/${rest}.long`,
    `/${journal}/content/${rest}.full.pdf+html`,
    `/${journal}/cgi/content/full/${rest}`, `/${journal}/cgi/content/abstract/${rest}`,
    `/${journal}/cgi/content/short/${rest}`, `/${journal}/cgi/content/long/${rest}`,
    `/${journal}/cgi/reprint/${rest}`,
  ].filter((v) => v !== base).map((v) => [v, base]);
}

let built = 0, skipped = 0, empty = 0, errors = 0;
for (const [slug, { row, parsed }] of best) {
  if (built >= LIMIT) break;
  if (prog.built[slug]) { skipped++; continue; }
  const file = path.join(PAGES_DIR, `${slug}.json`);
  if (fs.existsSync(file)) { prog.built[slug] = { type: 'article-sweep', ts: 0 }; skipped++; continue; }

  const f = fileForRow(row);
  if (!f || !fs.existsSync(f)) { continue; }
  let html;
  try { html = fs.readFileSync(f, 'utf-8'); } catch { continue; }

  const ctx = { host: row.hostname, requestUri: row.request_uri, journal: parsed.journal };
  let ex;
  try { ex = extractArticle(html, ctx); } catch (e) { errors++; continue; }
  // require real content
  if (!ex.bodyHtml && !ex.abstractHtml && !(ex.meta && ex.meta.title)) { empty++; continue; }

  let pdfPath = null;
  if (ex.pdf && ex.pdf.row) { const wp = copyAsset(ex.pdf.row, parsed.journal); if (wp) pdfPath = wp; }
  if (ex.meta && ex.meta.pmid) prog.pmidIndex[ex.meta.pmid] = '/' + slug;

  const entry = {
    type: 'article', slug, journal: parsed.journal,
    canonical: `https://www.sgmjournals.org/${slug}`,
    meta: ex.meta, abstractHtml: ex.abstractHtml, bodyHtml: ex.bodyHtml,
    referencesHtml: ex.referencesHtml, affiliationsHtml: ex.affiliationsHtml,
    correspHtml: ex.correspHtml, pdfPath, refdomains: 0,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(entry));
  for (const [from, to] of articleVariants(slug)) prog.redirects[from] = to;
  prog.built[slug] = { type: 'article-sweep', ts: 0 };
  built++;
  if (built % 500 === 0) { fs.writeFileSync(PROGRESS_JSON, JSON.stringify(prog, null, 2)); console.log(`  built ${built}…`); }
}

fs.writeFileSync(PROGRESS_JSON, JSON.stringify(prog, null, 2));
// rewrite _redirects
const lines = ['# Generated by ingest.mjs + phase3.mjs + phase4.mjs — variant -> canonical (in-site).'];
for (const [from, to] of Object.entries(prog.redirects).sort()) lines.push(`${from} ${to} 301`);
fs.writeFileSync(path.join(PUBLIC_DIR, '_redirects'), lines.join('\n') + '\n');

console.log(`\nNew built: ${built}  Skipped(existing): ${skipped}  Empty(skipped): ${empty}  Errors: ${errors}`);
console.log(`Total built: ${Object.keys(prog.built).length}  Redirects: ${Object.keys(prog.redirects).length}`);
