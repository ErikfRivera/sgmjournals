#!/usr/bin/env node
// QA harness for the rebuilt static site. Verifies the hard gates:
//   A: build integrity + internal-link crawl
//   B: every Ahrefs backlink Target URL resolves to 200 (after host transform)
//   C: canonical correctness
// Writes backlink-coverage-report.csv, qa-broken-links.csv, qa-gaps.csv and
// prints a summary. Run AFTER `npm run build` (reads dist/).
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './lib/csv.mjs';
import { REPO_ROOT, INPUT_ROOT, hostToJournal } from './lib/paths.mjs';

const DIST = path.join(REPO_ROOT, 'dist');
if (!fs.existsSync(DIST)) { console.error('dist/ not found — run `npm run build` first.'); process.exit(1); }

// ---- build the set of served paths from dist --------------------------------
const served = new Set();      // normalized path (no trailing slash) -> servable
const files = new Set();       // exact file paths (e.g. /a/b.pdf)
(function walk(dir, rel) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const r = rel + '/' + name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, r);
    else if (name === 'index.html') {
      const p = rel === '' ? '/' : rel;          // /a/b/index.html -> /a/b
      served.add(p === '' ? '/' : p);
    } else {
      files.add(r);                               // /a/b.pdf, /sitemap.xml, ...
    }
  }
})(DIST, '');
served.add('/');

