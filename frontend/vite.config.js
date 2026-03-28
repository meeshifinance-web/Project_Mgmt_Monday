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
        name: "D'Decor Workboard",
        short_name: 'Workboard',
        description: "D'Decor Home Fabrics Project Management",
        start_url: '/',
        display: 'standalone',
        background_color: '#1f2d3d',
        theme_color: '#0073ea',
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
    // ❌ remove https
    // ❌ remove basicSsl
    allowedHosts: ['nocode.ddecor.com'],
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
