import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import pkg from "./package.json"

// The built app is served by the backend, which exposes files from public/ under /static
const servePublicAsStatic = {
  name: "serve-public-as-static",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith("/static/")) req.url = req.url.slice("/static".length)
      next()
    })
  },
}

// Backend started with `pnpm dev:backend`
const backend = process.env.BACKEND_URL || "http://127.0.0.1:5611"

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), servePublicAsStatic],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
        chunkFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
        assetFileNames: `assets/[name]-[hash]-${Date.now()}.[ext]`
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 8802,
    allowedHosts: true,  // Allow all hosts for flexible deployment
    proxy: {
      '/api': {
        target: backend,
        changeOrigin: true,
      },
      '/ws': {
        target: backend.replace(/^http/, 'ws'),
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
    },
  },
})
