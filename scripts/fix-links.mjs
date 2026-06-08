#!/usr/bin/env node
// Post-pass: sanitize in-body links across all generated entries so the build
// has zero broken internal links (QA gate A-2).
//  - normalize HighWire article cross-links (cgi/content/*, cgi/reprint,
//    /content/V/I/P.<variant>) to the canonical /<journal>/content/<V/I/P>
//  - keep external links (http/https/ftp/mailto) as-is
//  - unwrap any remaining internal link whose target is not a built page
//    (leftover HighWire chrome: cgi tools, lookup, adclick, help, misc, etc.)
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { DATA_DIR, PUBLIC_DIR } from './lib/paths.mjs';
import { JOURNAL_ORDER } from '../src/lib/journals.js';

const PAGES_DIR = path.join(DATA_DIR, 'pages');

// ---- build the set of resolvable in-site paths -----------------------------
const resolvable = new Set(['/', '/search', '/about', '/about/for-authors', '/about/for-reviewers', '/about/open-access', '/about/subscriptions', '/about/contact']);
for (const j of JOURNAL_ORDER) resolvable.add(`/${j}/cgi/pmidlookup`);
const fileSet = new Set();
(function walkPages(dir, rel) {
  for (const n of fs.readdirSync(dir)) {
    const a = path.join(dir, n); const st = fs.statSync(a);
    if (st.isDirectory()) walkPages(a, rel + '/' + n);
    else if (n.endsWith('.json')) resolvable.add((rel + '/' + n.replace(/\.json$/, '')) || '/');
  }
})(PAGES_DIR, '');
(function walkPublic(dir, rel) {
  for (const n of fs.readdirSync(dir)) {
    if (n === 'assets') { // index asset files
      (function wa(d, r) { for (const m of fs.readdirSync(d)) { const a = path.join(d, m); const s = fs.statSync(a); if (s.isDirectory()) wa(a, r + '/' + m); else fileSet.add(r + '/' + m); } })(path.join(dir, n), rel + '/assets');
      continue;
    }
    const a = path.join(dir, n); const st = fs.statSync(a);
    if (st.isDirectory()) walkPublic(a, rel + '/' + n);
    else fileSet.add(rel + '/' + n);
  }
})(PUBLIC_DIR, '');

const norm = (p) => { p = p.replace(/\/+$/, ''); return p === '' ? '/' : p; };
function isResolvable(p) {
  if (fileSet.has(p)) return true;
  const q = norm(p);
  return resolvable.has(q) || fileSet.has(q);
}

// A link is truly external only if it has a real scheme, or is protocol-relative
// (//host/…) with a real domain (a dotted host). A "//misc/forms.xhtml"-style
// link points at a bogus host ("misc") — a mangled internal link, not external.
function isExternal(href) {
  if (/^(https?:|ftp:|mailto:|tel:|#|data:)/i.test(href)) return true;
  if (/^\/\//.test(href)) return href.slice(2).split(/[/?#]/)[0].includes('.');
  return false;
}

const stripVar = (s) => s.replace(/\.(full\.pdf\+html|full\.pdf|full|abstract|short|long|pdf)$/i, '').replace(/\/+$/, '');
function normalizeHref(href) {
  let m;
  // /<j>/cgi/content/(full|abstract|short|long)/REST -> /<j>/content/REST
  if ((m = href.match(/^\/([a-z]+)\/cgi\/content\/(?:full|abstract|short|long)\/(.+)$/))) return `/${m[1]}/content/${stripVar(m[2])}`;
  if ((m = href.match(/^\/([a-z]+)\/cgi\/reprintframed?\/(.+)$/))) return `/${m[1]}/content/${stripVar(m[2])}`;
  if ((m = href.match(/^\/([a-z]+)\/cgi\/reprint\/(.+)$/))) return `/${m[1]}/content/${stripVar(m[2])}`;
  // /<j>/content/REST.<variant> -> /<j>/content/REST
  if ((m = href.match(/^\/([a-z]+)\/content\/(.+)$/))) return `/${m[1]}/content/${stripVar(m[2])}`;
  return href;
}

const FIELDS = ['bodyHtml', 'abstractHtml', 'referencesHtml', 'affiliationsHtml', 'correspHtml'];
let entriesChanged = 0, linksKept = 0, linksNormalized = 0, linksUnwrapped = 0;

let imgsDropped = 0;
let h1sDemoted = 0;
function processField(htmlStr) {
  if (!htmlStr || (!htmlStr.includes('<a') && !htmlStr.includes('<img') && !/<h1[\s>]/i.test(htmlStr))) return htmlStr;
  const $ = cheerio.load(htmlStr, null, false);
  let changed = false;
  // The page layout already renders the single <h1> (entry.title). Any <h1>
  // inside recovered body content would make a second top-level heading, so
  // demote it to <h2> to keep one logical heading root per page.
  $('h1').each((_, el) => { el.tagName = 'h2'; changed = true; h1sDemoted++; });
  // drop broken internal images (chrome icons/spacers/banners not in output)
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (/^(https?:|data:|\/\/)/i.test(src)) return;
    if (!isResolvable(src.split('#')[0].split('?')[0])) { $(el).remove(); changed = true; imgsDropped++; }
  });
  $('a[href]').each((_, el) => {
    const $a = $(el);
    let href = $a.attr('href');
    if (isExternal(href)) { linksKept++; return; } // external/anchor
    if (!href.startsWith('/')) { $a.replaceWith($a.html() || $a.text()); changed = true; linksUnwrapped++; return; } // junk (C:\, bare host)
    const bare = href.split('#')[0].split('?')[0];
    const normd = normalizeHref(bare);
    if (isResolvable(normd)) {
      if (normd !== href) { $a.attr('href', normd); changed = true; linksNormalized++; } else linksKept++;
    } else {
      $a.replaceWith($a.html() || $a.text()); changed = true; linksUnwrapped++;
    }
  });
  // <area href> image-map links (leftover HighWire "home_button" chrome): an
  // area with a dead internal href is still a broken link. Normalize if it
  // resolves; otherwise drop the element (a hrefless area is meaningless).
  $('area[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href');
    if (isExternal(href)) { linksKept++; return; }
    const bare = href.split('#')[0].split('?')[0];
    const normd = normalizeHref(bare);
    if (href.startsWith('/') && isResolvable(normd)) {
      if (normd !== href) { $a.attr('href', normd); changed = true; linksNormalized++; } else linksKept++;
    } else { $a.remove(); changed = true; linksUnwrapped++; }
  });
  return changed ? $.html() : htmlStr;
}

(function walk(dir) {
  for (const n of fs.readdirSync(dir)) {
    const a = path.join(dir, n); const st = fs.statSync(a);
    if (st.isDirectory()) { walk(a); continue; }
    if (!n.endsWith('.json')) continue;
    const e = JSON.parse(fs.readFileSync(a, 'utf-8'));
    let changed = false;
    for (const f of FIELDS) {
      if (e[f]) { const nv = processField(e[f]); if (nv !== e[f]) { e[f] = nv; changed = true; } }
    }
    if (changed) { fs.writeFileSync(a, JSON.stringify(e)); entriesChanged++; }
  }
})(PAGES_DIR);

console.log(`fix-links: entries changed ${entriesChanged}; links normalized ${linksNormalized}, kept ${linksKept}, unwrapped ${linksUnwrapped}, imgs dropped ${imgsDropped}`);
