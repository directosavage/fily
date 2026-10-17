import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'DocuMax',
        short_name: 'DocuMax',
        description: 'Private document scanning and PDF tools.',
        theme_color: '#4f46e5',
        background_color: '#f7f8fc',
        display: 'standalone',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
