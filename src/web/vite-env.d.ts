/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in the demo build (vite.demo.config.ts): snapshot data, in-memory routing, no push. */
  readonly VITE_DEMO?: string;
  readonly VITE_DEMO_DATE?: string;
  /** JSON array of { label, to } links shown in the demo banner. */
  readonly VITE_DEMO_HIGHLIGHTS?: string;
}