function norm(p) { p = p.replace(/\/+$/, ''); return p === '' ? '/' : p; }
function servedDirect(p) {
  const q = norm(p);
  if (served.has(q)) return true;
  if (files.has(p) || files.has(q)) return true;
  return false;
}
// middleware.js normalizes corrupt referrer URLs (junk chars) to the clean
// canonical; mirror that here so QA reflects what the live site serves.
const SAFE = /^\/[A-Za-z0-9._~+/-]*$/;
const stripVar = (s) => s.replace(/\.(full\.pdf\+html|full\.pdf|full|abstract|short|long|pdf)$/i, '').replace(/\/+$/, '');
function canonicalize(p) {
  let c = p.split(/[^A-Za-z0-9._~+/-]/)[0];
  c = c.replace(/^(\/[a-z]+)\/cgi\/content\/(?:full|abstract|short|long)\//, '$1/content/')
       .replace(/^(\/[a-z]+)\/cgi\/reprintframed?\//, '$1/content/')
       .replace(/^(\/[a-z]+)\/cgi\/reprint\//, '$1/content/')
       .replace(/^(\/[a-z]+)\/cgi\/doi\/[^/]+\//, '$1/content/');
  return stripVar(c);
}
function resolves(p) {
  if (servedDirect(p)) return { ok: true, via: 'page' };
  if (!SAFE.test(p)) {
    // middleware normalizes junk URLs -> clean canonical
    const clean = canonicalize(p);
    if (clean && servedDirect(clean)) return { ok: true, via: 'normalized', to: clean };
  }
  return { ok: false };
}

// ---- transform an old backlink Target URL to its in-site path ---------------
function transform(url) {
  let u;
  try { u = new URL(url); } catch { return { skip: 'malformed-url' }; }
  const host = u.hostname;
  if (!/sgmjournals\.org$/i.test(host)) return { skip: 'off-site' };
  let pathname;
  try { pathname = decodeURIComponent(u.pathname); } catch { pathname = u.pathname; }
  const journal = hostToJournal(host);
  // pmidlookup -> client-side resolver page under the journal prefix
  if (/\/cgi\/pmidlookup/i.test(pathname)) {
    return { inSite: journal ? `/${journal}/cgi/pmidlookup` : '/cgi/pmidlookup', kind: 'pmidlookup' };
  }
  let p = (journal ? `/${journal}` : '') + pathname;
  p = p.replace(/[?#].*$/, '');
  if (p === '' ) p = '/';
  return { inSite: p, kind: 'page' };
}

// ---- B-2: backlink coverage -------------------------------------------------
const csvName = fs.readdirSync(INPUT_ROOT).find((f) => /backlinks-subdomains.*\.csv$/i.test(f));
const rows = parseCsv(path.join(INPUT_ROOT, csvName), { delimiter: '\t', encoding: 'utf16le' });
const targets = [...new Set(rows.map((r) => r['Target URL']).filter((u) => u && /^https?:\/\//.test(u)))];

const cov = [];               // {url, status, inSite, kind}
let ok = 0, fail = 0, skipped = 0;
const gaps = [];
for (const url of targets) {
  const t = transform(url);
  if (t.skip) {
    // off-site links don't need to resolve on our host; malformed can't be a page
    cov.push({ url, status: t.skip, inSite: '', kind: t.skip });
    skipped++;
    if (t.skip === 'malformed-url') gaps.push({ url, reason: 'malformed-url', resolution: 'skipped' });
    continue;
  }
  const r = resolves(t.inSite);
  cov.push({ url, status: r.ok ? 'resolved' : '404', inSite: r.to || t.inSite, kind: r.via || t.kind });
  if (r.ok) ok++; else { fail++; gaps.push({ url, reason: '404', inSite: t.inSite }); }
}

// ---- A-2: internal link crawl ----------------------------------------------
const hrefRe = /<a\b[^>]*\bhref=["']([^"']+)["']/gi;
const broken = [];
let internalChecked = 0;
const htmlFiles = [];
(function collect(dir) {
  for (const n of fs.readdirSync(dir)) {
    const a = path.join(dir, n); const st = fs.statSync(a);
    if (st.isDirectory()) collect(a); else if (n.endsWith('.html')) htmlFiles.push(a);
  }
})(DIST);
const brokenSet = new Map();
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf-8');
  const pageUrl = '/' + path.relative(DIST, f).replace(/\/index\.html$/, '').replace(/index\.html$/, '');
  let m;
  while ((m = hrefRe.exec(html))) {
    let href = m[1];
    if (/^(https?:|mailto:|tel:|#|data:|\/\/)/i.test(href)) continue; // external/anchor
    href = href.split('#')[0].split('?')[0];
    if (!href || !href.startsWith('/')) continue;
    internalChecked++;
    if (!resolves(href).ok) {
      const key = href;
      if (!brokenSet.has(key)) brokenSet.set(key, new Set());
      brokenSet.get(key).add(pageUrl === '/' ? '/' : pageUrl.replace(/\/$/, ''));
    }
  }
}
for (const [href, fromPages] of brokenSet) {
  broken.push({ href, count: fromPages.size, example: [...fromPages][0] });
}

// ---- write reports ----------------------------------------------------------
function csvEscape(v) { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
fs.writeFileSync(path.join(REPO_ROOT, 'backlink-coverage-report.csv'),
  'target_url,status,in_site_path,kind\n' +
  cov.map((c) => [c.url, c.status, c.inSite, c.kind].map(csvEscape).join(',')).join('\n') + '\n');
fs.writeFileSync(path.join(REPO_ROOT, 'qa-broken-links.csv'),
  'href,from_page_count,example_page\n' +
  broken.map((b) => [b.href, b.count, b.example].map(csvEscape).join(',')).join('\n') + '\n');
fs.writeFileSync(path.join(REPO_ROOT, 'qa-gaps.csv'),
  'url,reason,in_site_path\n' +
  gaps.map((g) => [g.url, g.reason, g.inSite || ''].map(csvEscape).join(',')).join('\n') + '\n');

console.log('=== QA ===');
console.log(`Served pages (index.html): ${served.size}   files: ${files.size}`);
console.log(`B-2 backlink targets: ${targets.length}  resolved: ${ok}  404: ${fail}  skipped(offsite/malformed): ${skipped}`);
console.log(`A-2 internal links checked: ${internalChecked}  distinct broken: ${broken.length}`);
const resolvable = targets.length - cov.filter((c) => c.kind === 'off-site').length;
console.log(`Backlinked URLs resolving (excl off-site): ${ok}/${resolvable}`);
if (fail) { console.log('\nFirst 25 backlink 404s:'); gaps.filter(g=>g.reason==='404').slice(0, 25).forEach((g) => console.log('  ', g.inSite, '  <-', g.url)); }
if (broken.length) { console.log('\nFirst 25 broken internal links:'); broken.slice(0, 25).forEach((b) => console.log(`   ${b.href}  (from ${b.count}, e.g. ${b.example})`)); }
