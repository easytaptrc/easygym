/**
 * Une clases condicionalmente. Equivalente mínimo de `clsx`.
 * Acepta cualquier valor y se queda solo con las cadenas no vacías, así
 * `cond && 'clase'` funciona aunque `cond` sea un número o un ReactNode.
 */
export function cx(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ')
}

/** ID corto tipo Firestore (20 chars, alfabeto base62). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export function newId(prefix = ''): string {
  let out = ''
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return prefix ? `${prefix}_${out}` : out
}

/** Convierte "Iron Fitness Studio" → "iron-fitness-studio". */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

/** Color determinista a partir de un texto (para avatares sin foto). */
export function hueFrom(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360
  return h
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((acc, it) => acc + pick(it), 0)
}

export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const it of items) {
    const k = key(it)
    ;(out[k] ||= []).push(it)
  }
  return out
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items))
}

/** Debounce simple para cajas de búsqueda. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

/** Normaliza texto para búsquedas: sin acentos, minúsculas. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Descarga un arreglo de objetos como CSV (reportes). */
export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
