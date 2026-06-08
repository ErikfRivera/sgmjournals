// structure.db access + asset resolution/copying.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { STRUCTURE_DB, CONTENT_DIR, ASSETS_OUT } from './paths.mjs';

let _db = null;
export function db() {
  if (!_db) {
    _db = new Database(STRUCTURE_DB, { readonly: true, fileMustExist: true });
    _db.pragma('journal_mode = OFF');
  }
  return _db;
}

const _lookupStmt = () =>
  db().prepare(
    'SELECT url, hostname, request_uri, folder, filename, mimetype, charset, redirect FROM structure WHERE hostname=? AND request_uri=? LIMIT 1'
  );
let _ls = null;
export function lookup(hostname, requestUri) {
  if (!_ls) _ls = _lookupStmt();
  return _ls.get(hostname, requestUri) || null;
}

// Try a few request_uri variants (with/without trailing slash, decoded).
export function lookupLoose(hostname, requestUri) {
  const tries = new Set([requestUri]);
  if (requestUri.endsWith('/')) tries.add(requestUri.slice(0, -1));
  else tries.add(requestUri + '/');
  try { tries.add(decodeURIComponent(requestUri)); } catch {}
  for (const t of tries) {
    const r = lookup(hostname, t);
    if (r) return r;
  }
  return null;
}

export function fileForRow(row) {
  if (!row || !row.folder || !row.filename) return null;
  return path.join(CONTENT_DIR, row.folder, row.filename);
}

// Decode archive bytes honoring the stored charset. Legacy HighWire pages are
// often windows-1250/1252; reading them as UTF-8 turns bytes like 0x92 (’) or
// 0xA3 (£) into U+FFFD. Honor the declared charset, and if a "utf-8" file still
// decodes with replacement chars, fall back to windows-1252.
export function decodeArchive(buf, declaredCharset) {
  let cs = String(declaredCharset || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  // WHATWG/ICU label aliases. 'ascii'/'iso-8859-1'/'latin1' all behave like
  // windows-1252 under the Encoding Standard; mac-centraleurope is unsupported
  // by Node's TextDecoder, so let scoring pick the best single-byte fallback.
  if (/^(ascii|us-ascii|iso-8859-1|latin1|cp1252)$/.test(cs)) cs = 'windows-1252';
  const tryDecode = (enc) => {
    try { return new TextDecoder(enc, { fatal: false }).decode(buf); } catch { return null; }
  };
  // A decode is "bad" by how many replacement chars (U+FFFD) or stray C1
  // control bytes (U+0080–U+009F, never legitimate text) it leaves behind —
  // both are symptoms of decoding legacy bytes with the wrong table.
  const score = (s) => {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0xfffd || (c >= 0x80 && c <= 0x9f)) n++;
    }
    return n;
  };
  const order = [];
  for (const e of [cs, 'utf-8', 'windows-1252', 'windows-1250']) {
    if (e && !order.includes(e)) order.push(e);
  }
  let best = null, bestScore = Infinity;
  for (const enc of order) {
    const d = tryDecode(enc);
    if (d == null) continue;
    const sc = score(d);
    if (sc < bestScore) { best = d; bestScore = sc; if (sc === 0) break; }
  }
  return best != null ? best : buf.toString('utf-8');
}

export function readHtml(row) {
  const f = fileForRow(row);
  if (!f || !fs.existsSync(f)) return null;
  return decodeArchive(fs.readFileSync(f), row && row.charset);
}

// Resolve a (possibly relative) asset src referenced inside an article to a
// structure row. baseHost/baseUri are the article's host + request_uri.
export function resolveAsset(baseHost, baseUri, src) {
  if (!src) return null;
  if (/^(data:|https?:\/\/|\/\/|#|mailto:)/i.test(src)) {
    // external/data/anchor — only handle if it's an sgmjournals absolute URL
    const m = src.match(/^https?:\/\/([^/]+)(\/[^?#]*)/i);
    if (m && m[1].endsWith('sgmjournals.org')) {
      return resolveAssetRow(m[1], m[2]);
    }
    return null;
  }
  // relative — resolve against base
  let abs;
  try {
    abs = new URL(src, `http://${baseHost}${baseUri}`);
  } catch {
    return null;
  }
  return resolveAssetRow(abs.hostname, abs.pathname);
}

function resolveAssetRow(host, uri) {
  const row = lookupLoose(host, uri);
  if (row) return row;
  return null;
}

// Copy an asset row's file into public/assets/<journal><request_uri>.
// Returns the new web path or null on failure.
export function copyAsset(row, journal) {
  const f = fileForRow(row);
  if (!f || !fs.existsSync(f)) return null;
  const webPath = assetWebPath(row, journal);
  const dest = path.join(ASSETS_OUT, webPath.replace(/^\/assets\//, ''));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) fs.copyFileSync(f, dest);
  return webPath;
}

export function assetWebPath(row, journal) {
  // /assets/<journal><request_uri> — strip any query/fragment so it never
  // becomes a "?"-named path on disk (breaks Astro's empty-dir cleanup).
  let uri = row.request_uri.replace(/[?#].*$/, '');
  if (!uri.startsWith('/')) uri = '/' + uri;
  const prefix = journal ? `/${journal}` : '';
  return `/assets${prefix}${uri}`;
}
