#!/usr/bin/env node
// Live B-2 verification: fetch every distinct Ahrefs Target URL (the ORIGINAL
// subdomain URL) against the live domain, following redirects (Cloudflare host
// rewrite -> middleware -> page), and record the final HTTP status.
// Usage: node scripts/qa-live.mjs [concurrency]
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './lib/csv.mjs';
import { INPUT_ROOT, REPO_ROOT } from './lib/paths.mjs';

const CONC = parseInt(process.argv[2] || '12', 10);
const csvName = fs.readdirSync(INPUT_ROOT).find((f) => /backlinks-subdomains.*\.csv$/i.test(f));
const rows = parseCsv(path.join(INPUT_ROOT, csvName), { delimiter: '\t', encoding: 'utf16le' });
const targets = [...new Set(rows.map((r) => r['Target URL']).filter((u) => u && /^https?:\/\/[^.]*\.?sgmjournals\.org/i.test(u)))];
console.log(`Live-checking ${targets.length} backlink URLs (concurrency ${CONC})…`);

async function check(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'sgmjournals-QA/1.0' }, signal: AbortSignal.timeout(25000) });
    return { url, status: r.status, final: r.url };
  } catch (e) {
    // retry once
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'sgmjournals-QA/1.0' }, signal: AbortSignal.timeout(25000) });
      return { url, status: r.status, final: r.url };
    } catch (e2) { return { url, status: 0, final: '', err: String(e2.name || e2.message) }; }
  }
}

const results = [];
let i = 0, done = 0;
async function worker() {
  while (i < targets.length) {
    const idx = i++;
    results[idx] = await check(targets[idx]);
    if (++done % 500 === 0) console.log(`  ${done}/${targets.length}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const ok = results.filter((r) => r.status >= 200 && r.status < 400).length;
const bad = results.filter((r) => !(r.status >= 200 && r.status < 400));
function esc(v) { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
fs.writeFileSync(path.join(REPO_ROOT, 'backlink-live-report.csv'),
  'target_url,status,final_url\n' + results.map((r) => [r.url, r.status, r.final].map(esc).join(',')).join('\n') + '\n');

console.log(`\nLIVE: ${ok}/${targets.length} resolve (2xx/3xx).  Non-OK: ${bad.length}`);
if (bad.length) { console.log('First 30 non-OK:'); bad.slice(0, 30).forEach((r) => console.log(`  ${r.status}  ${r.url}${r.err ? '  ['+r.err+']' : ''}`)); }
