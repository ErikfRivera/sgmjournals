import { defineConfig } from 'astro/config';

// Single static host for the rebuilt sgmjournals.org archive.
// Directory-format output so /vir/content/94/Pt_3/694 and …/694/ both resolve.
export default defineConfig({
  site: 'https://www.sgmjournals.org',
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
  // Scholarly content is the payload; ship as little JS as possible.
  compressHTML: true,
});
