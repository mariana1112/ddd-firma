import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Ścieżki względne: aplikację można hostować pod dowolnym adresem statycznym.
  base: './',
  plugins: [
    react(),
    VitePWA({
      // Aktualizacja dopiero po zgodzie użytkownika, żeby nie przerwać wypełniania formularza.
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        id: './',
        name: 'Pogromcy Insektów',
        short_name: 'Pogromcy',
        description: 'Zlecenia, zabiegi, kilometrówka i rozliczenia technika Pogromców Insektów.',
        lang: 'pl',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f3f2ee',
        theme_color: '#0f5c50',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // Czcionki PDF są duże, a muszą działać offline.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
