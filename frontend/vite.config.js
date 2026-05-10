import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      },
      manifest: {
        name: 'Simplix',
        short_name: 'Simplix',
        description: 'Simplix project management',
        start_url: '/',
        display: 'standalone',
        background_color: '#1f2d3d',
        theme_color: '#9b72f5',
        orientation: 'portrait-primary',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  server: {
    host: '0.0.0.0',   // allow access via domain/IP
    port: 5173,
    strictPort: true,  // fail loudly if 5173 is taken — never fall back to 5174+
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
