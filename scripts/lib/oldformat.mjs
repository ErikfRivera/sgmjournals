// Old-format HighWire extractor (anchor-based, table-chrome markup, ~2000-2011).
// Sections are flat: <a name="ABS"> title-bar-table prose <a name="SEC1"> ...
// We slice the raw HTML between section anchors, then clean each slice with cheerio.
import * as cheerio from 'cheerio';

// HighWire rendered many symbols/greek letters as /math/<name>.gif images with an
// alt="{name}". Map the common ones back to real Unicode so the prose reads right.
const MATH = {
  dagger: '†', Dagger: '‡', ddagger: '‡', sect: '§', para: '¶', bull: '•', bullet: '•',
  middot: '·', sdot: '·', times: '×', divide: '÷', plusmn: '±', minus: '−', deg: '°',
  prime: '′', Prime: '″', hellip: '…', ndash: '–', mdash: '—', le: '≤', leq: '≤',
  ge: '≥', geq: '≥', ne: '≠', asymp: '≈', sim: '∼', equiv: '≡', infin: '∞', prop: '∝',
  rarr: '→', rightarrow: '→', larr: '←', harr: '↔', uarr: '↑', darr: '↓',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', Theta: 'Θ', iota: 'ι', kappa: 'κ', lambda: 'λ', Lambda: 'Λ',
  mu: 'μ', micro: 'µ', nu: 'ν', xi: 'ξ', pi: 'π', Pi: 'Π', rho: 'ρ', sigma: 'σ',
  Sigma: 'Σ', tau: 'τ', upsilon: 'υ', phi: 'φ', Phi: 'Φ', chi: 'χ', psi: 'ψ',
  omega: 'ω', Omega: 'Ω', cong: '≅', plusmnb: '±', frac12: '½', frac14: '¼',
  trade: '™', reg: '®', copy: '©', radic: '√', sum: '∑', int: '∫', part: '∂',
  nabla: '∇', isin: '∈', notin: '∉', cap: '∩', cup: '∪', sub: '⊂', sup2: '²',
  sup3: '³', empty: '∅', forall: '∀', exist: '∃',
};

// Section anchors that start a logical block (NOT inline T#/F#/R# anchors).
const SECTION_RE = /^(ABS|SEC\d+[A-Za-z]?|SUBSEC\d+|ACK|APP[A-Za-z0-9]*|BIBL|GLOSS\w*|NOTES?|FNC?\d*|RFNC?\d*|CONCL|DISC|SUM|otherarticles|relatedurls|cited-by)/i;
const BODY_RE = /^(SEC\d+[A-Za-z]?|SUBSEC\d+|ACK|APP[A-Za-z0-9]*|CONCL|DISC|SUM)$/i;
const STOP_RE = /^(otherarticles|relatedurls|cited-by)$/i;

export function isOldFormat(html) {
  if (/fulltext-view|articleBody/.test(html)) return false;
  return /<a\s+name="(ABS|SEC1|BIBL)"/i.test(html);
}

// A captured sign-in / institutional-access wall has no real article content.
export function isLoginWall(html) {
  if (/<a\s+name="(ABS|SEC1|BIBL)"/i.test(html)) return false; // real old-format body present
  return /id="UserSignIn"|name="username"|name="password"|To view this (item|article)|Sign In to gain access|institutional (login|access)/i.test(html);
}

