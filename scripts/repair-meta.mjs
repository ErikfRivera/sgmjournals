#!/usr/bin/env node
// Repair article pages whose chosen archive variant was a HighWire login wall
// ("Sign In" title, no citation_*). HighWire often walled full text but served
// the abstract freely, so re-extract metadata (and abstract/body) from the best
// non-walled variant. Fixes canonicals first, then propagates to their aliases.
import fs from 'node:fs';
import path from 'node:path';
import { lookupLoose, readHtml, copyAsset } from './lib/db.mjs';
import { extractArticle, extractMeta } from './lib/extract.mjs';
import { DATA_DIR } from './lib/paths.mjs';
import { getJournal } from '../src/lib/journals.js';

const NO_NET = process.argv.includes('--no-net');
async function crossref(doi) {
  if (NO_NET) return null;
  try {
    const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { 'User-Agent': 'sgmjournals-archive-QA/1.0 (mailto:erik@one.pet)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const m = j.message || {};
    const title = Array.isArray(m.title) ? m.title[0] : m.title;
    if (!title) return null;
    const authors = (m.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean);
    const date = (m.published?.['date-parts']?.[0] || m['published-print']?.['date-parts']?.[0] || [])[0];
    return { title, authors, date: date ? String(date) : '' };
  } catch { return null; }
}

const PAGES_DIR = path.join(DATA_DIR, 'pages');
const LOGIN = /sign[\s-]?in|log[\s-]?in|access denied|page not found|institutional access|subscribe to|please choose/i;
const HOSTS = {
  vir: ['vir', 'jgv', 'intl-vir'], mic: ['mic', 'intl-mic'],
  ijs: ['ijs', 'ijsb', 'intl-ijs'], jmm: ['jmm', 'intl-jmm'], jmmcr: ['jmmcr'],
};
const isLogin = (e) => e.type === 'article' && !e.stub && (!e.meta || !e.meta.title || LOGIN.test(e.meta.title));

function bestExtract(journal, canonSlug) {
  const rest = canonSlug.replace(new RegExp(`^${journal}/content/`), '');
  const hosts = (HOSTS[journal] || [journal]).map((h) => `${h}.sgmjournals.org`);
  for (const suffix of ['.full', '', '.long', '.short', '.abstract']) {
    for (const host of hosts) {
      const uri = `/content/${rest}${suffix}`;
      const row = lookupLoose(host, uri);
      const html = row ? readHtml(row) : null;
      if (!html) continue;
      const meta = extractMeta(html);
      if (meta.title && !LOGIN.test(meta.title) && (meta.doi || meta.authors.length || meta.volume)) {
        return { ex: extractArticle(html, { host, requestUri: uri, journal }), host };
      }
    }
  }
  return null;
}

function* walk(dir) { for (const n of fs.readdirSync(dir)) { const a = path.join(dir, n); const s = fs.statSync(a); if (s.isDirectory()) yield* walk(a); else if (n.endsWith('.json')) yield a; } }

// Pass 1: fix canonical (non-alias) login-wall articles
let fixed = 0, stillLogin = 0, crossrefHits = 0;
const repaired = new Map(); // canonSlug -> fixed fields
for (const f of walk(PAGES_DIR)) {
  const e = JSON.parse(fs.readFileSync(f, 'utf-8'));
  if (e.alias || !isLogin(e)) continue;
  const r = bestExtract(e.journal, e.slug);
  if (!r) {
    // No non-walled variant in the archive -> honest citation page (no "Sign In",
    // no fabricated body). Enrich the title via CrossRef when a DOI is constructible.
    const j = getJournal(e.journal);
    const m = e.slug.match(/^[a-z]+\/content\/(.+)$/);
    const rest = m ? m[1] : '';
    const vip = rest.split('/');
    let title = (j ? j.name : e.journal) + (vip.length === 3 ? ` ${vip[0]}(${vip[1]}):${vip[2]}` : '');
    let authors = [], doi = '', date = '';
    if (/^[a-z]+\.[0-9]/.test(rest)) {
      doi = `10.1099/${rest}`;
      const cr = await crossref(doi);
      if (cr) { title = cr.title; authors = cr.authors; date = cr.date; crossrefHits++; }
    }
    Object.assign(e, {
      stub: true,
      meta: { title, authors, journalTitle: j ? j.name : e.journal, volume: vip[0] || '', issue: vip[1] || '', firstpage: vip[2] || '', doi, date, issn: j ? [j.issn] : [] },
      abstractHtml: '', bodyHtml: '', referencesHtml: '', affiliationsHtml: '', correspHtml: '', pdfPath: null,
    });
    fs.writeFileSync(f, JSON.stringify(e));
    repaired.set(e.slug, e);
    stillLogin++; continue;
  }
  const ex = r.ex;
  let pdfPath = e.pdfPath;
  if (!pdfPath && ex.pdf && ex.pdf.row) { const wp = copyAsset(ex.pdf.row, e.journal); if (wp) pdfPath = wp; }
  Object.assign(e, {
    meta: ex.meta, abstractHtml: ex.abstractHtml, bodyHtml: ex.bodyHtml,
    referencesHtml: ex.referencesHtml, affiliationsHtml: ex.affiliationsHtml,
    correspHtml: ex.correspHtml, pdfPath,
  });
  fs.writeFileSync(f, JSON.stringify(e));
  repaired.set(e.slug, e);
  fixed++;
}

// Pass 2: propagate fixes to alias pages of repaired canonicals
let aliasFixed = 0;
for (const f of walk(PAGES_DIR)) {
  const e = JSON.parse(fs.readFileSync(f, 'utf-8'));
  if (!e.alias || e.type !== 'article' || !isLogin(e)) continue;
  const canonSlug = (e.canonical || '').replace('https://www.sgmjournals.org/', '');
  const canon = repaired.get(canonSlug) || (fs.existsSync(path.join(PAGES_DIR, `${canonSlug}.json`)) ? JSON.parse(fs.readFileSync(path.join(PAGES_DIR, `${canonSlug}.json`), 'utf-8')) : null);
  if (!canon || isLogin(canon)) continue;
  Object.assign(e, {
    meta: canon.meta, abstractHtml: canon.abstractHtml, bodyHtml: canon.bodyHtml,
    referencesHtml: canon.referencesHtml, affiliationsHtml: canon.affiliationsHtml,
    correspHtml: canon.correspHtml, pdfPath: canon.pdfPath, stub: canon.stub || undefined,
  });
  fs.writeFileSync(f, JSON.stringify(e));
  aliasFixed++;
}

console.log(`repair-meta: canonicals fixed ${fixed}, aliases fixed ${aliasFixed}, citation-stubbed ${stillLogin} (CrossRef titles ${crossrefHits})`);
