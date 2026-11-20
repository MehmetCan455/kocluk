import { defineConfig } from '@vite-pwa/assets-generator/config';

/**
 * Generates the PWA icon set from the single source SVG. The minimal-2023
 * preset produces 64/192/512 px transparent icons, a 512 px maskable icon and
 * the favicon, matching the manifest below.
 */
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: 'minimal-2023',
  images: ['public/favicon.svg'],
});
