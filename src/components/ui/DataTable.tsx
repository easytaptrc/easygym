import { useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { cx } from '@/lib/utils'
import { Skeleton } from './Feedback'

// ═══════════════════════════════════════════════════════════════════════════
// Tabla de datos.
//
// En escritorio es una tabla. En móvil, cada fila se convierte en una tarjeta:
// una tabla de 8 columnas dentro de un teléfono es ilegible, y la recepción
// de un gimnasio se opera muchas veces desde el celular.
// ═══════════════════════════════════════════════════════════════════════════

export interface Column<T> {
  key: string
  header: ReactNode
  /** Contenido de la celda. */
  cell: (row: T) => ReactNode
  /** Valor para ordenar. Si falta, la columna no es ordenable. */
  sortValue?: (row: T) => string | number
  className?: string
  headerClassName?: string
  /** Oculta esta columna en móvil (la tarjeta la sigue mostrando). */
  hideOnMobile?: boolean
  align?: 'left' | 'right' | 'center'
}

interface Props<T> {
  columns: Array<Column<T>>
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  empty?: ReactNode
  onRowClick?: (row: T) => void
  pageSize?: number
  /** Renderizado alternativo para móvil. Por defecto, tarjeta genérica. */
  mobileCard?: (row: T) => ReactNode
  className?: string
  dense?: boolean
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  pageSize = 25,
  mobileCard,
  className,
  dense,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return rows
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (av === bv) return 0
      const cmp = av > bv ? 1 : -1
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir, columns])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const visible = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize)

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(0)
  }

  if (loading) {
    return (
      <div className={cx('space-y-2 p-4', className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) return <>{empty}</>

  const align = (a?: Column<T>['align']) =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left'

  return (
    <div className={className}>
      {/* ── Escritorio ── */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cx(
                    'sticky top-0 z-10 whitespace-nowrap border-b border-white/[.07] bg-ink-900/95 px-4 py-3',
                    'text-[11px] font-semibold uppercase tracking-[.14em] text-ink-400 backdrop-blur',
                    align(c.align),
                    c.headerClassName,
                  )}
                >
                  {c.sortValue ? (
                    <button
                      onClick={() => toggleSort(c.key)}
                      className={cx(
                        'inline-flex items-center gap-1 transition hover:text-ink-100',
                        sortKey === c.key && 'text-gym',
                      )}
                    >
                      {c.header}
                      <ChevronsUpDown className="h-3 w-3 opacity-60" />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx(
                  'border-b border-white/[.04] transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-white/[.03]',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cx(
                      'px-4 align-middle text-ink-200',
                      dense ? 'py-2' : 'py-3',
                      align(c.align),
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Móvil ── */}
      <div className="divide-y divide-white/[.05] md:hidden">
        {visible.map((row) => (
          <div
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cx('px-4 py-3.5', onRowClick && 'cursor-pointer active:bg-white/[.04]')}
          >
            {mobileCard ? (
              mobileCard(row)
            ) : (
              <dl className="space-y-1.5">
                {columns
                  .filter((c) => !c.hideOnMobile)
                  .map((c) => (
                    <div key={c.key} className="flex items-baseline justify-between gap-3">
                      <dt className="shrink-0 text-[11px] uppercase tracking-wide text-ink-500">{c.header}</dt>
                      <dd className="min-w-0 truncate text-right text-sm text-ink-200">{c.cell(row)}</dd>
                    </div>
                  ))}
              </dl>
            )}
          </div>
        ))}
      </div>

      {/* ── Paginación ── */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-white/[.06] px-4 py-3">
          <p className="text-[12.5px] text-ink-400 tnum">
            {safePage * pageSize + 1}–{Math.min(sorted.length, (safePage + 1) * pageSize)} de {sorted.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 transition hover:bg-white/5 disabled:opacity-30"
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 text-[12.5px] font-medium text-ink-300 tnum">
              {safePage + 1} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 transition hover:bg-white/5 disabled:opacity-30"
              aria-label="Página siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
