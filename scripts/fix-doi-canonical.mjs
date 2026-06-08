#!/usr/bin/env node
// Consolidate duplicate canonicals by DOI. The archive captured many papers
// under several lifecycle URLs — early-access (/content/early/<date>/<id>),
// manuscript-ID (/content/<jmm.0.NNNNNN-0>) and the final volume/issue
// (/content/<vol>/<issue>/<page>) — each a separate page with a self-canonical.
// They share one DOI = one article, so every page (and its format variants)
// should point rel=canonical at a single representative: prefer the final
// volume/issue URL, then the manuscript-ID, then early-access. Pages keep
// resolving at their own URL (backlink coverage); only the canonical changes.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './lib/paths.mjs';

const PAGES_DIR = path.join(DATA_DIR, 'pages');
const SITE = 'https://www.sgmjournals.org';

const VARIANT = /\.(full\.pdf\+html|full\.pdf|full|abstract|short|long|pdf)$/i;
const isVariantSlug = (s) => VARIANT.test(s) || /\/cgi\//.test(s);

// score a base slug: lower = more preferred as the canonical representative
function rank(slug) {
  const m = slug.match(/^[a-z]+\/content\/(.+)$/);
  if (!m) return 9;
  const rest = m[1];
  if (rest.startsWith('early/')) return 3;                 // early-access
  if (/^[A-Za-z]+\.[0-9].*/.test(rest) && !rest.includes('/')) return 2; // manuscript-ID
  if (/^\d+\/[^/]+\/[^/]+$/.test(rest)) return 0;          // final vol/issue/page
  return 1;
}

// 1. collect all article pages, group by DOI
const all = [];
(function walk(dir) {
  for (const n of fs.readdirSync(dir)) {
    const a = path.join(dir, n); const st = fs.statSync(a);
    if (st.isDirectory()) { walk(a); continue; }
    if (!n.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(a, 'utf-8')); } catch { continue; }
    if (e.type !== 'article' || !e.slug) continue;
    const doi = ((e.meta && e.meta.doi) || '').trim().toLowerCase();
    all.push({ file: a, slug: e.slug, doi, entry: e });
  }
})(PAGES_DIR);

const byDoi = new Map();
for (const p of all) {
  if (!p.doi) continue;
  if (!byDoi.has(p.doi)) byDoi.set(p.doi, []);
  byDoi.get(p.doi).push(p);
}

let groups = 0, repointed = 0;
for (const [doi, pages] of byDoi) {
  const bases = pages.filter((p) => !isVariantSlug(p.slug));
  const distinctBase = new Set(bases.map((p) => p.slug));
  if (distinctBase.size < 2) continue;                     // only true duplicates
  // choose representative among base slugs
  const rep = bases.slice().sort((a, b) => rank(a.slug) - rank(b.slug) || a.slug.length - b.slug.length)[0];
  if (!rep) continue;
  groups++;
  const repCanon = `${SITE}/${rep.slug}`;
  for (const p of pages) {
    const cur = (p.entry.canonical || '').replace(/\/+$/, '');
    if (cur !== repCanon) {
      p.entry.canonical = repCanon;
      fs.writeFileSync(p.file, JSON.stringify(p.entry));
      repointed++;
    }
  }
}
console.log(`DOI canonical consolidation: ${groups} multi-URL articles; ${repointed} pages repointed`);
