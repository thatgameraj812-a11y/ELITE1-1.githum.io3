/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADMIN_EMAIL: string
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
