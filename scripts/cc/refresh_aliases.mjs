#!/usr/bin/env node
// Alias article pages (variant URLs recreated as real pages) are snapshots of the
// canonical's content taken at build time — and were captured while the canonical
// was empty. Re-sync every alias to its (now content-complete) canonical so the
// variant URL renders the same richest-tier content.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES = path.resolve(__dirname, '..', '..', 'src', 'data', 'generated', 'pages');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.json')) yield p;
  }
}

const CONTENT_KEYS = ['meta', 'abstractHtml', 'bodyHtml', 'referencesHtml',
  'affiliationsHtml', 'correspHtml', 'pdfPath', 'summaryHtml', 'needsSummary', 'ccTier'];

let refreshed = 0, unchanged = 0, noCanon = 0;
for (const file of walk(PAGES)) {
  let d;
  try { d = JSON.parse(fs.readFileSync(file)); } catch { continue; }
  if (d.type !== 'article' || !d.alias) continue;
  const canonSlug = (d.canonical || '').replace(/^https?:\/\/[^/]+\//, '').replace(/\/+$/, '');
  if (!canonSlug || canonSlug === d.slug) continue;
  const canonFile = path.join(PAGES, canonSlug + '.json');
  if (!fs.existsSync(canonFile)) { noCanon++; continue; }
  let c;
  try { c = JSON.parse(fs.readFileSync(canonFile)); } catch { noCanon++; continue; }
  const next = { ...d };
  for (const k of CONTENT_KEYS) {
    if (k in c) next[k] = c[k]; else delete next[k];
  }
  next.alias = true;
  const before = JSON.stringify(d), after = JSON.stringify(next);
  if (before !== after) { fs.writeFileSync(file, after); refreshed++; }
  else unchanged++;
}
console.log(`alias refresh: refreshed=${refreshed} unchanged=${unchanged} no-canonical=${noCanon}`);
