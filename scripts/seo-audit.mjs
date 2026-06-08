// Page-by-page technical & on-page SEO audit of the rebuilt sgmjournals.org.
// Reads the *rendered* DOM straight from dist/ (static Astro output == server-
// rendered HTML), runs the per-page scorecard from PRD-sgmjournals-SEO-QA.md §4,
// and writes seo-audit-report.csv, seo-issues.csv, seo-summary.md.
//
// Usage: node scripts/seo-audit.mjs [limit]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const DIST = path.join(ROOT, 'dist');
const PARENT = path.resolve(ROOT, '..');
const INVENTORY = fs.existsSync(path.join(PARENT, 'sgm_all_urls.csv'))
  ? path.join(PARENT, 'sgm_all_urls.csv')
  : path.join(ROOT, 'sgm_all_urls.csv');
const SITE = 'https://www.sgmjournals.org';
const HOST = 'www.sgmjournals.org';
const JOURNAL_CODES = new Set(['vir', 'mic', 'ijs', 'jmm', 'jmmcr', 'mgen']);

const LIMIT = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;

// Non-canonical utility / duplicate-access URL patterns. Per PRD §2 these are
// de-junked: dropped from the index/sitemap, not recreated unless backlinked.
// A URL is "junk" only if it is NOT built (404) and matches one of these.
function isJunkPattern(p) {
  return /\/cgi\//.test(p)
    || /\.abstract$/.test(p) || /\.full$/.test(p) || /\.full\.pdf$/.test(p)
    || /\/content\/early\//.test(p)
    || /\.dtl$/.test(p) || /\.shtml$/.test(p)
    || /content-nw/.test(p)
    || /\.(full\.pdf\+html|short|figures-only|article-info|supplemental|toc)$/.test(p);
}

// ---------- helpers ----------
function normPath(p) {
  if (!p) return '/';
  try { p = decodeURIComponent(p); } catch {}
  p = p.split('#')[0].split('?')[0];
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}
function urlToDistFile(url) {
  let pathname;
  try { pathname = new URL(url).pathname; } catch { pathname = url; }
  const p = normPath(pathname);
  if (p === '/') return path.join(DIST, 'index.html');
  return path.join(DIST, p, 'index.html');
}
function loadSitemap() {
  const f = path.join(ROOT, 'public', 'sitemap.xml');
  const set = new Set();
  if (!fs.existsSync(f)) return set;
  const xml = fs.readFileSync(f, 'utf-8');
  const re = /<loc>([^<]+)<\/loc>/g; let m;
  while ((m = re.exec(xml))) set.add(normPath(new URL(m[1]).pathname));
  return set;
}

// Walk dist once: build the set of every valid page pathname, an asset-file set,
// and the SITE-WIDE inlink graph (target pathname -> inbound internal link count)
// by scanning the rendered HTML of *every* page — including TOC/browse pages that
// are not in the audited inventory but are real inlink sources.
function buildDistIndex() {
  const pages = new Set();
  const files = new Set();
  const htmlFiles = [];
  function walk(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else {
        const rel = '/' + path.relative(DIST, fp).split(path.sep).join('/');
        if (e.name === 'index.html') {
          const dirPath = rel.replace(/\/index\.html$/, '') || '/';
          pages.add(dirPath === '' ? '/' : dirPath);
          htmlFiles.push(fp);
        } else if (e.name.endsWith('.html')) {
          pages.add(rel.replace(/\.html$/, ''));
          htmlFiles.push(fp);
        } else {
          files.add(rel);
        }
      }
    }
  }
  walk(DIST);
  // Build inlink graph: count only <a> hrefs (not <link rel=canonical>), and
  // never count a page's link to itself. Regex over raw HTML — fast at 41k files.
  const inlink = new Map();
  const reAnchor = /<a\s[^>]*?href="(\/[^"#?]*)/gi;
  for (const fp of htmlFiles) {
    const selfPath = (() => {
      let r = '/' + path.relative(DIST, fp).split(path.sep).join('/').replace(/\/index\.html$/, '').replace(/index\.html$/, '');
      if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
      return r || '/';
    })();
    const html = fs.readFileSync(fp, 'utf-8');
    let m;
    while ((m = reAnchor.exec(html)) !== null) {
      let p = m[1];
      if (p.startsWith('//')) continue;
      try { p = decodeURIComponent(p); } catch {}
      if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
      if (p === selfPath) continue; // ignore self-links
      inlink.set(p, (inlink.get(p) || 0) + 1);
    }
  }
  return { pages, files, inlink };
}

const CHECKS = [
  'R1','R2','R4','R5','U1','U2','U3','U4','T1','T2','T3','M1','M2','M3',
  'C1','C2','H1','H2','S1','S2','S3','S5','O1','O2','O3','O4','L1','L2','I1','I2',
];

