// HighWire HTML → structured content extractor (cheerio-based).
import * as cheerio from 'cheerio';
import { resolveAsset, copyAsset, lookupLoose } from './db.mjs';
import { hostToJournal } from './paths.mjs';

// ---- metadata -------------------------------------------------------------
export function extractMeta(html) {
  const $ = cheerio.load(html);
  const get = (name) => {
    const el = $(`meta[name="${name}"]`).first();
    return el.length ? (el.attr('content') || '').trim() : '';
  };
  const getAll = (name) =>
    $(`meta[name="${name}"]`)
      .map((_, e) => ($(e).attr('content') || '').trim())
      .get()
      .filter(Boolean);

  let authors = getAll('citation_author');
  if (!authors.length) authors = getAll('DC.Contributor');

  return {
    title: get('citation_title') || get('DC.Title') || ($('title').first().text() || '').trim(),
    authors,
    journalTitle: get('citation_journal_title'),
    journalAbbrev: get('citation_journal_abbrev'),
    volume: get('citation_volume'),
    issue: get('citation_issue'),
    firstpage: get('citation_firstpage'),
    lastpage: get('citation_lastpage'),
    date: get('citation_date') || get('DC.Date'),
    doi: get('citation_doi') || get('DC.Identifier'),
    issn: getAll('citation_issn'),
    pmid: get('citation_pmid'),
    mjid: get('citation_mjid'),
    section: get('citation_section'),
    abstractUrl: get('citation_abstract_html_url'),
    fulltextUrl: get('citation_fulltext_html_url'),
    pdfUrl: get('citation_pdf_url'),
    publicUrl: get('citation_public_url'),
  };
}

// Selectors removed wholesale from article bodies (HighWire chrome).
const JUNK = [
  'script', 'style', 'noscript', 'link', 'iframe',
  '.section-nav', '.callout', '.fig-services', '.cit-extra',
  '.cit-ref-sprinkles', '.cit-reflinks-variant-name-sep',
  '.highwire-journal-article-marker-start', '.highwire-journal-article-marker-end',
  '.article-nav', '.sidebar-nav', '.kwd-group-link', '.fulltext-view-tab',
  '.history-list', '.copyright-statement-wrap', '.disp-formula-label',
];

function stripJunk($, $root) {
  JUNK.forEach((sel) => $root.find(sel).remove());
  // remove "View larger version" / "In this window" leftovers
  $root.find('.fig-inline .callout').remove();
  // strip inline event handlers, ids that anchor old js, and class noise on prose
  $root.find('*').each((_, el) => {
    const $el = $(el);
    const attrs = el.attribs || {};
    Object.keys(attrs).forEach((a) => {
      if (/^on/i.test(a) || a === 'data-highwire' || a === 'itemprop' || a === 'itemscope' || a === 'itemtype') $el.removeAttr(a);
    });
  });
}

