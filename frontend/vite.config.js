import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