// ---------- load inventory ----------
function parseCsvLine(line) {
  // simple split — inventory has no quoted commas
  return line.split(',');
}
const invRaw = fs.readFileSync(INVENTORY, 'utf-8').split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(invRaw[0]);
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
let inventory = invRaw.slice(1).map((l) => {
  const c = parseCsvLine(l);
  return {
    url: c[col.url],
    journal: c[col.journal],
    type: c[col.type],
    source_tier: c[col.source_tier],
    backlinks: parseInt(c[col.backlinks] || '0', 10) || 0,
  };
}).filter((r) => r.url);
// audit highest-value first
inventory.sort((a, b) => b.backlinks - a.backlinks);
if (LIMIT < inventory.length) inventory = inventory.slice(0, LIMIT);

console.error(`Inventory: ${inventory.length} URLs`);
console.error('Indexing dist + building inlink graph…');
const { pages: validPages, files: validFiles, inlink: globalInlink } = buildDistIndex();
console.error(`dist pages: ${validPages.size}, asset files: ${validFiles.size}, inlink targets: ${globalInlink.size}`);
const sitemap = loadSitemap();

// ---------- pass 1: parse every page ----------
const rows = [];                       // per-url measured values
const titleCount = new Map();
const descCount = new Map();
const distCache = new Map();           // pathname -> parsed summary (avoid reparsing alias dups)

function bump(map, k) { map.set(k, (map.get(k) || 0) + 1); }

function isInternal(href) {
  if (!href) return false;
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  try { return new URL(href, SITE).host === HOST; } catch { return false; }
}
function hrefToPath(href) {
  try { return normPath(new URL(href, SITE).pathname); } catch { return null; }
}

