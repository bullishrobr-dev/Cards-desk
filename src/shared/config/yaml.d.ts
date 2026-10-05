declare module '*/rules.yaml' {
  const config: import('./schema').RulesConfig;
  export default config;
}
declare module '*/sources.yaml' {
  const config: import('./schema').SourcesConfig;
  export default config;
}
