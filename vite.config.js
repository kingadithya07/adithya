import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // The app is served through a proxied preview host, so the dev server must
    // not restrict Host headers to localhost.
    host: '0.0.0.0',
    allowedHosts: true,
    hmr: false,
  },
  build: { outDir: 'dist', sourcemap: false },
});