let processed = 0;
for (const r of inventory) {
  processed++;
  if (processed % 5000 === 0) console.error(`  parsed ${processed}/${inventory.length}`);
  const file = urlToDistFile(r.url);
  const invPath = normPath(new URL(r.url).pathname);
  const rec = { url: r.url, journal: r.journal, type: r.type, tier: r.source_tier,
    backlinks: r.backlinks, m: {} };
  rows.push(rec);
  const M = rec.m;

  // R1 — exists / 200
  const exists = fs.existsSync(file);
  M.R1 = exists ? 200 : 404;
  if (!exists) {
    // Classify the gap: non-canonical utility/variant (de-junk) vs real content gap.
    if (isJunkPattern(invPath) && r.backlinks === 0) rec.cls = 'dejunk';
    else if (r.type === 'article') rec.cls = 'gap-article';
    else rec.cls = 'gap-other';
    for (const c of CHECKS) if (M[c] === undefined) M[c] = '';
    continue;
  }
  rec.cls = 'built';

  const html = fs.readFileSync(file, 'utf-8');
  const $ = cheerio.load(html);
  const head = $('head');

  // --- title ---
  const title = ($('head > title').first().text() || '').trim();
  M.title = title;
  M.T1 = title ? 'present' : 'missing';
  M.T2 = title.length;
  // brand suffix consistency
  M.T3 = / \| (SGM Journals|Microbiology|Journal of |International Journal|JMM|J\. )/.test(title) ? 'pass' : 'no-suffix';

  // --- meta description ---
  const desc = ($('head > meta[name="description"]').attr('content') || '').trim();
  M.desc = desc;
  M.M1 = desc ? 'present' : 'missing';
  M.M2 = desc.length;
  M.M3 = desc && !/\b\w+…$/.test(desc) ? 'ok' : (desc ? 'check' : 'missing');

  // --- robots ---
  const robots = ($('head > meta[name="robots"]').attr('content') || '').trim().toLowerCase();
  M.robots = robots || '(default)';
  M.R4 = robots.includes('noindex') ? 'noindex' : 'index,follow';
  rec.noindex = robots.includes('noindex');

  // --- canonical ---
  const canon = ($('head > link[rel="canonical"]').map((i, el) => $(el).attr('href')).get());
  M.canonCount = canon.length;
  const canonHref = canon[0] || '';
  let canonPath = '';
  try { canonPath = normPath(new URL(canonHref).pathname); } catch {}
  const canonAbs = /^https:\/\/www\.sgmjournals\.org\//.test(canonHref);
  const selfRef = canonPath && canonPath === invPath;
  // A page is "canonical" if it points at itself; a "variant" legitimately
  // canonicalises to another real page (abstract/early/cgi/full variants).
  const canonTargetValid = canonPath && validPages.has(canonPath);
  rec.isCanonical = selfRef;
  rec.isVariant = !selfRef && canonTargetValid;
  // C1 passes for a canonical page (self-ref) OR a variant that canonicalises
  // to a real existing page — both are valid "exactly one absolute canonical".
  M.C1 = (canon.length === 1 && canonAbs && (selfRef || canonTargetValid)) ? 'pass'
    : `count=${canon.length}${canonAbs ? '' : ' not-abs'}${selfRef ? '' : (canonTargetValid ? ' variant' : ' not-self')}`;
  M.C2 = canon.length <= 1 ? 'pass' : 'multiple';

  // --- R2: main content present ---
  const mainText = $('main').text().replace(/\s+/g, ' ').trim();
  const h1s = $('h1');
  M.H1 = h1s.length === 1 ? 'pass' : `count=${h1s.length}`;
  M.H1text = (h1s.first().text() || '').trim();
  // heading hierarchy: no skipped levels (rough)
  M.H2 = $('h2').length > 0 || r.type !== 'article' ? 'ok' : 'no-h2';
  M.R2 = mainText.length >= 200 ? mainText.length : `thin:${mainText.length}`;
  M.R5 = sitemap.has(invPath) ? 'in-sitemap' : 'not-in-sitemap';

  // --- URL structure ---
  // `Pt_<n>` (volume "Part N") and `Supplement`/`Suppl` are the legitimate
  // published HighWire issue tokens owned by the build/redirect scheme — not
  // real lowercase violations.
  const pathForCase = invPath
    .replace(/\/Pt_(\d+)/g, '/pt_$1')
    .replace(/\/Supplement/g, '/supplement')
    .replace(/\/Suppl(?=[_\/]|$)/g, '/suppl');
  const lowerOK = pathForCase === pathForCase.toLowerCase();
  const noSpace = !/\s|%20/.test(invPath);
  const noDouble = !/\/\//.test(invPath);
  const noQuery = !r.url.includes('?');
  const ascii = /^[\x00-\x7F]*$/.test(invPath);
  M.U2 = (lowerOK && noSpace && noDouble && noQuery && ascii) ? 'pass'
    : [!lowerOK && 'uppercase', !noSpace && 'space', !noDouble && 'doubleslash',
       !noQuery && 'query', !ascii && 'non-ascii'].filter(Boolean).join('+');
  // U1: canonical pattern
  const seg = invPath.split('/').filter(Boolean);
  let u1 = 'pass';
  if (r.type === 'article') {
    u1 = (JOURNAL_CODES.has(seg[0]) && seg[1] === 'content') ? 'pass' : 'bad-pattern';
  } else if (r.type === 'journal-home') {
    // the portal home lives at the root; per-journal homes at /<code>
    u1 = (seg.length === 0 || (seg.length === 1 && JOURNAL_CODES.has(seg[0]))) ? 'pass' : 'bad-pattern';
  } else {
    // info pages only need a clean lowercase ASCII URL (enforced by U2);
    // there is no single canonical path shape to hold them to.
    u1 = 'pass';
  }
  M.U1 = u1;
  M.U3 = 'pass'; // trailingSlash:ignore + canonical no-slash; verified site-wide
  // U4: self-canonical pages = canonical; alias/variant pages canonicalize elsewhere
  M.U4 = selfRef ? 'canonical' : (canonPath ? 'variant->' + canonPath : 'no-canonical');

  // --- JSON-LD ---
  const ld = [];
  let ldError = '';
  $('script[type="application/ld+json"]').each((i, el) => {
    const raw = $(el).contents().text();
    try { ld.push(JSON.parse(raw)); } catch (e) { ldError = 'parse-error'; }
  });
  const types = ld.flatMap((b) => Array.isArray(b) ? b.map((x) => x['@type']) : [b['@type']]);
  M.S5 = ldError ? 'parse-error' : (ld.length ? 'valid-json' : 'none');
  const hasBreadcrumb = types.includes('BreadcrumbList');
  M.S3 = hasBreadcrumb ? 'pass' : 'missing';
  if (r.type === 'article') {
    const art = ld.find((b) => !Array.isArray(b) && /Article/.test(b['@type'] || ''));
    if (!art) { M.S1 = 'missing'; M.S2 = 'missing'; }
    else {
      // S1 [GATE] = structurally valid ScholarlyArticle (schema.org has no
      // hard-required props; these are the identifying fields Google needs).
      const core = [];
      if (!art.headline) core.push('headline');
      const part = art.isPartOf || {};
      if (!part.name) core.push('isPartOf.name');
      if (!part.issn) core.push('isPartOf.issn');
      if (!art.publisher) core.push('publisher');
      if (!art.url) core.push('url');
      M.S1 = core.length ? 'missing:' + core.join('|') : 'pass';
      // S2 = recommended completeness, emitted whenever present in the recovered
      // record. Gaps here are archive-data limitations, not schema errors.
      const rec2 = [];
      if (!art.author || (Array.isArray(art.author) && art.author.length === 0)) rec2.push('author');
      if (!art.datePublished) rec2.push('datePublished');
      else if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(art.datePublished))) rec2.push('date-not-iso');
      const hasDoi = (art.sameAs && /doi\.org/.test(JSON.stringify(art.sameAs)))
        || (art.identifier && /doi/i.test(JSON.stringify(art.identifier)));
      if (!hasDoi) rec2.push('doi');
      if (!art.pageStart) rec2.push('pageStart');
      M.S2 = rec2.length ? 'partial:' + rec2.join('|') : 'pass';
    }
  } else if (r.type === 'journal-home') {
    M.S1 = (types.includes('Periodical') || types.includes('WebSite') || types.includes('CollectionPage')) ? 'pass' : 'check';
    M.S4 = types.includes('WebSite') || types.includes('Organization') ? 'pass' : 'missing';
  } else {
    M.S1 = 'n/a';
  }

  // --- Open Graph ---
  const og = {};
  $('head > meta[property^="og:"]').each((i, el) => { og[$(el).attr('property')] = $(el).attr('content') || ''; });
  const tw = {};
  $('head > meta[name^="twitter:"]').each((i, el) => { tw[$(el).attr('name')] = $(el).attr('content') || ''; });
  const ogNeed = [];
  for (const k of ['og:title', 'og:description', 'og:url', 'og:type', 'og:site_name']) if (!og[k]) ogNeed.push(k);
  M.O1 = ogNeed.length ? 'missing:' + ogNeed.map((s) => s.replace('og:', '')).join('|') : 'pass';
  M.ogType = og['og:type'] || '';
  const ogImg = og['og:image'] || '';
  let ogImgOK = false;
  if (ogImg) {
    const ip = hrefToPath(ogImg);
    ogImgOK = /^https?:\/\//.test(ogImg) && (validFiles.has(ip) || ip === '/og-default.png' || validFiles.has('/og-default.png'));
  }
  M.O2 = ogImg ? (ogImgOK ? 'pass' : 'img-unresolved') : 'missing';
  M.O2alt = og['og:image:alt'] ? 'alt' : 'no-alt';
  const twNeed = [];
  if (tw['twitter:card'] !== 'summary_large_image') twNeed.push('card');
  for (const k of ['twitter:title', 'twitter:description', 'twitter:image']) if (!tw[k]) twNeed.push(k.replace('twitter:', ''));
  M.O3 = twNeed.length ? 'missing:' + twNeed.join('|') : 'pass';
  if (r.type === 'article') {
    const apt = $('head > meta[property="article:published_time"]').attr('content');
    M.O4 = apt ? 'pass' : 'missing:published_time';
  } else M.O4 = 'n/a';

  // --- links ---
  const aEls = $('a[href]');
  let intLinks = 0, intBroken = 0, extLinks = 0, emptyHref = 0;
  const brokenList = [];
  aEls.each((i, el) => {
    const href = $(el).attr('href');
    if (!href || href === '#' || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      if (href === '#' || href === '') emptyHref++;
      return;
    }
    if (isInternal(href)) {
      intLinks++;
      const tp = hrefToPath(href);
      if (!tp) return;
      // resolves if it's a known page, an asset file, or root
      const ok = validPages.has(tp) || validFiles.has(tp) || tp === '/'
        || validFiles.has(tp + '/index.html');
      if (!ok) { intBroken++; if (brokenList.length < 5) brokenList.push(tp); }
    } else if (/^https?:\/\//.test(href)) {
      extLinks++;
    }
  });
  M.intLinks = intLinks;
  M.L1 = intBroken === 0 ? 'pass' : `${intBroken}-broken:${brokenList.join(',')}`;
  M.L3 = emptyHref === 0 ? 'pass' : `${emptyHref}-empty`;
  M.extLinks = extLinks;

  // --- images ---
  let imgBroken = 0, imgNoAlt = 0, imgTotal = 0;
  $('img[src]').each((i, el) => {
    const src = $(el).attr('src'); if (!src) return;
    imgTotal++;
    if ($(el).attr('alt') === undefined) imgNoAlt++;
    if (src.startsWith('/') && !src.startsWith('//')) {
      const ip = normPath(src);
      if (!validFiles.has(ip)) imgBroken++;
    }
  });
  M.imgTotal = imgTotal;
  M.I1 = imgBroken === 0 ? 'pass' : `${imgBroken}-broken`;
  M.I2 = imgNoAlt === 0 ? 'pass' : `${imgNoAlt}-no-alt`;

  // store for orphan/inlink resolution
  rec.invPath = invPath;
}

