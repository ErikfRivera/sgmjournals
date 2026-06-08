#!/usr/bin/env node
// Article-fragment pages — figure/table expansions (F1.expansion.html, /T2),
// large-image landings (.large.jpg), supplementary-data folders (/DC1, /suppl/),
// issue TOC and cover-expansion shells — are not standalone documents: they
// duplicate a parent article's <title>. Mark them stub so they are noindex and
// excluded from the sitemap (they still resolve 200 with a canonical).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './lib/paths.mjs';

const PAGES_DIR = path.join(DATA_DIR, 'pages');
const FRAG = /(\.expansion\.html$|\/F\d+\b|\/T\d+\b|\.large\.(jpg|jpeg|gif|png)$|\/DC1\b|\.cover-expansion$|\.toc$|\/suppl\/|\.figures-only$)/i;

let stubbed = 0;
(function walk(dir) {
  for (const n of fs.readdirSync(dir)) {
    const a = path.join(dir, n); const st = fs.statSync(a);
    if (st.isDirectory()) { walk(a); continue; }
    if (!n.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(a, 'utf-8')); } catch { continue; }
    if (!e.slug || e.stub) continue;
    if (FRAG.test('/' + e.slug)) { e.stub = true; fs.writeFileSync(a, JSON.stringify(e)); stubbed++; }
  }
})(PAGES_DIR);
console.log(`fix-noindex-fragments: marked ${stubbed} fragment page(s) noindex`);
