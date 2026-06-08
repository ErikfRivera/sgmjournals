// Shared on-page SEO helpers: ISO dates, meta-description shaping, and the
// schema.org JSON-LD builders used by the article / journal / TOC templates.
import { getJournal } from './journals.js';

const PUBLISHER = {
  '@type': 'Organization',
  name: 'Microbiology Society',
  url: 'https://www.microbiologysociety.org/',
};
const SITE = 'https://www.sgmjournals.org';

// HighWire dates arrive as MM/DD/YYYY (or sometimes a bare year). Emit the
// tightest valid ISO 8601 value Rich Results will accept.
export function isoDate(d) {
  if (!d) return undefined;
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [_, a, b, y] = m;
    const mm = String(Math.min(12, Math.max(1, +a))).padStart(2, '0');
    const dd = String(Math.min(31, Math.max(1, +b))).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  m = s.match(/(\d{4})/);
  return m ? m[1] : undefined;
}

export function yearOf(d) { const m = String(d || '').match(/(\d{4})/); return m ? m[1] : ''; }

export function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// Shape a meta description toward 120–160 chars, cutting on a sentence or word
// boundary (never mid-word), no trailing ellipsis.
export function trimDescription(text, max = 158) {
  text = stripHtml(text);
  if (!text) return '';
  if (text.length <= max) return text;
  const slice = text.slice(0, max + 1);
  // prefer a sentence boundary in the back half
  const sent = slice.match(/^[\s\S]*[.!?](?=\s)/);
  if (sent && sent[0].length >= 90) return sent[0].trim();
  const sp = slice.lastIndexOf(' ');
  return (sp > 90 ? slice.slice(0, sp) : slice.slice(0, max)).replace(/[\s,;:]+$/, '').trim();
}

// Build a self-contained, unique description for an article when the abstract
// is thin/empty. Always carries the citation so it is unique site-wide.
export function articleDescription(m, abstract, summary, journalName) {
  const abs = trimDescription(abstract || summary || '');
  const yr = yearOf(m.date);
  const cite = [journalName, yr, m.volume && `vol. ${m.volume}`, m.issue && `(${m.issue})`,
    m.firstpage && `pp. ${m.firstpage}${m.lastpage && m.lastpage !== m.firstpage ? '–' + m.lastpage : ''}`]
    .filter(Boolean).join(' ').replace(' (', ' (');
  if (abs && abs.length >= 80) return abs;
  // construct a descriptive sentence from the citation + authors
  const authors = (m.authors || []).slice(0, 3).join(', ') + ((m.authors || []).length > 3 ? ' et al.' : '');
  const lead = `${m.title}${authors ? ` by ${authors}` : ''}. Published in ${cite}.`;
  const out = (abs ? abs + ' ' : '') + lead;
  return trimDescription(out, 158);
}

export function articleSchema(entry, journalName, descText) {
  const m = entry.meta || {};
  const j = getJournal(entry.journal);
  const issn = (m.issn && m.issn.length) ? m.issn : (j ? [j.issn, j.eissn].filter(Boolean) : []);
  const doiUrl = m.doi ? `https://doi.org/${m.doi}` : undefined;
  const cite = [journalName, m.volume && `vol. ${m.volume}`, m.issue && `(${m.issue})`,
    m.firstpage && `p. ${m.firstpage}`].filter(Boolean).join(' ');
  const headline = m.title || cite || journalName || 'Article';
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    mainEntityOfPage: { '@type': 'WebPage', '@id': entry.canonical },
    headline,
    name: headline,
    author: (m.authors || []).map((name) => ({ '@type': 'Person', name })),
    datePublished: isoDate(m.date),
    isPartOf: {
      '@type': 'Periodical',
      name: journalName,
      issn: issn.length ? issn : undefined,
    },
    publisher: PUBLISHER,
    image: [`${SITE}/og-default.png`],
    url: entry.canonical,
  };
  if (m.volume) schema.volumeNumber = String(m.volume);
  if (m.issue) schema.issueNumber = String(m.issue);
  if (m.firstpage) schema.pageStart = String(m.firstpage);
  if (m.lastpage) schema.pageEnd = String(m.lastpage);
  if (m.firstpage) schema.pagination = m.lastpage && m.lastpage !== m.firstpage ? `${m.firstpage}-${m.lastpage}` : String(m.firstpage);
  if (descText) schema.description = stripHtml(descText).slice(0, 5000);
  if (doiUrl) {
    schema.sameAs = doiUrl;
    schema.identifier = { '@type': 'PropertyValue', propertyID: 'DOI', value: m.doi };
  }
  // drop empty author array so it isn't emitted as []
  if (!schema.author.length) delete schema.author;
  return schema;
}

export function breadcrumb(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url ? (it.url.startsWith('http') ? it.url : SITE + it.url) : undefined,
    })),
  };
}

export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'SGM Journals',
    url: SITE + '/',
    publisher: PUBLISHER,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/search?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Microbiology Society',
    alternateName: 'Society for General Microbiology',
    url: 'https://www.microbiologysociety.org/',
  };
}

export function periodicalSchema(entry, j) {
  const issn = [j.issn, j.eissn].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'Periodical',
    name: j.name,
    issn: issn.length ? issn : undefined,
    url: entry.canonical,
    publisher: PUBLISHER,
  };
}
