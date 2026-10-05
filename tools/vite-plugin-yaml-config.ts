import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { Plugin } from 'vite';
import { RulesConfig, SourcesConfig } from '../src/shared/config/schema.ts';

const schemas: Record<string, typeof RulesConfig | typeof SourcesConfig> = {
  'rules.yaml': RulesConfig,
  'sources.yaml': SourcesConfig,
};

/**
 * Turns `import x from '../config/rules.yaml'` into a plain JSON module, validated with zod at
 * build time. The Worker never parses YAML at runtime, which matters on a 10 ms CPU budget.
 */
export function yamlConfig(): Plugin {
  return {
    name: 'card-desk-yaml-config',
    enforce: 'pre',
    load(id) {
      const path = id.split('?')[0] ?? id;
      if (!path.endsWith('.yaml')) return null;
      const file = path.split('/').pop() ?? '';
      const schema = schemas[file];
      if (!schema) throw new Error(`No schema registered for ${file}`);
      const parsed = schema.safeParse(parse(readFileSync(path, 'utf8')));
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Invalid ${file}:\n${issues}`);
      }
      return `export default ${JSON.stringify(parsed.data)};`;
    },
  };
}
