#!/usr/bin/env node
// A handful of variant URLs (.long/.full.pdf/.abstract, cgi/content/*) were
// backlink targets recorded as their own canonical in the manifest, so the main
// ingest built them as standalone pages with a SELF-referential canonical. The
// correct SEO canonical for a variant is its clean base. Where that base page
// exists in the build, repoint the variant's canonical at it. (If the base does
// not exist — e.g. only the vN manuscript version was captured — leave it self.)
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './lib/paths.mjs';

const PAGES_DIR = path.join(DATA_DIR, 'pages');
const SITE = 'https://www.sgmjournals.org';

function baseSlug(slug) {
  let s = slug
    .replace(/\.(full\.pdf\+html|full\.pdf|full|abstract|short|long|pdf)$/i, '')
    .replace(/^([a-z]+)\/cgi\/content\/(?:full|abstract|short|long)\//, '$1/content/')
    .replace(/^([a-z]+)\/cgi\/reprintframed?\//, '$1/content/')
    .replace(/^([a-z]+)\/cgi\/reprint\//, '$1/content/');
  return s.replace(/\/+$/, '');
}
const pageExists = (slug) => fs.existsSync(path.join(PAGES_DIR, `${slug}.json`));

let changed = 0, skippedNoBase = 0;
(function walk(dir) {
  for (const n of fs.readdirSync(dir)) {
    const a = path.join(dir, n); const st = fs.statSync(a);
    if (st.isDirectory()) { walk(a); continue; }
    if (!n.endsWith('.json')) continue;
    const e = JSON.parse(fs.readFileSync(a, 'utf-8'));
    if (e.type !== 'article' || !e.slug || !e.canonical) continue;
    const base = baseSlug(e.slug);
    if (base === e.slug) continue;                       // already clean
    const selfCanon = e.canonical.replace(/\/+$/, '') === `${SITE}/${e.slug}`;
    if (!selfCanon) continue;                            // already points elsewhere
    if (pageExists(base)) {
      e.canonical = `${SITE}/${base}`;
      fs.writeFileSync(a, JSON.stringify(e));
      changed++;
    } else {
      skippedNoBase++;
    }
  }
})(PAGES_DIR);
console.log(`variant-canonical fix: repointed ${changed}; left self (no base) ${skippedNoBase}`);
