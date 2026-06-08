#!/usr/bin/env node
// Recreate a real page at EVERY URL that appears as a backlink target in the
// Ahrefs export (after the Cloudflare host -> /<journal>/ rewrite), instead of
// redirecting variants to the canonical. Each recreated page renders the same
// content as its canonical and carries rel=canonical -> the clean URL.
//
//   node scripts/aliases.mjs
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './lib/csv.mjs';
import { lookupLoose, readHtml, copyAsset, fileForRow } from './lib/db.mjs';
import { extractArticle, extractInfoPage } from './lib/extract.mjs';
import { DATA_DIR, PUBLIC_DIR, PROGRESS_JSON, INPUT_ROOT, hostToJournal } from './lib/paths.mjs';
import { getJournal } from '../src/lib/journals.js';

const PAGES_DIR = path.join(DATA_DIR, 'pages');
const prog = JSON.parse(fs.readFileSync(PROGRESS_JSON, 'utf-8'));
prog.built ||= {};

// Locate the Ahrefs backlinks export in the cowork input dir.
const csvName = fs.readdirSync(INPUT_ROOT).find((f) => /backlinks-subdomains.*\.csv$/i.test(f));
if (!csvName) { console.error('Backlinks CSV not found in', INPUT_ROOT); process.exit(1); }
const rows = parseCsv(path.join(INPUT_ROOT, csvName), { delimiter: '\t', encoding: 'utf16le' });
const targets = new Set();
for (const r of rows) { const u = r['Target URL']; if (u && /^https?:\/\//.test(u)) targets.add(u); }
console.log(`Distinct backlink target URLs: ${targets.size}`);

const SANITIZE = /[{}\[\]<>"'\s|\\^`%?#]/;
const stripVar = (s) => s.replace(/\.(full\.pdf\+html|full\.pdf|full|abstract|short|long|pdf)$/i, '').replace(/\/+$/, '');

function toSlug(host, pathname) {
  const journal = hostToJournal(host);
  let p = pathname.replace(/[?#].*$/, '');
  let slug = (journal ? `/${journal}` : '') + p;
  slug = slug.replace(/^\/+/, '').replace(/\/+$/, '');
  return slug;
}

// Derive the canonical (clean) slug for an article variant; '' if not an article.
function canonicalOf(journal, p) {
  let m;
  if ((m = p.match(/^\/cgi\/content\/(?:full|abstract|short|long)\/(.+)$/))) return `${journal}/content/${stripVar(m[1])}`;
  if ((m = p.match(/^\/cgi\/reprintframed?\/(.+)$/))) return `${journal}/content/${stripVar(m[1])}`;
  if ((m = p.match(/^\/cgi\/reprint\/(.+)$/))) return `${journal}/content/${stripVar(m[1])}`;
  if ((m = p.match(/^\/content\/(.+)$/))) {
    const clean = stripVar(m[1]);
    // only treat as an article if it looks like V/I/P or a DOI-style id
    if (/^[^/]+\/[^/]+\/[^/]+$/.test(clean) || /^[a-z]+\.[0-9]/i.test(clean)) return `${journal}/content/${clean}`;
  }
  return '';
}

function readEntry(slug) {
  const f = path.join(PAGES_DIR, `${slug}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return null; }
}
function writeEntry(slug, entry) {
  const f = path.join(PAGES_DIR, `${slug}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(entry));
}
function pageExists(slug) {
  return !!prog.built[slug] || fs.existsSync(path.join(PAGES_DIR, `${slug}.json`));
}

let aliasArticles = 0, aliasStubs = 0, pdfCopies = 0, infoBuilt = 0, infoStubs = 0, skipped = 0, malformed = 0;

for (const url of targets) {
  let u;
  try { u = new URL(url); } catch { malformed++; continue; }
  const host = u.hostname;
  if (!/sgmjournals\.org$/i.test(host)) { skipped++; continue; }
  const pathname = decodeURIComponent(u.pathname);
  if (/\/cgi\/pmidlookup/i.test(pathname)) { skipped++; continue; } // resolver page handles these
  if (pathname === '/' || pathname === '') { skipped++; continue; }   // home/journal-home exist

  const journal = hostToJournal(host);
  const slug = toSlug(host, pathname);
  if (!slug || SANITIZE.test(slug)) { malformed++; continue; }

  const isPdf = /\.pdf$/i.test(pathname) && !/\+html$/i.test(pathname);
  if (pageExists(slug)) { skipped++; continue; }
  if (isPdf && fs.existsSync(path.join(PUBLIC_DIR, slug))) { skipped++; continue; }

  const canonSlug = journal ? canonicalOf(journal, pathname.replace(/[?#].*$/, '')) : '';

  // ---- PDF target: serve the real PDF if recovered -----------------------
  if (isPdf) {
    const row = lookupLoose(host, pathname);
    if (row && row.mimetype === 'application/pdf') {
      const src = fileForRow(row);
      if (src && fs.existsSync(src)) {
        const dest = path.join(PUBLIC_DIR, slug);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
        prog.built[slug] = { type: 'pdf-alias', ts: 0 };
        pdfCopies++; continue;
      }
    }
    // no real PDF — fall through to an HTML alias of the article
  }

  // ---- article variant: alias to canonical content -----------------------
  if (canonSlug) {
    const canon = readEntry(canonSlug);
    const canonUrl = `https://www.sgmjournals.org/${canonSlug}`;
    if (canon) {
      writeEntry(slug, { ...canon, slug, canonical: canonUrl, alias: true });
      prog.built[slug] = { type: 'article-alias', ts: 0 };
      aliasArticles++; continue;
    }
    // canonical not built — try to build the variant directly from the archive
    const row = lookupLoose(host, pathname);
    const html = row ? readHtml(row) : null;
    if (html) {
      const ex = extractArticle(html, { host, requestUri: pathname, journal });
      if (ex.bodyHtml || ex.abstractHtml || (ex.meta && ex.meta.title)) {
        let pdfPath = null;
        if (ex.pdf && ex.pdf.row) { const wp = copyAsset(ex.pdf.row, journal); if (wp) pdfPath = wp; }
        writeEntry(slug, {
          type: 'article', slug, journal, canonical: canonUrl, alias: true,
          meta: ex.meta, abstractHtml: ex.abstractHtml, bodyHtml: ex.bodyHtml,
          referencesHtml: ex.referencesHtml, affiliationsHtml: ex.affiliationsHtml,
          correspHtml: ex.correspHtml, pdfPath, refdomains: 0,
        });
        prog.built[slug] = { type: 'article-alias', ts: 0 };
        aliasArticles++; continue;
      }
    }
    // nothing recoverable — citation-only stub from the URL
    const cm = canonSlug.match(/^([a-z]+)\/content\/(.+)$/);
    const j = getJournal(journal);
    const vip = cm ? cm[2].split('/') : [];
    writeEntry(slug, {
      type: 'article', slug, journal, canonical: canonUrl, alias: true, stub: true,
      meta: {
        title: (j ? j.name : journal) + (vip.length === 3 ? ` ${vip[0]}(${vip[1]}):${vip[2]}` : ''),
        authors: [], journalTitle: j ? j.name : journal,
        volume: vip[0] || '', issue: vip[1] || '', firstpage: vip[2] || '', issn: j ? [j.issn] : [],
      },
      abstractHtml: '', bodyHtml: '', referencesHtml: '', affiliationsHtml: '', correspHtml: '',
      pdfPath: null, refdomains: 0,
    });
    prog.built[slug] = { type: 'article-alias-stub', ts: 0 };
    aliasStubs++; continue;
  }

  // ---- non-article page (info / toc / misc): recreate from the archive ----
  const row = lookupLoose(host, pathname);
  const html = row ? readHtml(row) : null;
  if (html && row.mimetype && /html/.test(row.mimetype)) {
    const info = extractInfoPage(html, { host, requestUri: pathname, journal });
    if (info.bodyHtml && info.bodyHtml.length > 40) {
      writeEntry(slug, {
        type: 'info-page', slug, journal, canonical: `https://www.sgmjournals.org/${slug}`,
        title: info.title, bodyHtml: info.bodyHtml, alias: true,
      });
      prog.built[slug] = { type: 'info-alias', ts: 0 };
      infoBuilt++; continue;
    }
  }
  // last resort — minimal page so the backlink still 200s
  const title = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || 'Page').replace(/[._-]+/g, ' ').replace(/\.(s?html|dtl)$/i, '').trim();
  writeEntry(slug, {
    type: 'info-page', slug, journal, canonical: `https://www.sgmjournals.org/${slug}`,
    title: title.charAt(0).toUpperCase() + title.slice(1), bodyHtml: '', alias: true, stub: true,
  });
  prog.built[slug] = { type: 'info-alias-stub', ts: 0 };
  infoStubs++;
}

fs.writeFileSync(PROGRESS_JSON, JSON.stringify(prog, null, 2));
console.log(`\nRecreated pages from backlink targets:`);
console.log(`  article aliases (full content): ${aliasArticles}`);
console.log(`  article alias stubs (citation):  ${aliasStubs}`);
console.log(`  PDF files served:                ${pdfCopies}`);
console.log(`  info/misc pages rebuilt:         ${infoBuilt}`);
console.log(`  info/misc minimal stubs:         ${infoStubs}`);
console.log(`  skipped (already exist / home / pmidlookup): ${skipped}`);
console.log(`  malformed/off-site skipped:      ${malformed}`);
console.log(`Total built: ${Object.keys(prog.built).length}`);
