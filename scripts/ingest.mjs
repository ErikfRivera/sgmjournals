#!/usr/bin/env node
// Main ingest pipeline: walk the prioritized manifest, rebuild each page from
// its recovered archive file, emit JSON the Astro routes consume, copy assets
// & PDFs, accumulate the variant->canonical redirect map, and track progress.
//
// Usage:
//   node scripts/ingest.mjs                 # process whole manifest (resumable)
//   node scripts/ingest.mjs --limit 50      # only first N manifest rows
//   node scripts/ingest.mjs --types journal-home,article-full
//   node scripts/ingest.mjs --reset         # ignore progress.json, rebuild all
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './lib/csv.mjs';
import { lookupLoose, readHtml, copyAsset, fileForRow, decodeArchive } from './lib/db.mjs';
import { extractArticle, extractInfoPage, extractJournalIntro } from './lib/extract.mjs';
import {
  MANIFEST_CSV, DATA_DIR, PUBLIC_DIR, PROGRESS_JSON, REDIRECTS_FILE, UNBUILT_CSV,
  urlToSlug, hostToJournal, resolveArchiveFile,
} from './lib/paths.mjs';

const args = process.argv.slice(2);
const getArg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit'), 10) : Infinity;
const TYPES = getArg('--types') ? new Set(getArg('--types').split(',')) : null;
const RESET = args.includes('--reset');

