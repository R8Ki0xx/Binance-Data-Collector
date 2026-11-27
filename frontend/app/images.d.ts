// Modified by QuantPilot contributors (2026). See NOTICE.
declare module '*.svg' {
  const src: string
  export default src
}

declare module '*.webp' {
  const src: string
  export default src
}

declare const __APP_VERSION__: string

interface ImportMetaEnv {
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