// Extract the abstract from a legacy "content_box" abstract/landing page (and as a
// fallback from any page where the abstract is the dominant prose paragraph).
// Layout: <h2>title</h2> <p><strong>authors</strong>…</p> <p>ABSTRACT…</p>
// <p>copyright…</p>. The abstract is the largest contiguous prose block.
export function extractContentBoxAbstract(html, ctx) {
  const $ = cheerio.load(html, { decodeEntities: false });
  $('script,style,noscript,form,input,select,button').remove();
  $('table').each((_, t) => {
    const $t = $(t);
    if (/content_box|\/icons\/|\/portal_imgs\/|search_result\.gif/i.test($t.html() || '')) $t.remove();
  });
  const STOP = /copyright|©|&copy;|all rights reserved|this article (has|cites)|cited by|key ?words?:|received\s|accepted\s/i;
  const AFFIL = /(University|Institute|Department|College|Laborator|Center|Centre|Hospital|Ministry|Academy)/;
  const cands = [];
  $('p').each((_, p) => { const t = $(p).text().replace(/\s+/g, ' ').trim(); cands.push({ p, text: t, len: t.length }); });
  let best = null;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c.len < 180) continue;
    if (STOP.test(c.text)) continue;
    if (AFFIL.test(c.text) && c.len < 400) continue;
    const parts = [];
    for (let j = i; j < cands.length; j++) {
      const d = cands[j];
      if (d.len < 60) break;
      if (STOP.test(d.text)) break;
      parts.push(d);
    }
    if (parts.length) { best = parts; break; }
  }
  if (!best) return '';
  const htmlParts = best.map((c) => {
    const $c = $(c.p).clone();
    $c.find('a').each((_, a) => { const $a = $(a); if ($a.find('img').length && !$a.text().trim()) $a.remove(); else $a.replaceWith($a.html() || ''); });
    $c.find('img').each((_, im) => { const src = $(im).attr('src') || ''; const alt = ($(im).attr('alt') || '').match(/\{([^}]+)\}/); if (/\/icons\/|spacer|\/math\//i.test(src)) $(im).replaceWith(alt ? (MATH[alt[1]] || MATH[alt[1].toLowerCase()] || '') : ''); });
    $c.find('sup,sub').each((_, s) => { if (!$(s).text().trim()) $(s).remove(); });
    $c.find('font').each((_, f) => { const $f = $(f); $f.replaceWith($f.contents()); });
    $c.find('*').each((_, el) => { const at = el.attribs || {}; for (const k of Object.keys(at)) { if (/^on/i.test(k) || ['style', 'class', 'align', 'size', 'color', 'face', 'width', 'height', 'name', 'id', 'target'].includes(k.toLowerCase())) $(el).removeAttr(k); } });
    const inner = ($c.html() || '').replace(/ |&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return `<p>${inner}</p>`;
  });
  const out = htmlParts.join('\n');
  return out.replace(/<[^>]+>/g, '').trim().length > 80 ? out : '';
}

function anchors(html) {
  const out = [];
  const re = /<a\s+name="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) out.push({ name: m[1], pos: m.index });
  return out;
}

// Clean a raw HTML slice: drop chrome tables/icons/nav, ref glyphs, empty sups.
function cleanSlice(rawHtml, ctx, opts = {}) {
  const $ = cheerio.load(rawHtml, { decodeEntities: false });
  const $body = $('body');

  // Remove scripts/styles/forms
  $body.find('script,style,noscript,form,input,select,button').remove();

  // Replace /math/<sym>.gif images with their Unicode glyph (from alt="{name}").
  $body.find('img').each((_, im) => {
    const $im = $(im);
    const src = $im.attr('src') || '';
    if (/\/math\//i.test(src)) {
      let key = (($im.attr('alt') || '').match(/\{([^}]+)\}/) || [])[1];
      if (!key) key = (src.match(/\/math\/([^./]+)/) || [])[1];
      const glyph = key ? (MATH[key] || MATH[key.toLowerCase()]) : null;
      $im.replaceWith(glyph || '');
    }
  });

  // Remove HighWire chrome tables: title bars, section nav, back-to-top widgets.
  $body.find('table').each((_, t) => {
    const $t = $(t);
    const htmlt = $t.html() || '';
    if (/\/icons\/toc\/|\/icons\/back\.gif|\/icons\/shared\/|search_result\.gif|\/portal_imgs\//i.test(htmlt)) {
      $t.remove();
    }
  });

  // Collapse figure/table "View this table/figure" widgets to just the caption.
  // In old-format full text the table/figure data lives on a separate page; the
  // inline block is a thumbnail/link + caption. Keep the caption text only.
  $body.find('a[href]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    if (/\/cgi\/content(?:-nw)?\/(full|short|abstract)\/[^"']*\/[TF]\d+/i.test(href) ||
        /\/(expansion|largerimage)/i.test(href)) {
      // unwrap (drop link, keep any caption text) or remove if it's "[in this window]" boilerplate
      const txt = $a.text().trim();
      if (/in (this|a new) window|view larger|larger version/i.test(txt) || !txt) $a.remove();
      else $a.replaceWith(txt);
    }
  });
  // Drop residual boilerplate phrases.
  $body.find('strong,b,nobr').each((_, el) => {
    const t = $(el).text().trim();
    if (/^view (this table|this figure|larger version)/i.test(t)) $(el).remove();
  });

  // Remove in-text citation / figure / back glyph links (an <a> wrapping only an icon img).
  $body.find('a').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    const $imgs = $a.find('img');
    const txt = $a.text().replace(/\s+/g, '');
    if ($imgs.length && !txt) {
      const allIcon = $imgs.toArray().every((im) => /\/icons\/|spacer\.gif|fig-down|rarrow|uarrow|darrow|\bdot\.gif|\bback\.gif/i.test($(im).attr('src') || ''));
      if (allIcon || /^#/.test(href)) { $a.remove(); return; }
    }
  });

  // Remove leftover icon images and spacers anywhere.
  $body.find('img').each((_, im) => {
    const src = $(im).attr('src') || '';
    if (/\/icons\/|spacer\.gif|\/portal_imgs\/|\/shared\//i.test(src)) $(im).remove();
  });

  // Remove empty <sup></sup> (line-wrap artifacts) and stray <br clear>.
  $body.find('sup,sub').each((_, s) => { if (!$(s).text().trim() && !$(s).find('img').length) $(s).remove(); });

  // Strip the section anchor itself + inline anchors that are now empty (keep R# targets in refs).
  $body.find('a[name],a[id]').each((_, a) => {
    const $a = $(a);
    const nm = $a.attr('name') || $a.attr('id') || '';
    if (!$a.text().trim() && !$a.find('img').length) {
      if (opts.keepRefAnchors && /^R\d+$/.test(nm)) { $a.removeAttr('href'); return; }
      $a.remove();
    }
  });

  // Collapse float shells: in old-format full text, tables/figures live on
  // separate pages; the inline block is now an (emptied) nav table plus a
  // caption like "Table 1. ...". Replace such shells with a clean caption.
  $body.find('table').each((_, t) => {
    const $t = $(t);
    if ($t.parents('table').length) return; // handle outermost only
    const txt = $t.text().replace(/\s+/g, ' ').trim();
    const cap = txt.match(/((?:Table|Fig(?:ure)?|Scheme|Box)\s*\d+[.:]?.*)/i);
    // a real data table has many cells; a shell has few. Count cells with text.
    // count innermost cells carrying text (a real data table has many; a
    // figure/table caption shell has only the thumbnail + caption cell).
    const cells = $t.find('td,th').toArray().filter((c) => $(c).children('table').length === 0 && $(c).text().trim().length > 2).length;
    if (cap && cells <= 4) {
      $t.replaceWith(`<p class="article-float-caption"><strong>${cap[1].trim()}</strong></p>`);
    }
  });

  // Flatten <font> tags (keep text/children).
  $body.find('font,center').each((_, f) => { const $f = $(f); $f.replaceWith($f.contents()); });

  // Strip presentational attributes (keep colspan/rowspan on real tables).
  $body.find('*').each((_, el) => {
    const at = el.attribs || {};
    for (const k of Object.keys(at)) {
      if (k === 'colspan' || k === 'rowspan') continue;
      if (/^on/i.test(k) || ['bgcolor', 'background', 'valign', 'align', 'width', 'height', 'hspace', 'vspace', 'cellpadding', 'cellspacing', 'nowrap', 'border', 'color', 'face', 'size', 'clear', 'style', 'target', 'name', 'id'].includes(k.toLowerCase())) {
        if (opts.keepRefAnchors && (k === 'name' || k === 'id') && /^R\d+$/.test(at[k])) continue;
        $(el).removeAttr(k);
      }
    }
  });

  let h = $body.html() || '';
  h = h.replace(/ /g, ' ').replace(/&nbsp;/g, ' ')
       .replace(/<p>\s*<\/p>/g, '')
       .replace(/<(b|i|strong|em|sup|sub)>\s*<\/\1>/g, '')
       .replace(/<br\s*\/?>(\s*<br\s*\/?>)+/g, '<br>')
       .replace(/(<br\s*\/?>\s*)+$/g, '')
       .replace(/^(\s*<br\s*\/?>\s*)+/g, '')
       .replace(/[ \t]{2,}/g, ' ')
       .replace(/\n{3,}/g, '\n\n')
       .trim();
  // strip leading stray punctuation/space artifacts
  h = h.replace(/^(\s|&nbsp;|<br>)+/i, '').trim();
  return h;
}

