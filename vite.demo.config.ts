import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { yamlConfig } from './tools/vite-plugin-yaml-config.ts';

/**
 * A static demo of the PWA: no Worker, no service worker; /api calls are answered from
 * src/web/demo/snapshot.json (made by tools/demo-snapshot.mjs from a seeded local run).
 * Build: VITE_DEMO_DATE="7 Oct 2026" npx vite build --config vite.demo.config.ts
 */
export default defineConfig({
  plugins: [yamlConfig(), react()],
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
  base: './',
  publicDir: false,
  build: { outDir: 'dist-demo', target: 'es2022', assetsInlineLimit: 1_000_000, modulePreload: false, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } },
});
