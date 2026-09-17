const MXN = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const MXN_COMPACT = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
})

const NUM = new Intl.NumberFormat('es-MX')

export function money(n: number | null | undefined): string {
  return MXN.format(n ?? 0)
}

/** Sin centavos. Para KPIs y precios de plan. */
export function money0(n: number | null | undefined): string {
  return MXN_COMPACT.format(n ?? 0)
}

/** $12.4k para ejes de gráficas. */
export function moneyShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return `$${Math.round(n)}`
}

export function num(n: number | null | undefined): string {
  return NUM.format(n ?? 0)
}

export function pct(n: number, digits = 0): string {
  return `${n >= 0 ? '' : ''}${n.toFixed(digits)}%`
}

export function phoneFmt(p: string | null | undefined): string {
  if (!p) return '—'
  const d = p.replace(/\D/g, '')
  if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`
  return p
}

/** "Juan Carlos Pérez" → "Juan C. Pérez" (para tablas estrechas). */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length <= 2) return name
  return `${parts[0]} ${parts[1][0]}. ${parts[parts.length - 1]}`
}