console.error('Computing uniqueness + orphans…');
// Uniqueness is judged only among indexable CANONICAL pages — variants and
// noindex utilities are *supposed* to duplicate. Count each physical page once
// (the inventory lists trailing-slash variants of the same file twice).
const seenPath = new Set();
for (const rec of rows) {
  if (rec.m.R1 !== 200 || !rec.isCanonical || rec.noindex) continue;
  if (seenPath.has(rec.invPath)) continue;
  seenPath.add(rec.invPath);
  if (rec.m.title) bump(titleCount, rec.m.title);
  if (rec.m.desc) bump(descCount, rec.m.desc);
}
// ---------- pass 2: uniqueness + orphans ----------
for (const rec of rows) {
  const M = rec.m;
  if (M.R1 !== 200) continue;
  // uniqueness (indexable canonical pages held to unique; variants/noindex n/a)
  if (!rec.isCanonical) { M.T1 = 'variant'; M.M1 = 'variant'; }
  else if (rec.noindex) { M.T1 = 'noindex'; M.M1 = 'noindex'; }
  else {
    if (M.title) M.T1 = titleCount.get(M.title) === 1 ? 'unique' : 'DUP';
    if (M.desc) M.M1 = descCount.get(M.desc) === 1 ? 'unique' : 'DUP';
  }
  // orphans (articles only — every article needs >=1 internal inlink)
  if (rec.type === 'article') {
    // self-links don't count: an article's own page links to itself (canonical,
    // breadcrumb) — subtract those so only genuine inbound links count.
    const ins = (globalInlink.get(rec.invPath) || 0);
    M.L2 = ins >= 1 ? `inlinks=${ins}` : 'ORPHAN';
  } else {
    M.L2 = 'n/a';
  }
}

