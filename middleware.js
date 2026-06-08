// Vercel Edge Middleware — normalization safety net for corrupt inbound URLs.
//
// Normal URLs (clean article, .full, .abstract, cgi/content/*, cgi/reprint,
// .full.pdf) are REAL pages and pass straight through. This only fires on
// percent-encoded junk paths — wiki dead-link markup, citation-tool artifacts,
// trailing spaces/brackets — and 308s them to the clean canonical article URL
// so no inbound backlink dead-ends.
export const config = {
  matcher: ['/((?!_astro/|assets/|favicon).*)'],
};

// A clean path contains only filesystem-safe chars; junk paths carry %-encoding.
const SAFE = /^\/[A-Za-z0-9._~+/-]*$/;
const VARIANT = /\.(full\.pdf\+html|full\.pdf|full|abstract|short|long|pdf)$/i;

function canonical(p) {
  let c = p.split(/[^A-Za-z0-9._~+/-]/)[0]; // cut at first hostile char
  c = c.replace(/^(\/[a-z]+)\/cgi\/content\/(?:full|abstract|short|long)\//, '$1/content/')
       .replace(/^(\/[a-z]+)\/cgi\/reprintframed?\//, '$1/content/')
       .replace(/^(\/[a-z]+)\/cgi\/reprint\//, '$1/content/')
       .replace(/^(\/[a-z]+)\/cgi\/doi\/[^/]+\//, '$1/content/');
  return c.replace(VARIANT, '').replace(/\/+$/, '');
}

export default function middleware(request) {
  const url = new URL(request.url);
  if (SAFE.test(url.pathname)) return; // clean path (incl. real cgi pages) -> serve directly
  let decoded;
  try { decoded = decodeURIComponent(url.pathname); } catch { decoded = url.pathname; }
  const clean = canonical(decoded);
  if (!clean || clean === url.pathname || clean === decoded.replace(/\/+$/, '')) return;
  return Response.redirect(new URL(clean, url).toString(), 308);
}
