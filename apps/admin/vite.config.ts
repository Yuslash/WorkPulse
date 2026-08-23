import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

export default defineConfig(({ mode }) => {
  // The repo keeps one .env at the root; load VITE_* vars from there rather
  // than duplicating configuration per workspace.
  const env = loadEnv(mode, repoRoot, 'VITE_');

  return {
    plugins: [react()],
    envDir: repoRoot,
    resolve: {
      alias: {
        '@': path.resolve(here, 'src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      // Proxying in dev means the browser sees one origin, so the refresh
      // cookie behaves exactly as it does in production behind Nginx.
      proxy: {
        '/api': {
          target: env.VITE_API_URL || 'http://localhost:4000',
          changeOrigin: true,
        },
        '/ws': {
          target: env.VITE_API_URL || 'http://localhost:4000',
          changeOrigin: true,
          ws: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
          },
        },
      },
    },
  };
});
