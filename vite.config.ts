import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(() => {
  // Production builds default to the domain root for zirveacademy.com; GitHub
  // Pages can opt into its project path with `VITE_BASE=/kocluk/`. `vite dev`
  // stays at the root.
  const base = process.env.VITE_BASE || '/';

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        // SVG/PNG assets are already covered by workbox.globPatterns; only the
        // ICO fallback needs to be added explicitly.
        includeAssets: ['favicon.ico'],
        manifest: {
          name: 'Zirve Akademi — YKS Takip',
          short_name: 'Zirve Akademi',
          description:
            'YKS hazırlığını kitaplar, testler, denemeler, notlar ve yanlış fotoğraflarıyla tek cihazda takip et.',
          lang: 'tr',
          theme_color: '#07080A',
          background_color: '#07080A',
          display: 'standalone',
          start_url: './',
          scope: './',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  };
});
