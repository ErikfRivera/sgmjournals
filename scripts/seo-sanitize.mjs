// SEO content sanitiser — repairs the dead HighWire link/image debris embedded
// in recovered article HTML so the link graph (L1) and images (I1) pass.
//
//  • /cgi/external_ref?...link_type=DOI&access_num=10.x  → https://doi.org/10.x
//  • /cgi/external_ref?...link_type=MED|PUBMED|MEDLINE    → https://pubmed.ncbi.nlm.nih.gov/<id>/
//  • /cgi/ijlink?...journalCode=XX&resid=V/I/P            → internal /<code>/content/V/I/P (if it exists)
//  • any other dead /cgi/*, /misc/*, root /content/* anchor → unwrapped to plain text
//  • <img> with an unrecoverable (non-/assets) src           → removed
//
// Operates in place on src/data/generated/pages/**/*.json (git is the backup).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const PAGES = path.join(ROOT, 'src', 'data', 'generated', 'pages');
const HTML_FIELDS = ['bodyHtml', 'abstractHtml', 'summaryHtml', 'referencesHtml',
  'introHtml', 'affiliationsHtml', 'correspHtml'];

const JCODE = { mic: 'mic', micro: 'mic', vir: 'vir', jgv: 'vir', ijs: 'ijs',
  ijsb: 'ijs', ijsem: 'ijs', jmm: 'jmm', jmmcr: 'jmmcr', mgen: 'mgen' };

function walk(dir) {
  const out = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const s = fs.statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (n.endsWith('.json')) out.push(p);
  }
  return out;
}

// Build the set of valid internal paths: generated slugs ∪ the current dist
// page set (covers Astro-routed pages /about/*, /search, journal homes, TOCs).
console.error('Indexing valid paths…');
const files = walk(PAGES);
const validPaths = new Set();
for (const f of files) {
  try {
    const e = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (e.slug) validPaths.add('/' + e.slug.replace(/^\/+/, ''));
  } catch {}
}
const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  const stack = [DIST];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) stack.push(fp);
      else if (e.name === 'index.html') {
        let rel = '/' + path.relative(DIST, fp).split(path.sep).join('/').replace(/\/index\.html$/, '');
        if (rel.length > 1 && rel.endsWith('/')) rel = rel.slice(0, -1);
        validPaths.add(rel || '/');
      }
    }
  }
}
console.error(`indexed ${validPaths.size} valid paths across ${files.length} data files`);

function parseQuery(qs) {
  const out = {};
  for (const part of qs.split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).toLowerCase();
    let v = part.slice(i + 1);
    try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch {}
    out[k] = v;
  }
  return out;
}

