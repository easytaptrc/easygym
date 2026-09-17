// Genera los iconos PNG de la PWA sin dependencias externas.
//
// Dibuja la marca EasyGym (chip NFC verde + ondas blancas sobre negro) en un
// búfer RGBA y lo codifica como PNG con el zlib que ya trae Node. Evita meter
// una librería de imágenes al proyecto solo para producir cuatro archivos.
//
//   node scripts/generate-icons.mjs

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public/icons')

const BG = [5, 7, 10, 255]
const GREEN = [34, 224, 107, 255]
const WHITE = [255, 255, 255, 255]

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filtro "none"
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Lienzo mínimo con las primitivas que necesita el logotipo. */
function canvas(size) {
  const buf = Buffer.alloc(size * size * 4)
  const put = (x, y, color, alpha = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    for (let c = 0; c < 3; c++) buf[i + c] = Math.round(buf[i + c] * (1 - alpha) + color[c] * alpha)
    buf[i + 3] = 255
  }
  return {
    buf,
    fill(color) {
      for (let i = 0; i < size * size; i++) {
        buf[i * 4] = color[0]
        buf[i * 4 + 1] = color[1]
        buf[i * 4 + 2] = color[2]
        buf[i * 4 + 3] = 255
      }
    },
    /** Rectángulo con esquinas redondeadas y antialias por supermuestreo. */
    roundRect(x0, y0, w, h, r, color) {
      for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
          let hits = 0
          for (let sy = 0; sy < 3; sy++) {
            for (let sx = 0; sx < 3; sx++) {
              const px = x + (sx + 0.5) / 3
              const py = y + (sy + 0.5) / 3
              const cx = Math.min(Math.max(px, x0 + r), x0 + w - r)
              const cy = Math.min(Math.max(py, y0 + r), y0 + h - r)
              const inside =
                px >= x0 && px <= x0 + w && py >= y0 && py <= y0 + h &&
                (px - cx) ** 2 + (py - cy) ** 2 <= r * r + 0.001
              // Dentro del "cuerpo" recto también cuenta.
              const straight =
                px >= x0 && px <= x0 + w && py >= y0 + r && py <= y0 + h - r
              const straight2 =
                py >= y0 && py <= y0 + h && px >= x0 + r && px <= x0 + w - r
              if (inside || straight || straight2) hits++
            }
          }
          if (hits > 0) put(x, y, color, hits / 9)
        }
      }
    },
    /** Arco de grosor `thick`, de `a0` a `a1` radianes. */
    arc(cx, cy, radius, thick, a0, a1, color, alpha = 1) {
      const steps = Math.ceil(radius * 14)
      for (let i = 0; i <= steps; i++) {
        const a = a0 + ((a1 - a0) * i) / steps
        for (let t = -thick / 2; t <= thick / 2; t += 0.35) {
          const r = radius + t
          put(Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)), color, alpha)
          put(Math.round(cx + r * Math.cos(a)) + 1, Math.round(cy + r * Math.sin(a)), color, alpha * 0.6)
        }
      }
    },
  }
}

function drawLogo(size, { maskable = false } = {}) {
  const c = canvas(size)
  c.fill(BG)
  // En un icono "maskable" el sistema recorta un círculo: se deja más margen.
  const s = size / 100
  const pad = maskable ? 22 : 12
  const scale = (100 - pad * 2) / 100

  const x = (n) => (pad + n * scale) * s
  const y = (n) => (pad + n * scale) * s
  const d = (n) => n * scale * s

  // Chip
  c.roundRect(x(6), y(26), d(30), d(48), d(7), GREEN)
  c.roundRect(x(13), y(34), d(7), d(8), d(2), BG)
  c.roundRect(x(13), y(46), d(7), d(16), d(2), BG)
  c.roundRect(x(24), y(34), d(7), d(28), d(2), BG)

  // Ondas
  const cx = x(38)
  const cy = y(50)
  c.arc(cx, cy, d(18), d(5), -0.85, 0.85, WHITE, 0.95)
  c.arc(cx, cy, d(34), d(5), -0.85, 0.85, WHITE, 0.6)
  c.arc(cx, cy, d(50), d(5), -0.85, 0.85, WHITE, 0.3)

  return encodePng(size, size, c.buf)
}

mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, 'icon-192.png'), drawLogo(192))
writeFileSync(resolve(OUT, 'icon-512.png'), drawLogo(512))
writeFileSync(resolve(OUT, 'maskable-512.png'), drawLogo(512, { maskable: true }))
writeFileSync(resolve(OUT, 'apple-touch-icon.png'), drawLogo(180))

console.log('Iconos generados en public/icons/')
