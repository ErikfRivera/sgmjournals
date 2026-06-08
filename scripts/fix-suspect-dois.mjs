// One-off data fix for the 7 suspect DOIs surfaced by the SEO QA DOI audit
// (0.02% of canonical articles):
//   • 4 malformed DOIs carry an extraction-artifact space ("10.1099/mic.0. 2006/…")
//     → remove the space so the doi.org link resolves.
//   • 3 placeholder DOIs on retraction/erratum notices ("…/vir.0.X00002-0") never
//     resolve at doi.org → blank meta.doi (and the recovered placeholder in body
//     references) so we don't emit/link a dead DOI. These are publisher
//     placeholders with no reliably recoverable real value.
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.cwd(), 'src', 'data', 'generated', 'pages');
function walk(d){let o=[];for(const n of fs.readdirSync(d)){const p=path.join(d,n);const s=fs.statSync(p);if(s.isDirectory())o.push(...walk(p));else if(n.endsWith('.json'))o.push(p);}return o;}

const PLACEHOLDER = /\/[a-z]+\.\d+\.x\d+/i;          // …/vir.0.X00002-0
const HAS_SPACE   = /^10\.\d{4,}\/\S*\s\S/;          // "10.1099/mic.0. 2006/…"

let spaceFixed = 0, placeholderBlanked = 0;
const changed = [];

for (const f of walk(DIR)) {
  let e; try { e = JSON.parse(fs.readFileSync(f,'utf8')); } catch { continue; }
  if (e.type !== 'article' || e.alias) continue;
  const m = e.meta; if (!m || !m.doi) continue;
  const before = m.doi;
  let dirty = false;

  if (HAS_SPACE.test(m.doi)) {
    m.doi = m.doi.replace(/\s+/g, '');
    spaceFixed++; dirty = true;
    changed.push(`space:  ${e.slug}  "${before}" -> "${m.doi}"`);
  } else if (PLACEHOLDER.test(m.doi)) {
    // blank the unresolvable placeholder so no fake doi.org link/sameAs is emitted
    m.doi = '';
    placeholderBlanked++; dirty = true;
    changed.push(`blank:  ${e.slug}  "${before}" -> (removed)`);
  }

  if (dirty) fs.writeFileSync(f, JSON.stringify(e));
}

console.log(changed.join('\n'));
console.log(`\nmalformed DOIs de-spaced: ${spaceFixed}`);
console.log(`placeholder DOIs blanked: ${placeholderBlanked}`);
console.log(`total records changed:    ${spaceFixed + placeholderBlanked}`);
