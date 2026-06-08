#!/usr/bin/env node
// Post-pass: give info pages accurate, unique <title>s and keep thin HighWire
// tool/feed endpoints out of the index.
//  - Substantial info pages whose recovered title was empty or just the journal
//    name (e.g. Instructions for Authors, Editorial Board, About) get a
//    descriptive title derived from their well-known HighWire filename, suffixed
//    with the journal name for cross-journal uniqueness.
//  - Thin interstitials (a "Logged" confirmation, RSS landings, citation-tool
//    and alert endpoints, near-empty pages) are marked stub -> noindex + dropped
//    from the sitemap. They keep resolving (200 + canonical); they just aren't
//    indexed.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './lib/paths.mjs';
import { JOURNALS } from '../src/lib/journals.js';

const PAGES_DIR = path.join(DATA_DIR, 'pages');

const LABELS = {
  ifora: 'Instructions for Authors',
  edboard: 'Editorial Board',
  boardmembers: 'Editorial Board Members',
  about: 'About the Journal',
  subonline: 'Subscribe Online',
  subscriptions: 'Subscriptions',
  self_archiving: 'Self-Archiving Policy',
  pip: 'Papers in Press',
  comments: 'Comments and Corrections',
  trial: 'Free Trial Access',
  terms: 'Terms and Conditions',
  impactfactor: 'Impact Factor',
  sample: 'Sample Issue',
  freeonlineaccess: 'Free Online Access',
  slow: 'Page Loading Help',
  feedback: 'Feedback',
};
// HighWire tool / feed / interstitial endpoints with no standalone content.
const TOOL = new Set([
  'external-ref', 'external_ref', 'rss', 'etoc', 'citemap', 'citmgr', 'mailafriend',
  'ctalert', 'ijlink', 'mfr1', 'mfc1', 'papbyrecent', 'papbysection', 'older', 'help',
]);

const journalName = (code) => (JOURNALS[code] ? JOURNALS[code].name : '');
const titleCase = (s) => s.replace(/[._-]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());

let titled = 0, stubbed = 0;
(function walk(dir) {
  for (const n of fs.readdirSync(dir)) {
    const a = path.join(dir, n); const st = fs.statSync(a);
    if (st.isDirectory()) { walk(a); continue; }
    if (!n.endsWith('.json')) continue;
    let e; try { e = JSON.parse(fs.readFileSync(a, 'utf-8')); } catch { continue; }
    if (e.type !== 'info-page') continue;
    const seg = (e.slug.split('/').pop() || '').replace(/\.(s?html|dtl|xhtml|xml)$/i, '').toLowerCase();
    const jn = journalName(e.journal);
    const t = (e.title || '').trim();
    const generic = !t || t === jn || /^logged$/i.test(t);
    const bodyLen = (e.bodyHtml || '').length;
    let changed = false;

    const isThin = /^logged$/i.test(t) || TOOL.has(seg) || bodyLen < 200;
    if (isThin && !e.stub) { e.stub = true; stubbed++; changed = true; }

    // Year-stamped impact-factor pages share the bare title "IJSEM impact
    // factor" across years; disambiguate with the year from the filename.
    const ifm = seg.match(/^impactfactor(\d{4})?$/);
    if (ifm) {
      const label = `Impact Factor${ifm[1] ? ' ' + ifm[1] : ''}`;
      const nt = jn ? `${label} — ${jn}` : label;
      if (nt !== e.title) { e.title = nt; titled++; changed = true; }
    } else if (generic) {
      const label = LABELS[seg] || (seg ? titleCase(seg) : 'Information');
      const nt = jn ? `${label} — ${jn}` : label;
      if (nt !== e.title) { e.title = nt; titled++; changed = true; }
    }
    if (changed) fs.writeFileSync(a, JSON.stringify(e));
  }
})(PAGES_DIR);
console.log(`fix-info-titles: retitled ${titled}; marked noindex-stub ${stubbed}`);