// Rewrite an internal sgmjournals link/asset to the new single-host path.
function rewriteHref(href, ctx) {
  if (!href) return href;
  if (/^(#|mailto:|tel:|javascript:|data:)/i.test(href)) return href;
  let host = ctx.host;
  let uri = href;
  const abs = href.match(/^https?:\/\/([^/]+)(\/[^\s]*)?$/i);
  if (abs) {
    host = abs[1];
    uri = abs[2] || '/';
    if (!host.endsWith('sgmjournals.org')) return href; // external — keep
  } else if (/^\/\//.test(href)) {
    return href;
  } else {
    // relative — resolve against article base
    try {
      const u = new URL(href, `http://${ctx.host}${ctx.requestUri}`);
      host = u.hostname;
      uri = u.pathname + (u.search || '') + (u.hash || '');
    } catch {
      return href;
    }
  }
  const journal = hostToJournal(host);
  const prefix = journal ? `/${journal}` : '';
  return `${prefix}${uri}`;
}

function rewriteImages($, $root, ctx, assets) {
  $root.find('img').each((_, el) => {
    const $img = $(el);
    const src = $img.attr('src');
    const row = resolveAsset(ctx.host, ctx.requestUri, src);
    if (row) {
      const journal = hostToJournal(row.hostname);
      const webPath = copyAsset(row, journal);
      if (webPath) {
        $img.attr('src', webPath);
        $img.removeAttr('srcset');
        $img.attr('loading', 'lazy');
        assets.push(webPath);
        // unwrap link-to-expansion wrappers so we don't 404
        const $a = $img.closest('a');
        if ($a.length && /expansion|\.html$/i.test($a.attr('href') || '')) {
          $a.replaceWith($img);
        }
        return;
      }
    }
    // image not recovered — replace figure image with a placeholder marker
    const $fig = $img.closest('.fig');
    $img.closest('a').addBack().filter('a').contents().unwrap();
    $img.replaceWith('<div class="fig-missing">Figure image not available in archive</div>');
  });
}

function rewriteLinks($, $root, ctx) {
  $root.find('a[href]').each((_, el) => {
    const $a = $(el);
    $a.attr('href', rewriteHref($a.attr('href'), ctx));
  });
}

// ---- full article ---------------------------------------------------------
export function extractArticle(html, ctx) {
  const meta = extractMeta(html);
  const $ = cheerio.load(html, { decodeEntities: false });

  let $ft = $('div.article.fulltext-view').first();
  if (!$ft.length) $ft = $('[itemprop="articleBody"]').first();

  let abstractHtml = '';
  let bodyHtml = '';
  let referencesHtml = '';
  let affiliationsHtml = '';
  let correspHtml = '';
  const assets = [];

  if ($ft.length) {
    stripJunk($, $ft);

    // remove the duplicated front-matter (title + author list are rendered
    // from citation meta in the page header), but first lift out the
    // affiliations + correspondence so they can be shown under the authors.
    $ft.find('h1#article-title-1, h1.article-title, .article-title').first().remove();
    const $affs = $ft.find('.affiliation-list').first();
    if ($affs.length) {
      const $c = $affs.clone();
      $c.find('a').each((_, a) => { const t = $(a).text(); $(a).replaceWith(t); });
      affiliationsHtml = cleanHtml($, $c);
    }
    const $corr = $ft.find('.corresp-list, .corresp').first();
    if ($corr.length) {
      const $c = $corr.clone();
      rewriteLinks($, $c, ctx);
      correspHtml = cleanHtml($, $c);
    }
    $ft.find('.contributors, .contributor-list, .fm-author').remove();
    // drop in-text reference backlink glyphs and dead author-search links
    $ft.find('.rev-xref-ref').remove();
    $ft.find('a.name-search').each((_, a) => $(a).replaceWith($(a).text()));

    // pull abstract out
    const $abs = $ft.find('.section.abstract, .abstract').first();
    if ($abs.length) {
      const $clone = $abs.clone();
      $clone.find('h2').first().remove();
      abstractHtml = cleanHtml($, $clone);
      $abs.remove();
    }

    // pull references out
    const $refs = $ft.find('.section.ref-list, .ref-list').first();
    if ($refs.length) {
      const $rc = $refs.clone();
      $rc.find('h2, h3').first().remove();
      rewriteLinks($, $rc, ctx);
      referencesHtml = cleanHtml($, $rc);
      $refs.remove();
    }

    // remaining = body
    rewriteImages($, $ft, ctx, assets);
    rewriteLinks($, $ft, ctx);
    bodyHtml = cleanHtml($, $ft);
  } else {
    // Abstract-only page: try the abstract block on its own
    const $absView = $('.abstract, .section.abstract, #abstract-1').first();
    if ($absView.length) {
      const $c = $absView.clone();
      stripJunk($, $c);
      $c.find('h2').first().remove();
      abstractHtml = cleanHtml($, $c);
    }
  }

  // PDF availability: look up the recovered full.pdf
  const pdf = resolvePdf(ctx, meta);

  return { meta, abstractHtml, bodyHtml, referencesHtml, affiliationsHtml, correspHtml, assets, pdf };
}

export function extractAbstract(html, ctx) {
  return extractArticle(html, ctx);
}

function resolvePdf(ctx, meta) {
  if (!meta.firstpage || !meta.volume || !meta.issue) return null;
  const uri = `/content/${meta.volume}/${meta.issue}/${meta.firstpage}.full.pdf`;
  const row = lookupLoose(ctx.host, uri);
  if (row && row.mimetype === 'application/pdf') {
    return { row, uri };
  }
  return null;
}

// Serialize the inner HTML of an element and tidy whitespace a little.
function cleanHtml($, $el) {
  let h = $el.html() || '';
  // collapse runs of blank lines / excessive whitespace between tags
  h = h.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return h.trim();
}

// ---- journal-home intro ---------------------------------------------------
// Journal home pages are mostly navigation. Pull only substantive prose
// paragraphs (the journal scope/description), discarding link lists & chrome.
export function extractJournalIntro(html, ctx) {
  const $ = cheerio.load(html, { decodeEntities: false });
  $('script, style, noscript, nav, header, footer, .nav, .header, .footer').remove();
  const paras = [];
  $('p').each((_, el) => {
    const $p = $(el);
    const text = $p.text().replace(/\s+/g, ' ').trim();
    const links = $p.find('a').length;
    const linkText = $p.find('a').text().replace(/\s+/g, ' ').trim().length;
    // keep real sentences: long enough, not a link-list, mostly non-link text
    if (text.length >= 140 && text.split(/\s+/).length >= 25 && linkText < text.length * 0.5 && links <= 4) {
      rewriteLinks($, $p, ctx);
      paras.push(`<p>${$p.html().replace(/\s+/g, ' ').trim()}</p>`);
    }
  });
  return paras.slice(0, 3).join('\n');
}

// ---- generic info page ----------------------------------------------------
const LOGIN_TITLE = /sign[\s-]?in|log[\s-]?in|access denied|page not found|not found|error|institutional access/i;

export function extractInfoPage(html, ctx) {
  const $ = cheerio.load(html, { decodeEntities: false });
  let title =
    ($('h1').first().text() || '').trim() ||
    ($('meta[name="DC.Title"]').attr('content') || '').trim() ||
    ($('title').first().text() || '').trim();
  title = title.replace(/\s*[|–-]\s*(SGM Journals|Microbiology|IJSEM|Journal of [^|]+)\s*$/i, '').trim();

  // A captured login/error wall has no real content.
  if (LOGIN_TITLE.test(title)) return { title: '', bodyHtml: '', isLogin: true };

  const candidates = [
    '#content-block', '.content-block', '#main-content', '.primary',
    '.article', '#hw-article', '.cb-contents', '#content', 'main',
  ];
  let $content = null;
  for (const sel of candidates) {
    const $c = $(sel).first();
    if ($c.length && $c.text().trim().length > 120) { $content = $c; break; }
  }
  if (!$content) $content = $('body').first();

  const $clone = $content.clone();
  stripJunk($, $clone);
  // strip chrome: nav/header/footer, forms/inputs (login), all images (banners,
  // spacers, icons), and known HighWire widgets — info pages are text content.
  $clone.find('header, footer, nav, .nav, .header, .footer, .breadcrumb, .pagenav, .skip, #header, #footer, #nav, .access-options, .signin, .login, form, input, button, select, img, iframe, object, .ad, .advertisement, [id*="login"], [class*="login"], [class*="banner"], [class*="masthead"]').remove();
  rewriteLinks($, $clone, ctx);
  const bodyHtml = cleanHtml($, $clone);
  // If nothing meaningful survived, treat as a login/empty wall.
  if (bodyHtml.replace(/<[^>]+>/g, '').trim().length < 40) return { title, bodyHtml: '', isLogin: true };
  return { title, bodyHtml };
}