// Strip a leading section title bar's residual text (e.g. "ABSTRACT", "INTRODUCTION")
function dropLeadingHeading(h, headingWords) {
  // after chrome removal the title may remain as bare text; remove a leading
  // line that is just the uppercase heading.
  return h.replace(new RegExp('^\\s*(?:<p>\\s*)?(' + headingWords + ')\\s*(?:</p>)?', 'i'), '').trim();
}

export function extractOldArticle(html, ctx) {
  const an = anchors(html);
  // index by name
  const byName = {};
  for (const a of an) if (!(a.name in byName)) byName[a.name] = a.pos;

  // Determine content end: first stop anchor (otherarticles/cited-by) else end.
  let endPos = html.length;
  for (const a of an) { if (STOP_RE.test(a.name)) { endPos = a.pos; break; } }

  // Ordered section-start anchors within [start, endPos)
  const secAnchors = an.filter((a) => SECTION_RE.test(a.name) && a.pos < endPos && !STOP_RE.test(a.name));
  // also need BIBL boundary
  // Build slices: for each section anchor, slice to next section anchor (or endPos / BIBL)
  const bounds = [...secAnchors.map((a) => a.pos), endPos].sort((x, y) => x - y);

  function sliceAt(pos) {
    const idx = bounds.indexOf(pos);
    const next = bounds[idx + 1] ?? endPos;
    return html.slice(pos, next);
  }

  let abstractHtml = '', bodyHtml = '', referencesHtml = '', correspHtml = '';
  const bodyParts = [];
  const footnotes = [];

  for (const a of secAnchors) {
    const name = a.name;
    const raw = sliceAt(a.pos);
    if (/^ABS$/i.test(name)) {
      let h = cleanSlice(raw, ctx);
      h = dropLeadingHeading(h, 'ABSTRACT|SUMMARY');
      if (h.replace(/<[^>]+>/g, '').trim().length > 20) abstractHtml = h;
    } else if (/^BIBL$/i.test(name)) {
      let h = cleanSlice(raw, ctx, { keepRefAnchors: true });
      h = dropLeadingHeading(h, 'REFERENCES|LITERATURE CITED|BIBLIOGRAPHY');
      if (h.replace(/<[^>]+>/g, '').trim().length > 20) referencesHtml = h;
    } else if (/^(FNC?\d*|RFNC?\d*)$/i.test(name)) {
      const h = cleanSlice(raw, ctx);
      const txt = h.replace(/<[^>]+>/g, '').trim();
      if (txt.length > 8 && /correspond|e-?mail|\{at\}|@/i.test(txt) && !correspHtml) correspHtml = h;
      else if (txt.length > 8) footnotes.push(h); // present-address etc. -> footnotes
    } else if (BODY_RE.test(name)) {
      let h = cleanSlice(raw, ctx);
      // remove the leading uppercase heading word(s) then re-add as an <h2>
      const headMatch = raw.match(/text-transform:\s*uppercase[^>]*>\s*(?:&nbsp;)*\s*([A-Z][A-Z0-9 ,&'\-\/()]+?)\s*<\/font>/);
      const heading = headMatch ? headMatch[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '';
      if (heading) h = dropLeadingHeading(h, heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const txt = h.replace(/<[^>]+>/g, '').trim();
      if (txt.length > 5) {
        const title = heading ? `<h2>${titleCase(heading)}</h2>\n` : '';
        bodyParts.push(title + h);
      }
    }
  }
  if (footnotes.length) {
    bodyParts.push('<section class="article-footnotes"><h2>Footnotes</h2>\n' + footnotes.join('\n') + '</section>');
  }
  bodyHtml = bodyParts.join('\n').trim();
  return { abstractHtml, bodyHtml, referencesHtml, correspHtml };
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
}
