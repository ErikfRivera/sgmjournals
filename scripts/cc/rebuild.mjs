#!/usr/bin/env node
// US-CC-003/004/005: comprehensive, resumable content-completeness rebuild.
//
// For every article in the availability map, resolve the richest achievable tier
// (content-verified) and write the page JSON the Astro routes consume, so the page
// renders its best-available source — never something lesser.
//
//   node scripts/cc/rebuild.mjs                 # whole map (resumable)
//   node scripts/cc/rebuild.mjs --limit 2000    # cap this run
//   node scripts/cc/rebuild.mjs --only-gaps     # skip slugs already at their tier
//   node scripts/cc/rebuild.mjs --reset
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveArticle } from './resolve.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const ARCHIVE = path.resolve(REPO, '..', 'NWK0G2ISWAUU0C6K', 'sgmjournals.org', '.content.DFgjfXp1');
const PAGES = path.join(REPO, 'src', 'data', 'generated', 'pages');
const ASSETS = path.join(REPO, 'public', 'assets');
const AVAIL = path.join(__dirname, 'availability_map.json');
const PROG = path.join(__dirname, 'cc-progress.json');

const args = process.argv.slice(2);
const getArg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit'), 10) : Infinity;
const RESET = args.includes('--reset');

const avail = JSON.parse(fs.readFileSync(AVAIL));
let prog = { done: {} };
if (!RESET && fs.existsSync(PROG)) { try { prog = JSON.parse(fs.readFileSync(PROG)); } catch {} }
prog.done ||= {};

function writeEntry(slug, entry) {
  const file = path.join(PAGES, `${slug}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(entry));
}

// Copy the recovered PDF into public/assets/<journal>/content/V/I/P.full.pdf.
function copyPdf(rec) {
  if (!rec.pdf_file) return null;
  const src = path.join(ARCHIVE, rec.pdf_file);
  if (!fs.existsSync(src)) return null;
  const uri = (rec.pdf_uri || `/content/${rec.vol}/${rec.issue}/${rec.page}.full.pdf`).replace(/[?#].*$/, '');
  const webPath = `/assets/${rec.journal}${uri}`;
  const dest = path.join(ASSETS, webPath.replace(/^\/assets\//, ''));
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    return webPath;
  } catch { return null; }
}

const slugs = Object.keys(avail).sort();
let n = 0, built = 0;
const tierCounts = {};
const t0 = Date.now();

for (const slug of slugs) {
  if (built >= LIMIT) break;
  if (prog.done[slug] && !RESET) continue;
  const rec = avail[slug];
  n++;
  let res;
  try { res = resolveArticle(rec); } catch (e) { res = { tier: 'tier4-stub', meta: {}, abstractHtml: '', bodyHtml: '', referencesHtml: '', correspHtml: '', affiliationsHtml: '', hasPdf: false }; }

  let pdfPath = null;
  if (res.hasPdf) pdfPath = copyPdf(rec);

  const meta = res.meta || {};
  // Ensure citation basics exist even for stubs (from V/I/P) so the page is useful.
  meta.volume = meta.volume || rec.vol;
  meta.issue = meta.issue || rec.issue;
  meta.firstpage = meta.firstpage || rec.page;

  const entry = {
    type: 'article', slug, journal: rec.journal,
    canonical: `https://www.sgmjournals.org/${slug}`,
    meta,
    abstractHtml: res.abstractHtml || '',
    bodyHtml: res.bodyHtml || '',
    referencesHtml: res.referencesHtml || '',
    affiliationsHtml: res.affiliationsHtml || '',
    correspHtml: res.correspHtml || '',
    pdfPath,
    summaryHtml: '',
    ccTier: res.tier,
    refdomains: 0,
  };
  // Tier 2: PDF is richest; flag for the summary phase.
  if (res.tier === 'tier2-pdf') entry.needsSummary = true;

  writeEntry(slug, entry);
  prog.done[slug] = res.tier;
  tierCounts[res.tier] = (tierCounts[res.tier] || 0) + 1;
  built++;

  if (built % 1000 === 0) {
    fs.writeFileSync(PROG, JSON.stringify(prog));
    const rate = built / ((Date.now() - t0) / 1000);
    process.stdout.write(`  built ${built} (${rate.toFixed(0)}/s)  tiers=${JSON.stringify(tierCounts)}\n`);
  }
}

fs.writeFileSync(PROG, JSON.stringify(prog));
console.log(`\nDone this run. Processed ${n}, wrote ${built}.`);
console.log('Tier counts this run:', tierCounts);
const totalDone = Object.keys(prog.done).length;
console.log(`Total resolved (all runs): ${totalDone} / ${slugs.length}`);
const allTiers = {};
for (const t of Object.values(prog.done)) allTiers[t] = (allTiers[t] || 0) + 1;
console.log('Cumulative tiers:', allTiers);
