#!/usr/bin/env node
// Recreate a real page at EVERY URL that appears as a backlink target in the
// Ahrefs export (after the Cloudflare host -> /<journal>/ rewrite). No redirects:
// each recreated page renders the canonical's content with rel=canonical -> the
// clean URL. Guarantees the canonical it points to also exists.
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

const csvName = fs.readdirSync(INPUT_ROOT).find((f) => /backlinks-subdomains.*\.csv$/i.test(f));
if (!csvName) { console.error('Backlinks CSV not found in', INPUT_ROOT); process.exit(1); }
const rows = parseCsv(path.join(INPUT_ROOT, csvName), { delimiter: '\t', encoding: 'utf16le' });
const targets = new Set();
for (const r of rows) { const u = r['Target URL']; if (u && /^https?:\/\//.test(u)) targets.add(u); }
console.log(`Distinct backlink target URLs: ${targets.size}`);

// Only reject characters that break the static build / URL parsing. Junk like
// [] {} | and trailing spaces (from broken referrers) is allowed so the exact
// inbound URL still resolves to a real page.
// A slug may only contain these chars to be built into a real page; any other
// char (space, []{}()|:?# etc. from corrupt referrer URLs) would crash Astro's
// empty-dir cleanup. For those we guarantee the clean canonical exists and let
// middleware.js normalize the junk URL to it.
const SAFE = /^[A-Za-z0-9._~+/-]+$/;
const stripVar = (s) => s.replace(/\.(full\.pdf\+html|full\.pdf|full|abstract|short|long|pdf)$/i, '').replace(/\/+$/, '');
const cutJunk = (s) => s.replace(/[^A-Za-z0-9._~+/-].*$/, ''); // drop trailing referrer junk

function slugFromUrl(host, pathname) {
  const journal = hostToJournal(host);
  let p = pathname.replace(/[?#].*$/, '');
  let slug = (journal ? `/${journal}` : '') + p;
  return slug.replace(/^\/+/, '').replace(/\/+$/, '');
}

// Derive the clean canonical slug for an article-ish path ('' if not article).
function canonicalSlug(journal, pathname) {
  let p = cutJunk(pathname);
  let m;
  if ((m = p.match(/^\/cgi\/content\/(?:full|abstract|short|long)\/(.+)$/))) return `${journal}/content/${stripVar(m[1])}`;
  if ((m = p.match(/^\/cgi\/reprintframed?\/(.+)$/))) return `${journal}/content/${stripVar(m[1])}`;
  if ((m = p.match(/^\/cgi\/reprint\/(.+)$/))) return `${journal}/content/${stripVar(m[1])}`;
  if ((m = p.match(/^\/cgi\/doi\/[^/]+\/(.+)$/))) return `${journal}/content/${stripVar(m[1])}`;
  if ((m = p.match(/^\/content\/(.+)$/))) return `${journal}/content/${stripVar(m[1])}`;
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
function exists(slug) { return !!prog.built[slug] || fs.existsSync(path.join(PAGES_DIR, `${slug}.json`)); }

// Build a canonical article entry from the archive (try richest variant first).
function buildArticleFromArchive(host, journal, canonSlug) {
  const rest = canonSlug.replace(/^[a-z]+\/content\//, '');
  for (const suffix of ['.full', '', '.abstract', '.long', '.short']) {
    const uri = `/content/${rest}${suffix}`;
    const row = lookupLoose(host, uri);
    const html = row ? readHtml(row) : null;
    if (!html) continue;
    const ex = extractArticle(html, { host, requestUri: uri, journal });
    const t = ex.meta && ex.meta.title;
    if (t && /sign[\s-]?in|log[\s-]?in|access denied|page not found|institutional access/i.test(t)) continue; // login wall
    if (ex.bodyHtml || ex.abstractHtml || t) {
      let pdfPath = null;
      if (ex.pdf && ex.pdf.row) { const wp = copyAsset(ex.pdf.row, journal); if (wp) pdfPath = wp; }
      if (ex.meta && ex.meta.pmid) { prog.pmidIndex ||= {}; prog.pmidIndex[ex.meta.pmid] = '/' + canonSlug; }
      const entry = {
        type: 'article', slug: canonSlug, journal,
        canonical: `https://www.sgmjournals.org/${canonSlug}`,
        meta: ex.meta, abstractHtml: ex.abstractHtml, bodyHtml: ex.bodyHtml,
        referencesHtml: ex.referencesHtml, affiliationsHtml: ex.affiliationsHtml,
        correspHtml: ex.correspHtml, pdfPath, refdomains: 0,
      };
      writeEntry(canonSlug, entry);
      prog.built[canonSlug] = { type: 'article-archive', ts: 0 };
      return entry;
    }
  }
  return null;
}

function citationStub(journal, canonSlug) {
  const j = getJournal(journal);
  const cm = canonSlug.match(/^[a-z]+\/content\/(.+)$/);
  const vip = cm ? cm[1].split('/') : [];
  const entry = {
    type: 'article', slug: canonSlug, journal,
    canonical: `https://www.sgmjournals.org/${canonSlug}`, stub: true,
    meta: {
      title: (j ? j.name : journal) + (vip.length === 3 ? ` ${vip[0]}(${vip[1]}):${vip[2]}` : ''),
      authors: [], journalTitle: j ? j.name : journal,
      volume: vip[0] || '', issue: vip[1] || '', firstpage: vip[2] || '', issn: j ? [j.issn] : [],
    },
    abstractHtml: '', bodyHtml: '', referencesHtml: '', affiliationsHtml: '', correspHtml: '',
    pdfPath: null, refdomains: 0,
  };
  writeEntry(canonSlug, entry);
  prog.built[canonSlug] = { type: 'article-stub', ts: 0 };
  return entry;
}

let aliasArticles = 0, canonBuilt = 0, canonStubs = 0, pdfCopies = 0, infoBuilt = 0, infoStubs = 0, skipped = 0, malformed = 0, malformedNormalized = 0;

for (const url of targets) {
  let u;
  try { u = new URL(url); } catch { malformed++; continue; }
  const host = u.hostname;
  if (!/sgmjournals\.org$/i.test(host)) { skipped++; continue; }
  let pathname;
  try { pathname = decodeURIComponent(u.pathname); } catch { pathname = u.pathname; }
  if (/\/cgi\/pmidlookup/i.test(pathname)) { skipped++; continue; } // resolver page handles these
  if (pathname === '/' || pathname === '') {
    const j0 = hostToJournal(host);
    if (!j0 || exists(j0)) { skipped++; continue; } // portal/root or built journal home
    // a backlinked home for a journal outside the rebuilt portfolio (e.g. mgen)
    const EXTRA = { mgen: 'Microbial Genomics' };
    const name = EXTRA[j0] || j0;
    writeEntry(j0, {
      type: 'info-page', slug: j0, journal: j0, canonical: `https://www.sgmjournals.org/${j0}`,
      title: name, alias: true,
      bodyHtml: `<p>${name} is a journal of the Society for General Microbiology (now the Microbiology Society). This site is an archival rebuild of the Society's legacy research journals; ${name} content is not part of this archive. For ${name}, please refer to the Microbiology Society's current site.</p>`,
    });
    prog.built[j0] = { type: 'info-alias', ts: 0 };
    infoBuilt++; continue;
  }

  const journal = hostToJournal(host);
  const slug = slugFromUrl(host, pathname);
  if (!slug) { malformed++; continue; }

  const isPdf = /\.pdf$/i.test(pathname) && !/\+html$/i.test(pathname);
  const canonSlug = journal ? canonicalSlug(journal, pathname) : '';

  // Corrupt referrer URL: don't build a hostile page; just guarantee the clean
  // canonical exists so middleware.js can normalize the junk URL to a 200.
  if (!SAFE.test(slug)) {
    if (canonSlug) {
      let canon = readEntry(canonSlug);
      if (!canon) { canon = buildArticleFromArchive(host, journal, canonSlug); if (canon) canonBuilt++; }
      if (!canon) { citationStub(journal, canonSlug); canonStubs++; }
    }
    malformedNormalized++; continue;
  }

  // ---- PDF target: serve the real PDF if recovered -----------------------
  if (isPdf && !exists(slug) && !fs.existsSync(path.join(PUBLIC_DIR, slug))) {
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
    // no real PDF -> fall through to HTML alias of the article
  }

  // ---- article variant ---------------------------------------------------
  if (canonSlug) {
    const canonUrl = `https://www.sgmjournals.org/${canonSlug}`;
    // ensure the canonical exists (build from archive, else citation stub)
    let canon = readEntry(canonSlug);
    if (!canon) { canon = buildArticleFromArchive(host, journal, canonSlug); if (canon) canonBuilt++; }
    if (!canon) { canon = citationStub(journal, canonSlug); canonStubs++; }
    if (slug !== canonSlug && !exists(slug)) {
      writeEntry(slug, { ...canon, slug, canonical: canonUrl, alias: true });
      prog.built[slug] = { type: 'article-alias', ts: 0 };
      aliasArticles++;
    } else { skipped++; }
    continue;
  }

  // ---- non-article (info / toc / misc) -----------------------------------
  if (exists(slug)) { skipped++; continue; }
  const row = lookupLoose(host, pathname);
  const html = row ? readHtml(row) : null;
  if (html && row.mimetype && /html/.test(row.mimetype)) {
    const info = extractInfoPage(html, { host, requestUri: pathname, journal });
    if (info.bodyHtml && info.bodyHtml.length > 40) {
      writeEntry(slug, { type: 'info-page', slug, journal, canonical: `https://www.sgmjournals.org/${slug}`, title: info.title, bodyHtml: info.bodyHtml, alias: true });
      prog.built[slug] = { type: 'info-alias', ts: 0 };
      infoBuilt++; continue;
    }
  }
  const title = (pathname.split('/').filter(Boolean).pop() || 'Page').replace(/\.(s?html|dtl|xhtml)$/i, '').replace(/[._-]+/g, ' ').trim();
  writeEntry(slug, { type: 'info-page', slug, journal, canonical: `https://www.sgmjournals.org/${slug}`, title: title.charAt(0).toUpperCase() + title.slice(1), bodyHtml: '', alias: true, stub: true });
  prog.built[slug] = { type: 'info-alias-stub', ts: 0 };
  infoStubs++;
}

fs.writeFileSync(PROGRESS_JSON, JSON.stringify(prog, null, 2));
console.log(`\nRecreated pages from backlink targets:`);
console.log(`  article aliases:            ${aliasArticles}`);
console.log(`  canonicals built (archive): ${canonBuilt}`);
console.log(`  canonical citation stubs:   ${canonStubs}`);
console.log(`  PDF files served:           ${pdfCopies}`);
console.log(`  info pages rebuilt:         ${infoBuilt}`);
console.log(`  info minimal stubs:         ${infoStubs}`);
console.log(`  malformed normalized (canon ensured): ${malformedNormalized}`);
console.log(`  skipped (exist/home/pmid):  ${skipped}`);
console.log(`  malformed/off-site:         ${malformed}`);
console.log(`Total built: ${Object.keys(prog.built).length}`);
