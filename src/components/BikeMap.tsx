import { Bike as BikeIcon, Wrench } from 'lucide-react'
import type { Bike, Reservation, SpinningLayout } from '@/types'
import { buildBikeMap, type BikeCell } from '@/services/reservations'
import { cx } from '@/lib/utils'

// ═══════════════════════════════════════════════════════════════════════════
// Mapa de bicicletas — se lee como un mapa de butacas de cine.
//
//                        INSTRUCTOR
//                 🚲01   🚲02   🚲03   🚲04   🚲05
//                 🚲06   🚲07   ...
//
//   VERDE  disponible      ROJO  reservada por alguien más
//   AZUL   seleccionada    GRIS  bloqueada / mantenimiento
//   ANILLO tu reservación
//
// El estado se calcula en `buildBikeMap`, no aquí: este componente solo pinta.
// Quién puede quedarse con una bici lo decide la transacción de `reserveSlot`.
// ═══════════════════════════════════════════════════════════════════════════

const STATE_STYLE: Record<BikeCell['state'], string> = {
  available:
    'border-tap-500/35 bg-tap-500/[.10] text-tap-300 hover:border-tap-400 hover:bg-tap-500/20 hover:scale-[1.06] cursor-pointer',
  selected: 'border-cyber-400 bg-cyber-400/25 text-cyber-200 scale-[1.06] shadow-glow-cyber cursor-pointer',
  reserved: 'border-danger-500/35 bg-danger-500/[.12] text-danger-300/80 cursor-not-allowed',
  mine: 'border-gym bg-gym/20 text-gym cursor-pointer ring-2 ring-gym/40',
  blocked: 'border-white/[.07] bg-ink-800/60 text-ink-600 cursor-not-allowed',
}

const LEGEND: Array<{ state: BikeCell['state']; label: string }> = [
  { state: 'available', label: 'Disponible' },
  { state: 'reserved', label: 'Reservada' },
  { state: 'selected', label: 'Seleccionada' },
  { state: 'mine', label: 'Tu bicicleta' },
  { state: 'blocked', label: 'Bloqueada' },
]

interface Props {
  bikes: Bike[]
  reservations: Reservation[]
  layout: SpinningLayout
  selectedBikeId: string | null
  onSelect: (bike: Bike) => void
  myMemberId?: string | null
  /** Modo administración: permite tocar también las bloqueadas. */
  editable?: boolean
  className?: string
  /** Oculta la leyenda (cuando ya está en otro sitio de la pantalla). */
  hideLegend?: boolean
}

export function BikeMap({
  bikes,
  reservations,
  layout,
  selectedBikeId,
  onSelect,
  myMemberId,
  editable,
  className,
  hideLegend,
}: Props) {
  const cells = buildBikeMap(bikes, reservations, selectedBikeId, myMemberId ?? null)

  const rows: BikeCell[][] = []
  for (const cell of cells) {
    ;(rows[cell.bike.row] ??= []).push(cell)
  }

  const instructorBar = (
    <div className="mx-auto mb-5 w-full max-w-sm">
      <div className="relative overflow-hidden rounded-xl border border-white/[.08] bg-gradient-to-b from-white/[.06] to-transparent py-2.5 text-center">
        <span className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-gym/60 to-transparent" />
        <p className="font-mono text-[10.5px] uppercase tracking-[.3em] text-ink-400">Instructor</p>
      </div>
    </div>
  )

  return (
    <div className={className}>
      {layout.instructorAt === 'top' && instructorBar}

      <div className="flex flex-col items-center gap-2.5">
        {rows.map((row, rIdx) => (
          <div key={rIdx} className="flex items-center gap-2 sm:gap-2.5">
            {row
              .sort((a, b) => a.bike.col - b.bike.col)
              .map((cell, cIdx) => (
                <span key={cell.bike.id} className="flex items-center">
                  <BikeButton
                    cell={cell}
                    onSelect={onSelect}
                    editable={editable ?? false}
                  />
                  {/* Pasillo */}
                  {layout.aisles.includes(cIdx) && <span className="w-5 sm:w-7" />}
                </span>
              ))}
          </div>
        ))}
      </div>

      {layout.instructorAt === 'bottom' && <div className="mt-5">{instructorBar}</div>}

      {!hideLegend && (
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {LEGEND.map((l) => (
            <li key={l.state} className="flex items-center gap-1.5">
              <span
                className={cx(
                  'h-3.5 w-3.5 rounded-md border',
                  STATE_STYLE[l.state].split(' ').filter((c) => c.startsWith('border-') || c.startsWith('bg-') || c.startsWith('ring-')).join(' '),
                )}
              />
              <span className="text-[11.5px] text-ink-400">{l.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BikeButton({
  cell,
  onSelect,
  editable,
}: {
  cell: BikeCell
  onSelect: (bike: Bike) => void
  editable: boolean
}) {
  const clickable = editable || cell.state === 'available' || cell.state === 'selected' || cell.state === 'mine'
  const maintenance = cell.bike.status === 'MAINTENANCE'

  const title =
    cell.state === 'reserved'
      ? `Bicicleta ${cell.bike.number} — reservada${cell.reservedBy ? ` por ${cell.reservedBy}` : ''}`
      : cell.state === 'blocked'
        ? `Bicicleta ${cell.bike.number} — ${maintenance ? 'en mantenimiento' : 'bloqueada'}`
        : `Bicicleta ${cell.bike.number}`

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onSelect(cell.bike)}
      title={title}
      aria-label={title}
      aria-pressed={cell.state === 'selected'}
      className={cx(
        'grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition-all duration-200 ease-spring sm:h-[52px] sm:w-[52px]',
        STATE_STYLE[cell.state],
      )}
    >
      {maintenance ? (
        <Wrench className="h-3.5 w-3.5" />
      ) : (
        <>
          <BikeIcon className="h-3.5 w-3.5 opacity-70" />
          <span className="text-[10.5px] font-bold leading-none tnum">
            {String(cell.bike.number).padStart(2, '0')}
          </span>
        </>
      )}
    </button>
  )
}
