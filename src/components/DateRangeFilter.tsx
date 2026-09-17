import { useState } from 'react'
import { CalendarRange } from 'lucide-react'
import { customRange, dayKey, presetRange, type DateRange, type RangePreset } from '@/lib/date'
import { cx } from '@/lib/utils'
import { Segmented } from './ui/Inputs'

// Filtro de periodo compartido por el panel y los reportes.
// Vive arriba de las gráficas, en una sola fila, como espera cualquiera que
// haya usado una herramienta de analítica.

const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
  { value: 'custom', label: 'Personalizado' },
]

export function DateRangeFilter({
  value,
  onChange,
  className,
}: {
  value: DateRange
  onChange: (r: DateRange) => void
  className?: string
}) {
  const [from, setFrom] = useState(dayKey(value.from))
  const [to, setTo] = useState(dayKey(value.to))

  function pick(preset: RangePreset) {
    if (preset === 'custom') {
      onChange(customRange(from, to))
    } else {
      onChange(presetRange(preset))
    }
  }

  function applyCustom(nextFrom: string, nextTo: string) {
    setFrom(nextFrom)
    setTo(nextTo)
    if (nextFrom <= nextTo) onChange(customRange(nextFrom, nextTo))
  }

  return (
    <div className={cx('flex flex-wrap items-center gap-2', className)}>
      <Segmented value={value.preset} onChange={pick} options={PRESETS} size="sm" />

      {value.preset === 'custom' && (
        <div className="flex items-center gap-1.5 rounded-xl border border-white/[.07] bg-ink-900/70 px-2.5 py-1.5">
          <CalendarRange className="h-3.5 w-3.5 shrink-0 text-ink-500" />
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => applyCustom(e.target.value, to)}
            className="bg-transparent text-[12.5px] text-ink-200 outline-none [color-scheme:dark]"
          />
          <span className="text-ink-600">—</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => applyCustom(from, e.target.value)}
            className="bg-transparent text-[12.5px] text-ink-200 outline-none [color-scheme:dark]"
          />
        </div>
      )}
    </div>
  )
}
