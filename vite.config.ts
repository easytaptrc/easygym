import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// UNA sola PWA "EasyGym" para TODOS los gimnasios.
// El gimnasio se resuelve en runtime por gymId / slug — nunca por build.
// BASE — el subdirectorio donde vive la aplicación.
//
// En GitHub Pages el sitio cuelga de /easygym/, no de la raíz del dominio.
// Esta constante se usa en TODAS partes (assets, manifiesto, service worker):
// cada ruta absoluta que se escape de ella apunta a la raíz del dominio, donde
// no hay nada — iconos que no cargan, PWA que abre en un 404.
const BASE = '/easygym/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        id: BASE,
        name: 'EasyGym — Administración de gimnasios',
        short_name: 'EasyGym',
        description:
          'Plataforma SaaS multi-tenant para gimnasios: socios, membresías, cobros, visitas, asistencias, clases, reservaciones y spinning.',
        theme_color: '#05070A',
        background_color: '#05070A',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        lang: 'es-MX',
        categories: ['business', 'health', 'fitness'],
        icons: [
          { src: BASE + 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: BASE + 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: BASE + 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Recepción', short_name: 'Recepción', url: BASE + 'recepcion' },
          { name: 'Mi membresía', short_name: 'Portal', url: BASE + 'portal' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        // Toda navegación cae en index.html: es una SPA, y sin esto el service
        // worker deja pasar /easygym/socios a la red, donde GitHub Pages
        // responde 404 porque ese archivo no existe.
        navigateFallback: BASE + 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://firestore.googleapis.com',
            handler: 'NetworkFirst',
            options: { cacheName: 'firestore', networkTimeoutSeconds: 8 },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, host: true },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
    // El SDK de Firebase se carga con `await import(...)` a nivel de módulo en
    // services/db.ts, así que el destino tiene que admitir top-level await.
    target: 'es2022',
  },
})
