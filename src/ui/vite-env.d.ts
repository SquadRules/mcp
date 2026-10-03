// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KAIROS_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.svg" {
  const url: string;
  export default url;
}
