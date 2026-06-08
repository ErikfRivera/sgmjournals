#!/usr/bin/env node
// Tier-2 step 3: inject the cached auto-summaries into the article page JSON.
// Reads scripts/cc/pdfcache/<safe>.json (with summary + findings) and writes a
// labeled summaryHtml into the canonical page entry, clearing needsSummary.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const PAGES = path.join(REPO, 'src', 'data', 'generated', 'pages');
const CACHE = path.join(__dirname, 'pdfcache');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function summaryHtml(rec) {
  const parts = [];
  if (rec.summary) parts.push(`<p>${esc(rec.summary).replace(/\n+/g, '</p><p>')}</p>`);
  if (Array.isArray(rec.findings) && rec.findings.length) {
    parts.push('<h3>Key findings</h3><ul>' + rec.findings.map((f) => `<li>${esc(f)}</li>`).join('') + '</ul>');
  }
  return parts.join('\n');
}

let applied = 0, noSummary = 0, noPage = 0;
for (const f of fs.readdirSync(CACHE)) {
  if (!f.endsWith('.json')) continue;
  const rec = JSON.parse(fs.readFileSync(path.join(CACHE, f)));
  if (!rec.summary) { noSummary++; continue; }
  const slug = rec.slug;
  const pf = path.join(PAGES, slug + '.json');
  if (!fs.existsSync(pf)) { noPage++; continue; }
  const d = JSON.parse(fs.readFileSync(pf));
  d.summaryHtml = summaryHtml(rec);
  delete d.needsSummary;
  fs.writeFileSync(pf, JSON.stringify(d));
  applied++;
}
console.log(`applied summaries: ${applied}  (cache w/o summary: ${noSummary}, no page: ${noPage})`);
