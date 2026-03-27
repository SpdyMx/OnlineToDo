import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const outDir = process.env.VITE_OUT_DIR ?? '../api/public'
const minify = process.env.VITE_MINIFY === 'false' ? false : 'esbuild'
const sourcemap = process.env.VITE_SOURCEMAP === 'true'

export default defineConfig({
  base: './',
  build: {
    outDir,
    minify,
    sourcemap,
    emptyOutDir: false,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Online ToDo',
        short_name: 'ToDo',
        description: 'A secure, offline-capable task manager.',
        theme_color: '#0f172a',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
})
