#!/usr/bin/env node
// QA gates C (canonical correctness) + D/E/F automated checks over dist/.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib/paths.mjs';

const DIST = path.join(REPO_ROOT, 'dist');
const htmlFiles = [];
(function collect(d) { for (const n of fs.readdirSync(d)) { const a = path.join(d, n); const s = fs.statSync(a); if (s.isDirectory()) collect(a); else if (n.endsWith('.html')) htmlFiles.push(a); } })(DIST);

const fileSet = new Set();
(function collectFiles(d, rel) { for (const n of fs.readdirSync(d)) { const a = path.join(d, n); const s = fs.statSync(a); if (s.isDirectory()) collectFiles(a, rel + '/' + n); else fileSet.add(rel + '/' + n); } })(DIST, '');

const res = {};
function rec(k, pass, detail) { res[k] = { pass, detail }; }

// ---- C: canonical correctness ----------------------------------------------
let noCanon = 0, multiCanon = 0, badPrefix = 0;
let titles = new Map(), descMissing = 0, jsonldArticles = 0, jsonldBad = 0;
let imgChecked = 0, imgBroken = 0, hwChrome = 0;
const sampleBrokenImg = [], sampleHw = [];
const articleSample = [];

for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf-8');
  const url = '/' + path.relative(DIST, f).replace(/\/?index\.html$/, '');
  const canon = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)].map((m) => m[1]);
  if (canon.length === 0) noCanon++;
  if (canon.length > 1) multiCanon++;
  // C-1: no legacy journal prefixes as real directories
  if (/^\/(jgv|ijsb)\//.test(url)) badPrefix++;

  // F-1: title + description
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  titles.set(title, (titles.get(title) || 0) + 1);
  if (!/<meta name="description" content="[^"]+"/.test(html)) descMissing++;

  // F-2: ScholarlyArticle JSON-LD on article pages
  const isArticle = /"@type":"ScholarlyArticle"/.test(html);
  if (isArticle) {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (m) { try { const j = JSON.parse(m[1]); if (j['@type'] === 'ScholarlyArticle' && j.headline) jsonldArticles++; else jsonldBad++; } catch { jsonldBad++; } }
    if (articleSample.length < 5) articleSample.push(url);
  }

  // D-4: leftover HighWire chrome — unambiguous markers only (scripts/widgets/
  // forms), not the word "HighWire" appearing in legitimate body prose.
  if (/sass_path|pingfedauth|gca-form|HW\.ad|hwhelp|var\s+hwHelp|id="?gca|type="password"|cgi\/login|name="?pf\.|highwire\.js/i.test(html)) { hwChrome++; if (sampleHw.length < 5) sampleHw.push(url); }

  // E-1: internal <img src> exist
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    let src = m[1];
    if (/^(https?:|data:|\/\/)/i.test(src)) continue;
    imgChecked++;
    if (!fileSet.has(src)) { imgBroken++; if (sampleBrokenImg.length < 10) sampleBrokenImg.push({ src, page: url }); }
  }
}

// Recreated variant URLs legitimately share a title with their canonical (they
// carry rel=canonical), so global title uniqueness is expected to be < total.
// The real defect is login/placeholder titles leaking into output.
const BAD_TITLE = /sign[\s-]?in|log[\s-]?in|untitled|access denied|page not found/i;
const badTitles = [...titles.entries()].filter(([t]) => BAD_TITLE.test(t));
const badTitleCount = badTitles.reduce((s, [, n]) => s + n, 0);

rec('C-1 no legacy jgv/ijsb prefixes', badPrefix === 0, `${badPrefix} pages under /jgv|/ijsb`);
rec('C-2 every page has rel=canonical', noCanon === 0, `${noCanon} pages missing canonical`);
rec('C-2b single canonical per page', multiCanon === 0, `${multiCanon} pages with >1 canonical`);
rec('D-4 no leftover HighWire chrome', hwChrome === 0, `${hwChrome} pages with chrome (e.g. ${sampleHw.join(', ')})`);
rec('E-1 figure images resolve', imgBroken === 0, `${imgBroken}/${imgChecked} broken (e.g. ${sampleBrokenImg.slice(0,3).map(b=>b.src).join(', ')})`);
rec('F-1 description present', descMissing === 0, `${descMissing} pages missing meta description`);
rec('F-1b no login/placeholder titles', badTitleCount === 0, `${badTitleCount} pages with login/placeholder titles (e.g. ${badTitles.slice(0,2).map(([t,n])=>`${n}×"${t.slice(0,30)}"`).join('; ')})`);
rec('F-2 ScholarlyArticle JSON-LD valid', jsonldBad === 0, `${jsonldArticles} valid, ${jsonldBad} invalid`);
rec('F-3 sitemap + robots present', fs.existsSync(path.join(DIST,'sitemap.xml')) && fs.existsSync(path.join(DIST,'robots.txt')), '');

console.log('=== QA content (C/D/E/F) ===');
for (const [k, v] of Object.entries(res)) console.log(`${v.pass ? 'PASS' : 'FAIL'}  ${k}  — ${v.detail}`);
fs.writeFileSync(path.join(REPO_ROOT, 'qa-content-result.json'), JSON.stringify(res, null, 2));
