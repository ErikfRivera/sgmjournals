// Content-driven tier resolver shared by the validator and the rebuild sweep.
// Given an availability-map record, read the candidate archive files and decide
// the richest tier that actually yields content, returning the extracted parts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractArticle } from '../lib/extract.mjs';
import { extractContentBoxAbstract, isLoginWall } from '../lib/oldformat.mjs';
import { decodeArchive } from '../lib/db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.resolve(__dirname, '..', '..', '..',
  'NWK0G2ISWAUU0C6K', 'sgmjournals.org', '.content.DFgjfXp1');

function readArchive(rel) {
  if (!rel) return null;
  const f = path.join(ARCHIVE, rel);
  if (!fs.existsSync(f)) return null;
  try { return decodeArchive(fs.readFileSync(f)); } catch { return null; }
}

const txt = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Try to get a full body from full/long HTML files. Returns extractArticle result
// (with meta) for the file that produced a real body, or null.
function tryFullBody(rec) {
  for (const key of ['full', 'long']) {
    const rel = rec[key + '_file'];
    const html = readArchive(rel);
    if (!html) continue;
    if (isLoginWall(html)) continue;
    const ctx = { host: rec.journal + '.sgmjournals.org', requestUri: rec[key + '_uri'] || '/', journal: rec.journal };
    let ex;
    try { ex = extractArticle(html, ctx); } catch { continue; }
    if (txt(ex.bodyHtml).length > 400) return { ex, html, ctx, srcKey: key, srcRel: rel };
  }
  return null;
}

// Try to get an abstract from any candidate file (full/long/abstract/short), using
// the modern/old extractors first, then the content_box fallback.
function tryAbstract(rec) {
  for (const key of ['abstract', 'short', 'full', 'long']) {
    const rel = rec[key + '_file'];
    const html = readArchive(rel);
    if (!html) continue;
    const ctx = { host: rec.journal + '.sgmjournals.org', requestUri: rec[key + '_uri'] || '/', journal: rec.journal };
    let ex = null;
    try { ex = extractArticle(html, ctx); } catch { ex = null; }
    let absHtml = ex && txt(ex.abstractHtml).length > 80 ? ex.abstractHtml : '';
    if (!absHtml) {
      const cb = extractContentBoxAbstract(html, ctx);
      if (txt(cb).length > 80) absHtml = cb;
    }
    if (absHtml) return { absHtml, ex, ctx, srcKey: key, srcRel: rel };
  }
  return null;
}

// Grab the best available metadata from whatever HTML file exists.
function anyMeta(rec) {
  for (const key of ['full', 'long', 'abstract', 'short']) {
    const html = readArchive(rec[key + '_file']);
    if (!html) continue;
    const ctx = { host: rec.journal + '.sgmjournals.org', requestUri: rec[key + '_uri'] || '/', journal: rec.journal };
    try {
      const ex = extractArticle(html, ctx);
      if (ex.meta && ex.meta.title) return ex.meta;
    } catch {}
  }
  return null;
}

const pdfIsReal = (rec) => !!rec.pdf_file && /\.pdf$/i.test(rec.pdf_file);

// Resolve an article to its richest achievable tier + extracted parts.
// Returns { tier: 'tier1-full'|'tier2-pdf'|'tier3-abstract'|'tier4-stub',
//           meta, abstractHtml, bodyHtml, referencesHtml, correspHtml,
//           affiliationsHtml, hasPdf, srcRel }
export function resolveArticle(rec) {
  const full = tryFullBody(rec);
  if (full) {
    const { ex } = full;
    // also try to enrich abstract if the full body lacked one
    let absHtml = ex.abstractHtml;
    if (txt(absHtml).length < 80) { const a = tryAbstract(rec); if (a) absHtml = a.absHtml; }
    return {
      tier: 'tier1-full', meta: ex.meta,
      abstractHtml: absHtml || '', bodyHtml: ex.bodyHtml,
      referencesHtml: ex.referencesHtml || '', correspHtml: ex.correspHtml || '',
      affiliationsHtml: ex.affiliationsHtml || '',
      hasPdf: pdfIsReal(rec), srcRel: full.srcRel,
    };
  }

  const abs = tryAbstract(rec);
  const hasPdf = pdfIsReal(rec);
  const meta = (abs && abs.ex && abs.ex.meta && abs.ex.meta.title) ? abs.ex.meta : anyMeta(rec);

  if (hasPdf) {
    // Tier 2: PDF is the richest source. Keep the abstract for display if found.
    return {
      tier: 'tier2-pdf', meta: meta || {},
      abstractHtml: abs ? abs.absHtml : '', bodyHtml: '',
      referencesHtml: '', correspHtml: (abs && abs.ex && abs.ex.correspHtml) || '',
      affiliationsHtml: '', hasPdf: true, srcRel: rec.pdf_file,
    };
  }
  if (abs) {
    return {
      tier: 'tier3-abstract', meta: meta || {},
      abstractHtml: abs.absHtml, bodyHtml: '',
      referencesHtml: '', correspHtml: (abs.ex && abs.ex.correspHtml) || '',
      affiliationsHtml: '', hasPdf: false, srcRel: abs.srcRel,
    };
  }
  return {
    tier: 'tier4-stub', meta: meta || {},
    abstractHtml: '', bodyHtml: '', referencesHtml: '', correspHtml: '',
    affiliationsHtml: '', hasPdf: false, srcRel: null,
  };
}