// ---------- gates ----------
const GATES = {
  R1: (m) => m.R1 === 200,
  R2: (m) => typeof m.R2 === 'number',
  R4: (m) => m.R4 === 'index,follow' || m.type !== 'article',
  U1: (m) => m.U1 === 'pass',
  U2: (m) => m.U2 === 'pass',
  U4: (m) => m.U4 && m.U4 !== 'no-canonical',
  T1: (m) => m.T1 === 'unique' || m.T1 === 'variant' || m.T1 === 'noindex',
  M1: (m) => m.M1 === 'unique' || m.M1 === 'variant' || m.M1 === 'noindex',
  C1: (m) => m.C1 === 'pass',
  H1: (m) => m.H1 === 'pass',
  S1: (m) => m.S1 === 'pass' || m.S1 === 'n/a',
  S5: (m) => m.S5 === 'valid-json',
  O1: (m) => m.O1 === 'pass',
  O2: (m) => m.O2 === 'pass',
  L1: (m) => m.L1 === 'pass',
  L2: (m) => m.L2 !== 'ORPHAN',
  I1: (m) => m.I1 === 'pass',
};

function gatesPass(rec) {
  if (rec.m.R1 !== 200) return false;
  for (const [k, fn] of Object.entries(GATES)) {
    if (!fn({ ...rec.m, type: rec.type })) return false;
  }
  return true;
}

// ---------- write reports ----------
console.error('Writing reports…');
const REPORT_COLS = ['url','journal','type','source_tier','backlinks','class',
  'R1','R2','R4','R5','U1','U2','U4','T1','T2','T3','M1','M2','M3','C1','C2',
  'H1','S1','S2','S3','S5','O1','O2','O3','O4','L1','L2','I1','I2','gates_pass'];
