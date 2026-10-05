import { defineConfig } from 'vitest/config';
import { yamlConfig } from './tools/vite-plugin-yaml-config.ts';

export default defineConfig({
  plugins: [yamlConfig()],
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
