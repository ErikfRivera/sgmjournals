// Shared path / URL helpers for the ingest pipeline.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../..');
// The repo is cloned inside the cowork input directory, so the parent of the
// repo IS the input directory that holds the PRD, manifest and archive.
export const INPUT_ROOT = path.resolve(REPO_ROOT, '..');
export const ARCHIVE_ROOT = path.join(INPUT_ROOT, 'NWK0G2ISWAUU0C6K', 'sgmjournals.org');
export const CONTENT_DIR = path.join(ARCHIVE_ROOT, '.content.DFgjfXp1');
export const STRUCTURE_DB = path.join(CONTENT_DIR, 'structure.db');
export const MANIFEST_CSV = path.join(INPUT_ROOT, 'sgm_rebuild_manifest.csv');

export const DATA_DIR = path.join(REPO_ROOT, 'src', 'data', 'generated');
export const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
export const ASSETS_OUT = path.join(PUBLIC_DIR, 'assets');
export const PROGRESS_JSON = path.join(REPO_ROOT, 'progress.json');
export const REDIRECTS_FILE = path.join(PUBLIC_DIR, '_redirects');
export const UNBUILT_CSV = path.join(REPO_ROOT, 'unbuilt.csv');

// Resolve an archive_file path (relative to ARCHIVE_ROOT, as stored in the
// manifest like ".content.DFgjfXp1/html/<hash>.<serial>.html") to an absolute path.
export function resolveArchiveFile(relPath) {
  if (!relPath) return null;
  return path.join(ARCHIVE_ROOT, relPath);
}

// Map an archive hostname to the canonical journal path prefix.
// jgv -> vir, ijsb -> ijs; strip intl-/submit-/m. ; portal hosts -> '' (root).
export function hostToJournal(hostname) {
  if (!hostname) return '';
  let h = hostname.toLowerCase();
  // strip protocol-ish leftovers
  h = h.replace(/^https?:\/\//, '');
  // take the leftmost label before .sgmjournals.org
  const m = h.match(/^([^.]+(?:\.[^.]+)*)\.sgmjournals\.org$/);
  let sub = m ? m[1] : h.replace(/\.sgmjournals\.org$/, '');
  // strip known prefixes
  sub = sub.replace(/^intl-/, '').replace(/^submit-/, '').replace(/^m\./, '');
  const map = { jgv: 'vir', ijsb: 'ijs' };
  if (map[sub]) sub = map[sub];
  const journals = new Set(['vir', 'mic', 'ijs', 'jmm', 'jmmcr']);
  if (journals.has(sub)) return sub;
  // portal / society-wide hosts
  if (sub === 'sgmjournals' || sub === 'www' || sub === 'intl' || sub === '' || sub === 'sgmjournals.org') return '';
  return sub; // unknown; keep as-is so it's visible
}

// Convert a canonical_www_url (full https URL) to a site-relative slug
// with no leading or trailing slash. Root '/' -> ''.
export function urlToSlug(canonicalUrl) {
  try {
    const u = new URL(canonicalUrl);
    let p = u.pathname;
    p = p.replace(/^\/+/, '').replace(/\/+$/, '');
    return p;
  } catch {
    return String(canonicalUrl || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  }
}
