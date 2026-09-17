import { Plus, Trash2 } from 'lucide-react'
import type { WorkSchedule, WorkShift } from '@/types'
import {
  WEEKDAY_LABEL,
  WEEK_ORDER,
  formatDuration,
  toMinutes,
  weeklyScheduledMinutes,
  type WeekdayKey,
} from '@/lib/workSchedule'
import { cx } from '@/lib/utils'
import { Button, IconButton } from '@/components/ui/Button'

// Editor de horario semanal.
//
// Un día sin turnos es DESCANSO: no hace falta una casilla aparte para decirlo.
// Y se pueden añadir varios turnos al mismo día porque la jornada partida
// —7:00 a 12:00 y 14:00 a 18:00— es lo normal en mantenimiento y limpieza, no
// una excepción rara.

export function ScheduleEditor({
  value,
  onChange,
}: {
  value: WorkSchedule
  onChange: (next: WorkSchedule) => void
}) {
  const total = weeklyScheduledMinutes(value)

  function setDay(day: WeekdayKey, shifts: WorkShift[]) {
    onChange({ ...value, [day]: shifts })
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-400">
          Un día sin turnos es <span className="text-ink-200">descanso</span>.
        </p>
        <span className="shrink-0 rounded-lg bg-gym/[.12] px-2.5 py-1 text-[12px] font-semibold text-gym tnum">
          {formatDuration(total)} / semana
        </span>
      </div>

      <div className="space-y-2">
        {WEEK_ORDER.map((day) => {
          const shifts = value[day] ?? []
          const rest = shifts.length === 0
          return (
            <div
              key={day}
              className={cx(
                'rounded-xl border px-3 py-2.5 transition-colors',
                rest ? 'border-white/[.05] bg-white/[.01]' : 'border-white/[.08] bg-white/[.03]',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cx(
                    'w-24 shrink-0 text-[13px] font-medium',
                    rest ? 'text-ink-500' : 'text-ink-100',
                  )}
                >
                  {WEEKDAY_LABEL[day]}
                </span>

                {rest ? (
                  <span className="flex-1 text-[12.5px] text-ink-600">Descanso</span>
                ) : (
                  <div className="flex flex-1 flex-wrap gap-2">
                    {shifts.map((shift, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 rounded-lg border border-white/[.08] bg-ink-950/50 px-2 py-1"
                      >
                        <input
                          type="time"
                          value={shift.start}
                          onChange={(e) => {
                            const next = [...shifts]
                            next[i] = { ...shift, start: e.target.value }
                            setDay(day, next)
                          }}
                          className="bg-transparent text-[12.5px] text-ink-100 outline-none [color-scheme:dark]"
                        />
                        <span className="text-ink-600">→</span>
                        <input
                          type="time"
                          value={shift.end}
                          onChange={(e) => {
                            const next = [...shifts]
                            next[i] = { ...shift, end: e.target.value }
                            setDay(day, next)
                          }}
                          className="bg-transparent text-[12.5px] text-ink-100 outline-none [color-scheme:dark]"
                        />
                        <IconButton
                          label="Quitar turno"
                          size="sm"
                          className="h-6 w-6"
                          onClick={() => setDay(day, shifts.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="h-3 w-3" />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  variant="subtle"
                  size="sm"
                  icon={<Plus className="h-3 w-3" />}
                  onClick={() => {
                    const last = shifts[shifts.length - 1]
                    // El turno nuevo empieza donde acabó el anterior: es lo que
                    // casi siempre se quiere y evita teclear cuatro campos.
                    const start = last?.end ?? '07:00'
                    const end = fromStart(start)
                    setDay(day, [...shifts, { start, end }])
                  }}
                >
                  Turno
                </Button>
              </div>

              {invalidShift(shifts) && (
                <p className="mt-1.5 text-[11.5px] text-warn-400">
                  Hay un turno que termina antes de empezar. Revísalo.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Cuatro horas después, como propuesta razonable de fin de turno. */
function fromStart(start: string): string {
  const m = toMinutes(start)
  if (m === null) return '16:00'
  const end = Math.min(23 * 60 + 59, m + 240)
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}

function invalidShift(shifts: WorkShift[]): boolean {
  return shifts.some((s) => {
    const a = toMinutes(s.start)
    const b = toMinutes(s.end)
    return a === null || b === null || b <= a
  })
}
