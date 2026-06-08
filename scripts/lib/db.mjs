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

export function readHtml(row) {
  const f = fileForRow(row);
  if (!f || !fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf-8');
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
  // /assets/<journal><request_uri>
  const uri = row.request_uri.startsWith('/') ? row.request_uri : '/' + row.request_uri;
  const prefix = journal ? `/${journal}` : '';
  return `/assets${prefix}${uri}`;
}
