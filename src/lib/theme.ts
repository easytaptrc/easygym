import type { GymBranding } from '@/types'
import { BRAND } from '@/config/brand'

// El color de cada gimnasio se inyecta como variables CSS. Tailwind las lee
// con `rgb(var(--gym-accent) / <alpha-value>)`, así que todas las clases
// `text-gym`, `bg-gym/10`, `ring-gym/30`… cambian a la vez sin recompilar.

export function applyGymTheme(branding: Pick<GymBranding, 'accent' | 'accentSoft' | 'accentDeep'>): void {
  const root = document.documentElement
  root.style.setProperty('--gym-accent', branding.accent)
  root.style.setProperty('--gym-accent-soft', branding.accentSoft)
  root.style.setProperty('--gym-accent-deep', branding.accentDeep)
}

/** Vuelve al verde de EasyGym (landing, login, superadmin). */
export function resetTheme(): void {
  const root = document.documentElement
  root.style.setProperty('--gym-accent', BRAND.accentRgb)
  root.style.setProperty('--gym-accent-soft', '143 255 193')
  root.style.setProperty('--gym-accent-deep', '11 166 72')
}

/** "34 224 107" → "#22E06B" (para inputs type=color). */
export function rgbToHex(rgb: string): string {
  const [r, g, b] = rgb.split(/\s+/).map(Number)
  return `#${[r, g, b].map((n) => (n ?? 0).toString(16).padStart(2, '0')).join('')}`
}

/** "#22E06B" → "34 224 107" */
export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/** Aclara u oscurece un color RGB en tripleta. `amount` de -1 a 1. */
export function shift(rgb: string, amount: number): string {
  const [r, g, b] = rgb.split(/\s+/).map(Number)
  const f = (c: number) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))
      .toString()
      .padStart(1, '0')
  return `${f(r ?? 0)} ${f(g ?? 0)} ${f(b ?? 0)}`
}
