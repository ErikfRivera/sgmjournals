#!/usr/bin/env node
// Gap-fill article metadata from the best available archive capture.
// The main ingest reads ONE capture per article (the manifest's archive_file);
// when that capture is metadata-poor (a print/citation view, an old table-format
// abstract page, or a login wall) the page ended up with no authors and/or a
// fallback "<Journal> V(I):P" title — even though a sibling capture (.abstract,
// cgi/content/abstract, .full) exposes citation_author / dc.Contributor and the
// real title. This pass looks across all captures and fills ONLY missing fields.
// Pure citation metadata — never body text — so no fabrication.
import fs from 'node:fs';
import path from 'node:path';
import { lookupLoose, readHtml } from './lib/db.mjs';
import { extractMeta } from './lib/extract.mjs';
import { DATA_DIR } from './lib/paths.mjs';

const PAGES_DIR = path.join(DATA_DIR, 'pages');
const HOSTS = {
  vir: ['vir', 'jgv', 'intl-vir'], mic: ['mic', 'intl-mic', 'm.mic'],
  ijs: ['ijs', 'ijsb', 'intl-ijs'], jmm: ['jmm', 'intl-jmm'], jmmcr: ['jmmcr'], mgen: ['mgen'],
};
const LOGIN = /sign[\s-]?in|log[\s-]?in|access denied|page not found|institutional access|subscribe to|please choose/i;

// A title is a fallback if it is empty or just "<words> NN(NN):NN" (journal+citation).
const isFallbackTitle = (t) => !t || /\b\d+\(\d+\):\d+\s*$/.test(t) || LOGIN.test(t);

// gather candidate metas across hosts + uri variants for a V/I/P or manuscript slug
function candidateMetas(journal, slug) {
  const m = slug.match(/^[a-z]+\/content\/(.+)$/);
  if (!m) return [];
  const rest = m[1];
  const hosts = (HOSTS[journal] || [journal]).map((h) => `${h}.sgmjournals.org`);
  const uris = [
    `/content/${rest}`, `/content/${rest}.abstract`, `/content/${rest}.full`,
    `/cgi/content/abstract/${rest}`, `/cgi/content/full/${rest}`,
  ];
  const metas = [];
  for (const host of hosts) {
    for (const uri of uris) {
      const row = lookupLoose(host, uri);
      if (!row) continue;
      const html = readHtml(row);
      if (!html) continue;
      try { metas.push(extractMeta(html)); } catch {}
    }
  }
  return metas;
}

const FILL = ['authors', 'title', 'doi', 'volume', 'issue', 'firstpage', 'lastpage', 'date', 'pmid', 'journalTitle'];
let scanned = 0, changed = 0, authorsAdded = 0, titlesFixed = 0;

(function walk(dir) {
  for (const n of fs.readdirSync(dir)) {
    const a = path.join(dir, n); const st = fs.statSync(a);
    if (st.isDirectory()) { walk(a); continue; }
    if (!n.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(a, 'utf-8')); } catch { continue; }
    if (e.type !== 'article' || !e.slug) continue;
    if (/\.(full|abstract|short|long)$/.test(e.slug) || /\/cgi\//.test(e.slug)) continue; // skip variants
    const meta = e.meta || (e.meta = {});
    const needAuthors = !(meta.authors && meta.authors.length);
    const needTitle = isFallbackTitle(meta.title);
    const needDoi = !meta.doi;
    if (!needAuthors && !needTitle && !needDoi) continue;
    scanned++;
    const cands = candidateMetas(e.journal, e.slug);
    if (!cands.length) continue;
    // pick the richest candidate (most authors, real title)
    cands.sort((x, y) => (y.authors?.length || 0) - (x.authors?.length || 0));
    let touched = false;
    // authors: take the first candidate that has any
    if (needAuthors) {
      const withA = cands.find((c) => c.authors && c.authors.length);
      if (withA) { meta.authors = withA.authors; authorsAdded++; touched = true; }
    }
    // title: take the first non-fallback real title
    if (needTitle) {
      const withT = cands.find((c) => c.title && !isFallbackTitle(c.title));
      if (withT) { meta.title = withT.title; titlesFixed++; touched = true; }
    }
    // scalar gaps from the richest candidate that has them
    for (const f of FILL) {
      if (f === 'authors' || f === 'title') continue;
      if (meta[f]) continue;
      const c = cands.find((c) => c[f]);
      if (c && c[f]) { meta[f] = c[f]; touched = true; }
    }
    if (touched) { fs.writeFileSync(a, JSON.stringify(e)); changed++; }
  }
})(PAGES_DIR);

console.log(`recover-meta: scanned ${scanned} gap pages; updated ${changed} (authors +${authorsAdded}, titles +${titlesFixed})`);
