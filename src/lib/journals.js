// Single source of truth for the rebuilt journal portfolio.
// `code` is the URL path prefix on www.sgmjournals.org.
// Accents come from the design system's per-journal token set.
export const JOURNALS = {
  mic: {
    code: 'mic',
    name: 'Microbiology',
    short: 'Microbiology',
    accent: 'var(--journal-microbiology)',
    founded: 1947,
    issn: '1350-0872',
    eissn: '1465-2080',
    tagline: 'The flagship journal of the Society for General Microbiology, covering all aspects of microbiology.',
    aliasHosts: ['mic.sgmjournals.org', 'intl-mic.sgmjournals.org', 'm.mic.sgmjournals.org', 'submit-mic.sgmjournals.org'],
  },
  vir: {
    code: 'vir',
    name: 'Journal of General Virology',
    short: 'J. Gen. Virol.',
    accent: 'var(--journal-virology)',
    founded: 1967,
    issn: '0022-1317',
    eissn: '1465-2099',
    tagline: 'Research on the viruses of animals, plants, insects, bacteria and fungi.',
    aliasHosts: ['vir.sgmjournals.org', 'jgv.sgmjournals.org', 'intl-vir.sgmjournals.org', 'submit-vir.sgmjournals.org'],
  },
  ijs: {
    code: 'ijs',
    name: 'International Journal of Systematic and Evolutionary Microbiology',
    short: 'IJSEM',
    accent: 'var(--journal-ijsem)',
    founded: 1951,
    issn: '1466-5026',
    eissn: '1466-5034',
    tagline: 'The official journal of record for novel prokaryotic and microbial taxa.',
    aliasHosts: ['ijs.sgmjournals.org', 'ijsb.sgmjournals.org', 'intl-ijs.sgmjournals.org', 'submit-ijs.sgmjournals.org'],
  },
  jmm: {
    code: 'jmm',
    name: 'Journal of Medical Microbiology',
    short: 'J. Med. Microbiol.',
    accent: 'var(--journal-medical)',
    founded: 1968,
    issn: '0022-2615',
    eissn: '1473-5644',
    tagline: 'Medical, dental and veterinary microbiology, virology, mycology and parasitology.',
    aliasHosts: ['jmm.sgmjournals.org', 'intl-jmm.sgmjournals.org', 'submit-jmm.sgmjournals.org'],
  },
  jmmcr: {
    code: 'jmmcr',
    name: 'JMM Case Reports',
    short: 'JMM Case Rep.',
    accent: 'var(--journal-genomics)',
    founded: 2014,
    issn: '2053-3721',
    eissn: '2053-3721',
    tagline: 'Peer-reviewed case reports across medical microbiology and infectious disease.',
    aliasHosts: ['jmmcr.sgmjournals.org'],
  },
};

// Ordered list for portfolio displays (flagship first).
export const JOURNAL_ORDER = ['mic', 'vir', 'jmm', 'ijs', 'jmmcr'];

export function journalList() {
  return JOURNAL_ORDER.map((c) => JOURNALS[c]);
}

export function getJournal(code) {
  return JOURNALS[code] || null;
}
