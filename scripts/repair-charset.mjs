#!/usr/bin/env node
// Surgical charset repair: re-extract ONLY the U+FFFD-corrupted fields of the
// affected generated page JSONs from their archive source, decoded with the
// correct (declared) charset. Everything else in each JSON is left untouched.
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './lib/csv.mjs';
import { lookup, lookupLoose, decodeArchive } from './lib/db.mjs';
import { extractMeta, extractArticle, extractInfoPage, extractJournalIntro } from './lib/extract.mjs';
import { MANIFEST_CSV, DATA_DIR, resolveArchiveFile } from './lib/paths.mjs';

const PAGES_DIR = path.join(DATA_DIR, 'pages');
const FFFD = '�';
// "bad" = replacement char or stray C1 control (symptoms of a wrong decode)
const BAD = /[\uFFFD\u0080-\u009F]|\u00EF\u00BF\u00BD/;
const hasBad = (s) => typeof s === 'string' && BAD.test(s);

// affected files = any generated page JSON containing U+FFFD
function findAffected(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findAffected(f));
    else if (e.name.endsWith('.json') && hasBad(fs.readFileSync(f, "utf-8"))) out.push(f);
  }
  return out;
}

// manifest index by slug
const manifest = parseCsv(MANIFEST_CSV);
const bySlug = new Map();
for (const r of manifest) {
  const m = String(r.canonical_www_url || '').match(/^https?:\/\/[^/]+\/(.*)$/);
  if (m) bySlug.set(m[1].replace(/\/+$/, ''), r);
}

function stripVariant(slug) {
  let s = slug
    .replace(/\.(full\.pdf\+html|full\.pdf|full|abstract|short|long)$/i, '')
    .replace(/\/cgi\/content\/(?:full|abstract|short|long)\//, '/content/')
    .replace(/\/cgi\/reprintframed?\//, '/content/')
    .replace(/\/cgi\/reprint\//, '/content/');
  return s;
}

function sourceFor(slug) {
  for (const cand of [slug, stripVariant(slug)]) {
    const row = bySlug.get(cand);
    if (row && row.archive_file) {
      const abs = resolveArchiveFile(row.archive_file);
      if (abs && fs.existsSync(abs)) {
        // declared charset from structure.db
        const dbrow = lookupLoose(row.archive_host, row.archive_request_uri || '/');
        const html = decodeArchive(fs.readFileSync(abs), dbrow && dbrow.charset);
        return { html, row };
      }
    }
  }
  return null;
}

// deep-replace: for any string value containing FFFD, swap in the corrected
// counterpart computed by `fix(keyPath)`. Returns count of fields fixed.
function patchFields(obj, recompute, keyPath = '') {
  let n = 0;
  if (typeof obj === 'string') return 0; // handled by caller via key
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === "string" && hasBad(obj[i])) {
        const fixed = recompute(`${keyPath}[${i}]`, obj[i]);
        if (fixed != null && !hasBad(fixed)) { obj[i] = fixed; n++; }
      } else n += patchFields(obj[i], recompute, `${keyPath}[${i}]`);
    }
  } else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const kp = keyPath ? `${keyPath}.${k}` : k;
      if (typeof v === "string" && hasBad(v)) {
        const fixed = recompute(kp, v);
        if (fixed != null && !hasBad(fixed)) { obj[k] = fixed; n++; }
      } else n += patchFields(v, recompute, kp);
    }
  }
  return n;
}

const affected = findAffected(PAGES_DIR);
console.log(`Affected page JSONs: ${affected.length}`);
let totalFixed = 0, filesChanged = 0, unresolved = [];

for (const file of affected) {
  const entry = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const slug = entry.slug || path.relative(PAGES_DIR, file).replace(/\.json$/, '');
  const src = sourceFor(slug);
  if (!src) { unresolved.push(slug + ' (no source)'); continue; }
  const ctx = { host: src.row.archive_host, requestUri: src.row.archive_request_uri || '/', journal: entry.journal || slug.split('/')[0] };

  // Precompute corrected views by type.
  let meta = null, article = null, info = null, intro = null;
  const recompute = (keyPath) => {
    if (keyPath.startsWith('meta')) {
      meta ||= extractMeta(src.html);
      article ||= extractArticle(src.html, ctx);
      // map keyPath like meta.title or meta.authors[0]
      const m = keyPath.match(/^meta\.([A-Za-z]+)(?:\[(\d+)\])?$/);
      if (m) {
        const v = (article.meta && article.meta[m[1]] != null) ? article.meta[m[1]] : meta[m[1]];
        if (m[2] != null && Array.isArray(v)) return v[Number(m[2])];
        return typeof v === 'string' ? v : null;
      }
      return null;
    }
    if (keyPath === 'title' || keyPath === 'bodyHtml') {
      info ||= extractInfoPage(src.html, ctx);
      return info[keyPath];
    }
    if (keyPath === 'introHtml') {
      intro ??= extractJournalIntro(src.html, ctx);
      return intro;
    }
    if (keyPath === 'abstractHtml' || keyPath === 'bodyHtml' || keyPath === 'referencesHtml' ||
        keyPath === 'affiliationsHtml' || keyPath === 'correspHtml') {
      article ||= extractArticle(src.html, ctx);
      return article[keyPath];
    }
    return null;
  };

  const n = patchFields(entry, recompute);
  if (n > 0) {
    fs.writeFileSync(file, JSON.stringify(entry));
    totalFixed += n; filesChanged++;
    console.log(`  fixed ${n} field(s): ${slug}`);
  } else {
    unresolved.push(slug + ' (recompute still FFFD or no match)');
  }
}

console.log(`\nFiles changed: ${filesChanged}   Fields fixed: ${totalFixed}`);
if (unresolved.length) { console.log('UNRESOLVED:'); unresolved.forEach((u) => console.log('  ' + u)); }
