import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { yamlConfig } from './tools/vite-plugin-yaml-config.ts';

export default defineConfig({
  plugins: [yamlConfig(), react(), cloudflare()],
});
