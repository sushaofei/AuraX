/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AURAX_UPLINK?: "same-origin";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
