/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AURAX_UPLINK?: "same-origin";
  readonly VITE_AURAX_MANAGED_IDENTITY?: "true";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