function externalRefTarget(href) {
  const qi = href.indexOf('?');
  if (qi < 0) return null;
  const q = parseQuery(href.slice(qi + 1));
  const lt = (q.link_type || q.linktype || '').toUpperCase();
  const id = (q.access_num || q.access || '').trim();
  if (!id) return null;
  if (lt === 'DOI' || /^10\.\d{4,}\//.test(id)) return { url: 'https://doi.org/' + id, rel: 'nofollow noopener' };
  if (lt === 'MED' || lt === 'PUBMED' || lt === 'MEDLINE') return { url: 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/', rel: 'nofollow noopener' };
  if (lt === 'GEN' || lt === 'GENBANK' || lt === 'NUCLEOTIDE') return { url: 'https://www.ncbi.nlm.nih.gov/nuccore/' + encodeURIComponent(id), rel: 'nofollow noopener' };
  if (lt === 'PROTEIN') return { url: 'https://www.ncbi.nlm.nih.gov/protein/' + encodeURIComponent(id), rel: 'nofollow noopener' };
  return null; // ISI / GeoRef / unknown — caller will unwrap to text
}

function ijlinkTarget(href) {
  const qi = href.indexOf('?');
  if (qi < 0) return null;
  const q = parseQuery(href.slice(qi + 1));
  const code = JCODE[(q.journalcode || '').toLowerCase()];
  const resid = q.resid || '';
  if (!code || !resid) return null;
  const p = `/${code}/content/${resid.replace(/^\/+/, '')}`;
  return validPaths.has(p) ? p : null; // only link if the target page exists
}

let changedFiles = 0, refFixed = 0, ijFixed = 0, unwrapped = 0, imgsRemoved = 0;

function resolvesInternally(href) {
  // strip query/hash, normalise; a link is "live" if it hits a real generated
  // page or an /assets|/deliver|/docserver asset path.
  let p = href.split('#')[0].split('?')[0];
  try { p = decodeURIComponent(p); } catch {}
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p === '' || p === '/') return true;
  if (/^\/(assets|deliver|docserver|favicon|_astro)\b/.test(p)) return true;
  return validPaths.has(p);
}

function sanitizeHtml(html) {
  if (!html || (!/<a\s/i.test(html) && !html.includes('<img'))) return html;
  const $ = cheerio.load(html, null, false);
  let touched = false;

  $('a[href]').each((i, el) => {
    const raw = $(el).attr('href') || '';
    const decoded = raw.replace(/&amp;/g, '&');
    // external_ref (any prefix / hyphen or underscore variant)
    if (/external[_-]ref\?/.test(decoded)) {
      const t = externalRefTarget(decoded);
      if (t) { $(el).attr('href', t.url).attr('rel', t.rel); refFixed++; }
      else { $(el).replaceWith($(el).contents()); unwrapped++; }
      touched = true; return;
    }
    if (/ijlink\?/.test(decoded)) {
      const p = ijlinkTarget(decoded);
      if (p) { $(el).attr('href', p).removeAttr('rel'); ijFixed++; }
      else { $(el).replaceWith($(el).contents()); unwrapped++; }
      touched = true; return;
    }
    // keep good absolute links and anchors/mailto/tel untouched
    if (/^https?:\/\//i.test(decoded) || /^(mailto:|tel:|#)/.test(decoded)) return;
    // root-relative internal link: keep only if it resolves to a real page/asset
    if (decoded.startsWith('/') && !decoded.startsWith('//')) {
      if (!resolvesInternally(decoded)) { $(el).replaceWith($(el).contents()); unwrapped++; touched = true; }
      return;
    }
    // bare hostname / relative junk (e.g. "genolist.Pasteur.fr/...", "external-ref?…")
    // — these never resolve as a clean URL; drop the link, keep the text.
    $(el).replaceWith($(el).contents()); unwrapped++; touched = true;
  });

  $('img[src]').each((i, el) => {
    const src = $(el).attr('src') || '';
    // keep recovered assets and absolute https images; drop unrecoverable
    // root-relative HighWire figure/equation refs (no asset on disk).
    if (src.startsWith('/') && !src.startsWith('//') && !src.startsWith('/assets/')) {
      $(el).remove(); imgsRemoved++; touched = true;
    } else if (!/^https?:\/\//i.test(src) && !src.startsWith('/') && !src.startsWith('data:')) {
      $(el).remove(); imgsRemoved++; touched = true;
    }
  });

  return touched ? $.html() : html;
}

console.error('Sanitising…');
let n = 0;
for (const f of files) {
  n++;
  if (n % 5000 === 0) console.error(`  ${n}/${files.length}`);
  let e;
  try { e = JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { continue; }
  let dirty = false;
  for (const field of HTML_FIELDS) {
    if (typeof e[field] === 'string' && e[field]) {
      const out = sanitizeHtml(e[field]);
      if (out !== e[field]) { e[field] = out; dirty = true; }
    }
  }
  if (dirty) { fs.writeFileSync(f, JSON.stringify(e)); changedFiles++; }
}

console.error(`\nDONE. files changed: ${changedFiles}`);
console.error(`  external_ref→doi/pubmed: ${refFixed}`);
console.error(`  ijlink→internal: ${ijFixed}`);
console.error(`  dead anchors unwrapped: ${unwrapped}`);
console.error(`  broken images removed: ${imgsRemoved}`);
