// @ts-check
import { defineConfig } from 'astro/config';

import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  devToolbar: { enabled: false },

  adapter: node({
    mode: 'standalone',
    // No request may be larger than the biggest legitimate one (an album upload, 120 MB: see src/server/uploads.ts).
    // The adapter's own default is 1 GB.
    bodySizeLimit: 130 * 1024 * 1024,
  }),
});