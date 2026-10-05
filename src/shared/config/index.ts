import rulesConfig from '../../../config/rules.yaml';
import sourcesConfig from '../../../config/sources.yaml';

export const rules = rulesConfig;
export const sources = sourcesConfig;
export type { RulesConfig, SourcesConfig, Retailer, Source, ShipFlag, Confidence } from './schema';
