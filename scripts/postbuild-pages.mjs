import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// ═══════════════════════════════════════════════════════════════════════════
// GitHub Pages no sabe qué es una SPA.
//
// EL PROBLEMA
//
// Pages sirve archivos estáticos. Cuando alguien abre /easygym/socios
// directamente —escribiéndolo, recargando, o llegando desde un enlace—, busca
// un archivo llamado `socios` y no lo encuentra: responde 404.
//
// No es un caso raro. Es lo que pasa CADA VEZ que alguien recarga la página
// estando dentro de la aplicación.
//
// LA SOLUCIÓN
//
// Pages usa `404.html` para cualquier ruta que no exista. Si ese archivo es
// una copia de `index.html`, la SPA arranca igual y React Router resuelve la
// ruta en el cliente. El navegador recibe un 404 en la cabecera, pero el
// usuario ve su pantalla.
//
// Tiene que ser una COPIA del index YA CONSTRUIDO, no un archivo en `public/`:
// necesita las referencias a los assets con su hash, que solo existen después
// del build.
// ═══════════════════════════════════════════════════════════════════════════

const dist = resolve(process.cwd(), 'dist')
const index = resolve(dist, 'index.html')
const fallback = resolve(dist, '404.html')

if (!existsSync(index)) {
  console.error('[EasyGym] No hay dist/index.html. ¿Se ejecutó el build?')
  process.exit(1)
}

copyFileSync(index, fallback)
console.log('[EasyGym] 404.html generado — las rutas profundas ya no mueren en GitHub Pages.')
