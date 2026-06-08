// Regenerate sitemap.xml from the built site: include every self-canonical,
// indexable page (articles, journal homes, volume/issue TOCs, real info pages)
// and exclude variants (canonical → elsewhere) and de-junked utilities.
// Writes both public/sitemap.xml (repo, served by Vercel) and dist/sitemap.xml.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const DIST = path.join(ROOT, 'dist');
const SITE = 'https://www.sgmjournals.org';

function norm(p) { if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1); return p || '/'; }

const urls = [];
let scanned = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp);
    else if (e.name === 'index.html') {
      scanned++;
      const rel = '/' + path.relative(DIST, fp).split(path.sep).join('/').replace(/\/index\.html$/, '').replace(/^index\.html$/, '');
      const self = norm(rel === '/' || rel === '' ? '/' : rel);
      const html = fs.readFileSync(fp, 'utf-8');
      const $ = cheerio.load(html);
      const robots = ($('head > meta[name="robots"]').attr('content') || '').toLowerCase();
      if (robots.includes('noindex')) continue;
      const canon = $('head > link[rel="canonical"]').attr('href') || '';
      let cp = '';
      try { cp = norm(new URL(canon).pathname); } catch { continue; }
      if (cp !== self) continue;            // variant → excluded
      urls.push(SITE + (self === '/' ? '/' : self));
    }
  }
}
walk(DIST);
urls.sort();

const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + urls.map((u) => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('\n')
  + `\n</urlset>\n`;

fs.writeFileSync(path.join(ROOT, 'public', 'sitemap.xml'), body);
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), body);
console.error(`Scanned ${scanned} pages → sitemap with ${urls.length} canonical URLs.`);