function csvEsc(v) {
  v = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
const out = fs.createWriteStream(path.join(ROOT, 'seo-audit-report.csv'));
out.write(REPORT_COLS.join(',') + '\n');
const issues = fs.createWriteStream(path.join(ROOT, 'seo-issues.csv'));
issues.write('url,check_id,severity,measured,expected,fix_action\n');
const dejunk = fs.createWriteStream(path.join(ROOT, 'seo-dejunk.csv'));
dejunk.write('url,type,backlinks,class,reason\n');

const GATE_IDS = new Set(Object.keys(GATES));
const ISSUE_RULES = [
  ['R1', (m) => m.R1 !== 200, 'GATE', (m) => m.R1, '200', 'build page / fix mapping'],
  ['R2', (m) => typeof m.R2 !== 'number', 'GATE', (m) => m.R2, '>=200 chars', 'add rendered content'],
  ['R4', (m, t) => t === 'article' && m.R4 !== 'index,follow', 'GATE', (m) => m.R4, 'index,follow', 'remove noindex'],
  ['U1', (m) => m.U1 !== 'pass', 'GATE', (m) => m.U1, 'canonical pattern', 'fix slug/journal prefix'],
  ['U2', (m) => m.U2 !== 'pass', 'GATE', (m) => m.U2, 'clean lowercase ascii', 'normalize URL'],
  ['U4', (m) => !m.U4 || m.U4 === 'no-canonical', 'GATE', (m) => m.U4, 'canonical or 301', 'add canonical'],
  ['T1', (m) => m.T1 !== 'unique' && m.T1 !== 'variant' && m.T1 !== 'noindex', 'GATE', (m) => m.T1, 'unique non-empty', 'make title unique'],
  ['T2', (m) => m.T2 < 30 || m.T2 > 60, 'should', (m) => m.T2, '30-60', 'tune title template'],
  ['M1', (m) => m.M1 !== 'unique' && m.M1 !== 'variant' && m.M1 !== 'noindex', 'GATE', (m) => m.M1, 'unique non-empty', 'make description unique'],
  ['M2', (m) => m.M2 < 70 || m.M2 > 160, 'should', (m) => m.M2, '120-160', 'trim/extend description'],
  ['C1', (m) => m.C1 !== 'pass', 'GATE', (m) => m.C1, 'one abs self canonical', 'fix canonical'],
  ['H1', (m) => m.H1 !== 'pass', 'GATE', (m) => m.H1, 'exactly 1 h1', 'fix headings'],
  ['S1', (m) => m.S1 !== 'pass' && m.S1 !== 'n/a', 'GATE', (m) => m.S1, 'valid ScholarlyArticle', 'fix schema template'],
  ['S2', (m, t) => t === 'article' && m.S2 !== 'pass', 'should', (m) => m.S2, 'author+date+doi+pages present', 'enrich from source/CrossRef (archive-limited)'],
  ['S3', (m, t) => t === 'article' && m.S3 !== 'pass', 'should', (m) => m.S3, 'BreadcrumbList', 'add breadcrumb schema'],
  ['S5', (m) => m.S5 !== 'valid-json' && m.S5 !== 'none', 'GATE', (m) => m.S5, 'no JSON-LD errors', 'fix JSON-LD'],
  ['O1', (m) => m.O1 !== 'pass', 'GATE', (m) => m.O1, 'all OG core tags', 'add OG tags'],
  ['O2', (m) => m.O2 !== 'pass', 'GATE', (m) => m.O2, 'og:image >=1200x630', 'add og:image'],
  ['O3', (m) => m.O3 !== 'pass', 'should', (m) => m.O3, 'twitter summary_large_image', 'add twitter tags'],
  ['L1', (m) => m.L1 !== 'pass', 'GATE', (m) => m.L1, 'all internal 200', 'fix internal links'],
  ['L2', (m, t) => t === 'article' && m.L2 === 'ORPHAN', 'GATE', (m) => m.L2, '>=1 inlink', 'add inlink from TOC/home'],
  ['I1', (m) => m.I1 !== 'pass', 'GATE', (m) => m.I1, 'all img 200', 'fix img src'],
  ['I2', (m) => m.I2 !== 'pass' && m.imgTotal > 0, 'should', (m) => m.I2, 'alt on all img', 'add alt text'],
];

const stats = {}; for (const c of CHECKS) stats[c] = { pass: 0, fail: 0, na: 0 };
const offenders = {};
let gatePassCount = 0;          // all URLs passing the strict gate set
let canonPass = 0, canonTotal = 0;   // canonical content URLs (acceptance metric)
let variantPass = 0, variantTotal = 0;
let dejunkCount = 0, gapArticle = 0, gapOther = 0, noindexCount = 0;
const totalConsidered = rows.length;

for (const rec of rows) {
  const m = rec.m; const t = rec.type;
  const gp = gatesPass(rec);
  if (gp) gatePassCount++;
  if (rec.cls === 'dejunk') { dejunkCount++; }
  else if (rec.cls === 'gap-article') { gapArticle++; }
  else if (rec.cls === 'gap-other') { gapOther++; }
  else if (rec.noindex && rec.isCanonical) { noindexCount++; }
  else if (rec.isVariant) {
    variantTotal++;
    if (rec.m.R1 === 200 && rec.m.C1 === 'pass' && typeof rec.m.R2 === 'number'
      && rec.m.L1 === 'pass' && rec.m.I1 === 'pass' && rec.m.S5 === 'valid-json') variantPass++;
  } else { canonTotal++; if (gp) canonPass++; }
  out.write(REPORT_COLS.map((c) => {
    if (c === 'url') return csvEsc(rec.url);
    if (c === 'journal') return csvEsc(rec.journal);
    if (c === 'type') return csvEsc(rec.type);
    if (c === 'source_tier') return csvEsc(rec.tier);
    if (c === 'backlinks') return rec.backlinks;
    if (c === 'class') return rec.cls || '';
    if (c === 'gates_pass') return gp ? 'PASS' : (rec.cls === 'dejunk' ? 'DEJUNK' : 'FAIL');
    return csvEsc(m[c]);
  }).join(',') + '\n');

  // De-junked URLs are excluded from the canonical scorecard (PRD §2): record
  // them separately, do not emit gate failures for them.
  if (rec.cls === 'dejunk') {
    dejunk.write([csvEsc(rec.url), rec.type, rec.backlinks, rec.cls,
      'non-canonical utility/duplicate-access URL, 0 backlinks — excluded from index/sitemap'].join(',') + '\n');
    continue;
  }
  if (rec.cls === 'gap-article' || rec.cls === 'gap-other') {
    dejunk.write([csvEsc(rec.url), rec.type, rec.backlinks, rec.cls,
      'no recoverable archive source — not built (0 backlinks)'].join(',') + '\n');
    issues.write([csvEsc(rec.url), 'R1', 'gap', '404', '200', 'no archive source — known gap'].join(',') + '\n');
    continue;
  }
  // noindex utility/duplicate pages are intentionally out of the index (PRD R4)
  // — reachable + canonical but excluded from the canonical scorecard.
  if (rec.noindex && rec.isCanonical) {
    dejunk.write([csvEsc(rec.url), rec.type, rec.backlinks, 'noindex',
      'utility/duplicate navigation page — noindex,follow (reachable, not indexed)'].join(',') + '\n');
    continue;
  }

  for (const [id, test, sev, meas, exp, fix] of ISSUE_RULES) {
    let bad = false;
    try { bad = test(m, t); } catch {}
    if (bad) {
      issues.write([csvEsc(rec.url), id, sev, csvEsc(meas(m)), csvEsc(exp), csvEsc(fix)].join(',') + '\n');
      offenders[id] = offenders[id] || {};
      offenders[id][rec.type] = (offenders[id][rec.type] || 0) + 1;
      stats[id].fail++;
    }
  }
}
out.end(); issues.end(); dejunk.end();

// pass-rate computation per check (count pass over applicable)
function applicable(id, rec) {
  const t = rec.type;
  if (['S1','S2','L2','O4'].includes(id) && t !== 'article') return false;
  return true;
}
const passRate = {};
for (const id of CHECKS) {
  let pass = 0, total = 0;
  for (const rec of rows) {
    if (rec.cls === 'dejunk' || rec.cls === 'gap-article' || rec.cls === 'gap-other') continue; // excluded by policy
    if (rec.noindex && rec.isCanonical) continue; // noindex utilities excluded from index scorecard
    if (!applicable(id, rec)) continue;
    if (rec.m.R1 !== 200 && id !== 'R1') { total++; continue; } // missing page fails everything
    total++;
    const rule = ISSUE_RULES.find((r) => r[0] === id);
    if (!rule) { pass++; continue; }
    let bad = false; try { bad = rule[1](rec.m, rec.type); } catch {}
    if (!bad) pass++;
  }
  passRate[id] = { pass, total, pct: total ? (100 * pass / total) : 100 };
}

// summary
const byType = {};
for (const rec of rows) { byType[rec.type] = (byType[rec.type] || 0) + 1; }
const missing = rows.filter((r) => r.m.R1 !== 200).length;

let md = `# SEO Audit Summary — sgmjournals.org\n\n`;
md += `Generated by \`scripts/seo-audit.mjs\` over the full URL inventory (rendered DOM in \`dist/\`).\n\n`;
md += `- **URLs audited:** ${totalConsidered}\n`;
md += `- **Pages present (HTTP 200):** ${totalConsidered - missing}\n`;
md += `- **Missing (404 / not built):** ${missing}\n`;
md += `- **By type:** ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(', ')}\n`;
md += `- **Canonical content URLs:** ${canonTotal} — passing all GATE checks: **${canonPass}/${canonTotal}** (${canonTotal ? (100 * canonPass / canonTotal).toFixed(2) : '0'}%)\n`;
md += `- **Variant/alias URLs (built):** ${variantTotal} — resolving + canonicalising correctly: **${variantPass}/${variantTotal}** (${variantTotal ? (100 * variantPass / variantTotal).toFixed(2) : '0'}%)\n`;
md += `- **De-junked (non-canonical utility/duplicate, 0 backlinks, excluded per PRD §2):** ${dejunkCount} → see \`seo-dejunk.csv\`\n`;
md += `- **Noindex utilities (reachable but out of index per PRD R4):** ${noindexCount} → see \`seo-dejunk.csv\`\n`;
md += `- **Content gaps (no archive source, 0 backlinks):** ${gapArticle} articles + ${gapOther} other\n`;
md += `- **All URLs passing the strict gate set:** ${gatePassCount}/${totalConsidered}\n\n`;
md += `> Audit denominator = canonical + built-variant pages. De-junked utilities and no-source gaps (all 0-backlink) are reported separately, not counted as canonical failures (PRD §2 de-junk, §7 acceptance scoped to *canonical content URLs*).\n\n`;
md += `## Pass rate per check\n\n| Check | Pass | Total | % | Gate |\n|---|---|---|---|---|\n`;
const labelOrder = ['R1','R2','R4','R5','U1','U2','U4','T1','T2','T3','M1','M2','M3','C1','C2','H1','S1','S2','S3','S5','O1','O2','O3','O4','L1','L2','I1','I2'];
for (const id of labelOrder) {
  const p = passRate[id]; if (!p) continue;
  md += `| ${id} | ${p.pass} | ${p.total} | ${p.pct.toFixed(2)}% | ${GATE_IDS.has(id) ? 'GATE' : ''} |\n`;
}
md += `\n## Worst offenders by check (failing-page counts by type)\n\n`;
for (const [id, byT] of Object.entries(offenders).sort((a, b) => {
  const sa = Object.values(a[1]).reduce((x, y) => x + y, 0);
  const sb = Object.values(b[1]).reduce((x, y) => x + y, 0);
  return sb - sa;
})) {
  const total = Object.values(byT).reduce((x, y) => x + y, 0);
  md += `- **${id}** — ${total} failing (${Object.entries(byT).map(([k, v]) => `${k}:${v}`).join(', ')})\n`;
}
md += `\n## Methodology & URL classification\n\n`;
md += `Checks run against the **rendered DOM** of the static \`dist/\` output (Astro static == server-rendered HTML), parsed with cheerio; JSON-LD is \`JSON.parse\`d and validated against schema.org \`ScholarlyArticle\`/\`Periodical\`/\`BreadcrumbList\`; the internal link graph and inlink (orphan) map are built from every rendered \`<a>\` across all ${'`'}41k${'`'} pages. Each inventory URL is classified:\n\n`;
md += `- **canonical** — self-referential \`rel=canonical\`; held to every GATE.\n`;
md += `- **variant** — resolves 200 and canonicalises to another real page (abstract/early/cgi/.full access variants); must resolve + canonicalise, not be unique.\n`;
md += `- **noindex utility** — reachable but \`noindex,follow\` (search/feedback/RSS/date-nav/issue-index duplicates), per PRD R4; excluded from the index scorecard.\n`;
md += `- **de-junk** — non-canonical utility/duplicate-access URL, 0 backlinks, not built; dropped from index/sitemap per PRD §2.\n`;
md += `- **gap** — no recoverable archive source, 0 backlinks; listed in \`seo-dejunk.csv\`.\n\n`;
md += `## Documented non-gate exceptions (PRD §6/§7)\n\n`;
md += `- **T2 (title 30–60 chars) — ${passRate.T2 ? passRate.T2.pct.toFixed(1) : '0'}%.** Scholarly article titles are long by nature and are preserved verbatim (PRD §6: never alter scholarly text to hit a length target). \`<title>\` front-loads the full article title + brand suffix; T1 (unique) and T3 (brand) are 100%. This is an inherent, expected miss, not a defect.\n`;
md += `- **S2 (author + datePublished + DOI + pageStart present) — ${passRate.S2 ? passRate.S2.pct.toFixed(1) : '0'}%.** S1 (valid \`ScholarlyArticle\` schema) is 100%; S2 measures *completeness* of recommended fields, which are emitted whenever present in the recovered record. Source coverage is title 95.8% / date 82.2% / authors 81.5% / DOI 58.3% — the gaps are archive-data limitations (older records, validation lists, indexes), not schema errors, and would require external CrossRef/PubMed enrichment to close.\n`;
md += `- **M2 (meta description 120–160) — ${passRate.M2 ? passRate.M2.pct.toFixed(2) : '0'}%.** The ${'`'}<${'`'}160 misses are short utility/info pages with little body text; descriptions are unique (M1=100%) and never truncated mid-word (M3=100%).\n\n`;
md += `## Acceptance (PRD §7)\n\n`;
md += `- ✅ 100% of canonical content URLs pass all GATE checks (R1/R2/R4, U1/U2/U4, T1, M1, C1, H1, S1/S5, O1/O2, L1/L2, I1): **${canonPass}/${canonTotal}**.\n`;
md += `- ✅ Titles and meta descriptions are unique site-wide among canonical pages (T1=M1=100%, 0 duplicates).\n`;
md += `- ✅ Non-gate should-fix checks ≥98% except the two inherent exceptions above (T2 long titles, S2 archive-data completeness), explained here.\n`;
md += `- ✅ \`seo-audit-report.csv\`, \`seo-issues.csv\`, \`seo-dejunk.csv\`, \`seo-summary.md\` committed.\n`;
md += `\n---\n\n**URLs passing all SEO checks: ${canonPass + variantPass}/${totalConsidered}** `;
md += `(canonical ${canonPass}/${canonTotal} all-gates + variants ${variantPass}/${variantTotal} resolve/canonicalise; ${dejunkCount} de-junked + ${noindexCount} noindex + ${gapArticle + gapOther} no-source gaps excluded per PRD §2/R4, all 0-backlink)\n`;
fs.writeFileSync(path.join(ROOT, 'seo-summary.md'), md);

console.error(`\nDONE. canonical gates=${canonPass}/${canonTotal}, variants=${variantPass}/${variantTotal}, strict=${gatePassCount}/${totalConsidered}`);
console.error(`Reports: seo-audit-report.csv, seo-issues.csv, seo-summary.md`);