const PAGES_DIR = path.join(DATA_DIR, 'pages');
fs.mkdirSync(PAGES_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// ---- progress -------------------------------------------------------------
let progress = { built: {}, redirects: {}, pmidIndex: {}, stats: {} };
if (!RESET && fs.existsSync(PROGRESS_JSON)) {
  try { progress = JSON.parse(fs.readFileSync(PROGRESS_JSON, 'utf-8')); } catch {}
}
progress.built ||= {}; progress.redirects ||= {}; progress.pmidIndex ||= {}; progress.stats ||= {};

function saveProgress() {
  fs.writeFileSync(PROGRESS_JSON, JSON.stringify(progress, null, 2));
}

// ---- helpers --------------------------------------------------------------
function writeEntry(slug, entry) {
  const safe = slug === '' ? '__root' : slug;
  const file = path.join(PAGES_DIR, `${safe}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(entry));
}

const unbuilt = [];
function recordUnbuilt(row, reason) {
  unbuilt.push({ url: row.canonical_www_url, type: row.page_type, reason });
}

// Add a variant old-URL -> canonical mapping. We store the path portion only;
// the Cloudflare host redirect already prefixed the journal, so variants are
// recorded as the in-site path the variant would land on.
function addRedirect(fromPath, toPath) {
  if (!fromPath || !toPath || fromPath === toPath) return;
  progress.redirects[fromPath] = toPath;
}

// Derive in-site variant paths for an article from its canonical slug.
function articleVariants(slug) {
  // slug like mic/content/150/11/3527  -> base
  const base = '/' + slug;
  const m = slug.match(/^([a-z]+)\/content\/(.+)$/);
  const variants = [];
  if (m) {
    const journal = m[1];
    const rest = m[2]; // 150/11/3527
    const v = (s) => `/${journal}/content/${s}`;
    variants.push(
      v(`${rest}.full`), v(`${rest}.abstract`), v(`${rest}.short`), v(`${rest}.long`),
      v(`${rest}.full.pdf+html`),
      `/${journal}/cgi/content/full/${rest}`,
      `/${journal}/cgi/content/abstract/${rest}`,
      `/${journal}/cgi/content/short/${rest}`,
      `/${journal}/cgi/content/long/${rest}`,
      `/${journal}/cgi/reprint/${rest}`,
    );
  }
  return variants.map((from) => [from, base]);
}

// ---- per-type processors --------------------------------------------------
function processArticle(row, slug) {
  const host = row.archive_host;
  const requestUri = row.archive_request_uri || '/';
  const html = (() => {
    const abs = resolveArchiveFile(row.archive_file);
    if (abs && fs.existsSync(abs)) return decodeArchive(fs.readFileSync(abs), (lookupLoose(host, requestUri)||{}).charset);
    const r = lookupLoose(host, requestUri);
    return r ? readHtml(r) : null;
  })();
  if (!html) { recordUnbuilt(row, 'source-file-missing'); return false; }

  const journal = slug.split('/')[0];
  const ctx = { host, requestUri, journal };
  const ex = extractArticle(html, ctx);

  // PDF copy
  let pdfPath = null;
  if (ex.pdf && ex.pdf.row) {
    const wp = copyAsset(ex.pdf.row, journal);
    if (wp) { pdfPath = wp; }
  }

  // index pmid -> canonical for pmidlookup resolution later
  if (ex.meta.pmid) progress.pmidIndex[ex.meta.pmid] = '/' + slug;

  const entry = {
    type: 'article',
    slug,
    journal,
    canonical: `https://www.sgmjournals.org/${slug}`,
    meta: ex.meta,
    abstractHtml: ex.abstractHtml,
    bodyHtml: ex.bodyHtml,
    referencesHtml: ex.referencesHtml,
    affiliationsHtml: ex.affiliationsHtml,
    correspHtml: ex.correspHtml,
    pdfPath,
    refdomains: Number(row.rank_refdomains) || 0,
  };
  writeEntry(slug, entry);

  // redirects: every recovered variant -> canonical
  for (const [from, to] of articleVariants(slug)) addRedirect(from, to);
  if (pdfPath) {
    // keep the pdf reachable at the canonical .full.pdf path too (handled as asset)
  }
  return true;
}

function processJournalHome(row, slug) {
  // Normalize journal via the host (jgv->vir, ijsb->ijs, portal->root) so alias
  // home pages don't create duplicate journal landings.
  const host = row.archive_host;
  const requestUri = row.archive_request_uri || '/';
  const normJournal = hostToJournal(host);
  const origSlug = slug;
  if (!normJournal) {
    // portal home (sgmjournals/www/intl) -> site root (index.astro)
    if (origSlug) addRedirect('/' + origSlug, '/');
    addRedirect('/' + origSlug + '/', '/');
    return true; // root is rendered by index.astro
  }
  if (normJournal !== origSlug) {
    // alias home (e.g. jgv -> vir): redirect to the canonical journal landing.
    addRedirect('/' + origSlug, '/' + normJournal + '/');
    addRedirect('/' + origSlug + '/', '/' + normJournal + '/');
    // don't overwrite an already-built canonical journal home with alias content
    if (fs.existsSync(path.join(PAGES_DIR, `${normJournal}.json`))) return true;
  }
  slug = normJournal;
  const journal = normJournal;
  const html = (() => {
    const abs = resolveArchiveFile(row.archive_file);
    if (abs && fs.existsSync(abs)) return decodeArchive(fs.readFileSync(abs), (lookupLoose(host, requestUri)||{}).charset);
    const r = lookupLoose(host, requestUri);
    return r ? readHtml(r) : null;
  })();
  let intro = '';
  if (html) {
    intro = extractJournalIntro(html, { host, requestUri, journal });
  }
  const entry = {
    type: 'journal-home',
    slug,
    journal,
    canonical: `https://www.sgmjournals.org/${slug}`,
    introHtml: intro && intro.length < 6000 ? intro : '',
  };
  writeEntry(slug, entry);
  return true;
}

function processInfoPage(row, slug) {
  const host = row.archive_host;
  const requestUri = row.archive_request_uri || '/';
  const journal = slug.split('/')[0];
  const html = (() => {
    const abs = resolveArchiveFile(row.archive_file);
    if (abs && fs.existsSync(abs)) return decodeArchive(fs.readFileSync(abs), (lookupLoose(host, requestUri)||{}).charset);
    const r = lookupLoose(host, requestUri);
    return r ? readHtml(r) : null;
  })();
  if (!html) { recordUnbuilt(row, 'source-file-missing'); return false; }
  const info = extractInfoPage(html, { host, requestUri, journal });
  // login wall / empty capture -> honest title from the URL, no fabricated body
  let title = info.title, bodyHtml = info.bodyHtml, stub = false;
  if (info.isLogin || !bodyHtml) {
    const seg = (requestUri.split('/').filter(Boolean).pop() || 'Information').replace(/\.(s?html|dtl|xhtml)$/i, '').replace(/[._-]+/g, ' ').trim();
    title = seg.charAt(0).toUpperCase() + seg.slice(1);
    bodyHtml = '';
    stub = true;
  }
  const entry = {
    type: 'info-page',
    slug,
    journal,
    canonical: `https://www.sgmjournals.org/${slug}`,
    title,
    bodyHtml,
    ...(stub ? { stub: true } : {}),
  };
  writeEntry(slug, entry);
  return true;
}

// ---- main loop ------------------------------------------------------------
const rows = parseCsv(MANIFEST_CSV);
console.log(`Manifest rows: ${rows.length}`);

let processed = 0, built = 0, skipped = 0, failed = 0;
const typeCounts = {};

for (const row of rows) {
  if (processed >= LIMIT) break;
  const type = row.page_type;
  if (TYPES && !TYPES.has(type)) continue;
  processed++;

  const canonical = row.canonical_www_url;
  if (!canonical || !/^https?:\/\//.test(canonical)) { continue; }
  let slug = urlToSlug(canonical);

  // Enforce the canonical journal mapping on the URL itself (jgv->vir, ijsb->ijs).
  if (type !== 'journal-home') {
    const norm = slug.replace(/^jgv(\/|$)/, 'vir$1').replace(/^ijsb(\/|$)/, 'ijs$1');
    if (norm !== slug) {
      addRedirect('/' + slug, '/' + norm);
      slug = norm;
    }
  }

  // Strip any query string / fragment that leaked into the path (e.g. a
  // "?ck=nck" cache-buster). A "?" in a filesystem path also breaks Astro's
  // URL-based empty-dir cleanup, so this must never reach the output.
  {
    const stripped = slug.replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (stripped !== slug) { addRedirect('/' + slug, '/' + stripped); slug = stripped; }
  }

  // Some backlink target URLs carry junk (e.g. ".../463}}[]" from broken
  // referrers). Don't mint a page for those — redirect the junk to the clean
  // path (which its own manifest row builds) and skip.
  let decoded = slug; try { decoded = decodeURIComponent(slug); } catch {}
  if (!/^[A-Za-z0-9._~+/-]+$/.test(decoded)) {
    const clean = decoded.replace(/[^A-Za-z0-9._~+/-].*$/, '').replace(/\/+$/, '');
    if (clean && clean !== slug) addRedirect('/' + slug, '/' + clean);
    recordUnbuilt(row, 'malformed-url');
    continue;
  }

  // resumability
  if (progress.built[slug] && !RESET) { skipped++; continue; }

  // pmidlookup handled in a later phase
  if (type === 'redirect-pmidlookup') { recordUnbuilt(row, 'pmidlookup-deferred'); continue; }
  if (row.in_archive !== 'yes') { recordUnbuilt(row, 'not-in-archive'); continue; }

  let ok = false;
  try {
    if (type === 'journal-home') ok = processJournalHome(row, slug);
    else if (type.startsWith('article')) ok = processArticle(row, slug);
    else ok = processInfoPage(row, slug); // info-page, subscriptions, toc/issue, other
  } catch (e) {
    console.error(`ERROR ${slug}: ${e.message}`);
    recordUnbuilt(row, 'extract-error:' + e.message);
  }

  if (ok) {
    progress.built[slug] = { type, ts: Date.now() };
    built++;
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  } else failed++;

  if (built % 50 === 0 && built > 0) saveProgress();
}

// ---- write redirects ------------------------------------------------------
function writeRedirects() {
  const lines = ['# Generated by scripts/ingest.mjs — variant -> canonical (in-site).', '# Cloudflare host-level subdomain->www prefix redirects are configured separately.'];
  const entries = Object.entries(progress.redirects).sort();
  for (const [from, to] of entries) lines.push(`${from} ${to} 301`);
  fs.writeFileSync(REDIRECTS_FILE, lines.join('\n') + '\n');
  return entries.length;
}

function writeUnbuilt() {
  const header = 'url,type,reason';
  const lines = unbuilt.map((u) => `${JSON.stringify(u.url)},${u.type},${u.reason}`);
  fs.writeFileSync(UNBUILT_CSV, [header, ...lines].join('\n') + '\n');
}

progress.stats = { ...progress.stats, lastRun: Date.now(), builtTotal: Object.keys(progress.built).length, typeCounts };
saveProgress();
const redirCount = writeRedirects();
writeUnbuilt();

console.log(`\nProcessed: ${processed}  Built: ${built}  Skipped(existing): ${skipped}  Failed/Deferred: ${failed}`);
console.log(`By type:`, typeCounts);
console.log(`Redirects: ${redirCount}  Unbuilt recorded: ${unbuilt.length}`);
console.log(`Total built (all runs): ${Object.keys(progress.built).length}`);
