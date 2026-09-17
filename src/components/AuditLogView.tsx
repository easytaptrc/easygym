import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Download, FileClock, Search, X } from 'lucide-react'
import type { AuditAction, AuditLog } from '@/types'
import { ACTION_GROUPS, ACTION_LABEL, actionTone, watchAuditLogs } from '@/services/audit'
import { fmtDateTime, presetRange, type DateRange } from '@/lib/date'
import { cx, downloadCsv, norm } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Avatar, Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Inputs'
import { DateRangeFilter } from './DateRangeFilter'

// ═══════════════════════════════════════════════════════════════════════════
// Bitácora — quién hizo qué.
//
// El mismo componente sirve a dos públicos con permisos distintos:
//
//   · SUPERADMIN con `gymId = null` → toda la plataforma
//   · OWNER / ADMIN con su `gymId`  → SOLO su gimnasio
//
// El aislamiento no depende de esta pantalla: las reglas de Firestore ya
// rechazan leer la bitácora de otro gimnasio. Aquí el `gymId` solo decide qué
// se pide, no qué se permite.
//
// La consulta SIEMPRE lleva tope. Una bitácora crece más rápido que cualquier
// otra colección —cada cobro, cada entrada, cada edición— y listarla entera
// sería la consulta más cara del producto.
// ═══════════════════════════════════════════════════════════════════════════

const TONE_DOT: Record<string, string> = {
  gym: 'bg-gym',
  cyber: 'bg-cyber-400',
  warn: 'bg-warn-400',
  danger: 'bg-danger-400',
  plasma: 'bg-plasma-400',
}

const PAGE = 60

export function AuditLogView({
  gymId,
  /** Nombre del gimnasio por id, para la columna de plataforma. */
  gymNames,
  showGymColumn,
}: {
  gymId: string | null
  gymNames?: Record<string, string>
  showGymColumn?: boolean
}) {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<DateRange>(() => presetRange('month'))
  const [group, setGroup] = useState('ALL')
  const [action, setAction] = useState<string>('ALL')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [open, setOpen] = useState<string | null>(null)

  // Se traen los últimos registros y se filtra en memoria. Con el tope de 400
  // eso es barato; sin tope sería insostenible, por eso el tope no es opcional.
  useEffect(() => {
    setLoading(true)
    const off = watchAuditLogs({ gymId, limit: 400 }, (rows) => {
      setLogs(rows)
      setLoading(false)
    })
    return off
  }, [gymId])

  const actionsOfGroup = useMemo<AuditAction[]>(() => {
    if (group === 'ALL') return []
    return ACTION_GROUPS.find((g) => g.label === group)?.actions ?? []
  }, [group])

  const rows = useMemo(() => {
    const q = norm(query.trim())
    return logs
      .filter((l) => l.createdAt >= range.from && l.createdAt <= range.to)
      .filter((l) => (group === 'ALL' ? true : actionsOfGroup.includes(l.action)))
      .filter((l) => (action === 'ALL' ? true : l.action === action))
      .filter((l) =>
        !q ? true : norm(l.summary).includes(q) || norm(l.actorName).includes(q) || norm(l.entityType).includes(q),
      )
  }, [logs, range, group, actionsOfGroup, action, query])

  const visible = rows.slice(0, shown)

  function exportCsv() {
    downloadCsv(
      `bitacora-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((l) => ({
        fecha: fmtDateTime(l.createdAt),
        gimnasio: l.gymId ? (gymNames?.[l.gymId] ?? l.gymId) : 'Plataforma',
        usuario: l.actorName,
        rol: l.actorRole,
        accion: ACTION_LABEL[l.action] ?? l.action,
        detalle: l.summary,
        entidad: l.entityType,
        entidadId: l.entityId ?? '',
      })),
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setShown(PAGE)
            }}
            placeholder="Buscar en la bitácora…"
            className="h-10 w-full rounded-xl border border-white/10 bg-ink-950/60 pl-9 pr-9 text-sm text-ink-100 transition placeholder:text-ink-500 focus:bg-ink-950 focus:outline-none focus:ring-4 focus:ring-white/10"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-500 transition hover:bg-white/5 hover:text-ink-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Select
          value={group}
          onChange={(e) => {
            setGroup(e.target.value)
            setAction('ALL')
            setShown(PAGE)
          }}
          containerClassName="w-full sm:w-44"
        >
          <option value="ALL">Toda la actividad</option>
          {ACTION_GROUPS.map((g) => (
            <option key={g.label} value={g.label}>
              {g.label}
            </option>
          ))}
        </Select>

        {group !== 'ALL' && (
          <Select
            value={action}
            onChange={(e) => {
              setAction(e.target.value)
              setShown(PAGE)
            }}
            containerClassName="w-full sm:w-56"
          >
            <option value="ALL">Cualquier acción</option>
            {actionsOfGroup.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a] ?? a}
              </option>
            ))}
          </Select>
        )}

        <DateRangeFilter
          value={range}
          onChange={(r) => {
            setRange(r)
            setShown(PAGE)
          }}
        />

        <Button
          variant="ghost"
          size="sm"
          icon={<Download className="h-3.5 w-3.5" />}
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="ml-auto"
        >
          Exportar
        </Button>
      </div>

      {loading ? (
        <LoadingBlock label="Cargando bitácora…" />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileClock className="h-6 w-6" />}
            title="Sin registros en este periodo"
            detail="Cambia el rango de fechas o quita los filtros para ver actividad anterior."
          />
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <ul>
              {visible.map((log) => {
                const tone = actionTone(log.action)
                const expandable = Boolean(
                  (log.before && Object.keys(log.before).length) || (log.after && Object.keys(log.after).length),
                )
                const isOpen = open === log.id

                return (
                  <li key={log.id} className="border-b border-white/[.04] last:border-0">
                    <div
                      className={cx(
                        'flex items-start gap-3 px-4 py-3 transition-colors sm:px-5',
                        expandable && 'cursor-pointer hover:bg-white/[.02]',
                      )}
                      onClick={expandable ? () => setOpen(isOpen ? null : log.id) : undefined}
                    >
                      <span className="mt-2 flex h-2 w-2 shrink-0 items-center justify-center">
                        <span className={cx('h-2 w-2 rounded-full', TONE_DOT[tone] ?? 'bg-ink-500')} />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[13.5px] font-medium text-ink-100">{log.summary}</span>
                          <Badge tone={tone}>{ACTION_LABEL[log.action] ?? log.action}</Badge>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-500">
                          <Avatar name={log.actorName} size={16} />
                          <span className="text-ink-400">{log.actorName}</span>
                          <span>·</span>
                          <span>{log.actorRole}</span>
                          {showGymColumn && (
                            <>
                              <span>·</span>
                              <span className="text-ink-400">
                                {log.gymId ? (gymNames?.[log.gymId] ?? log.gymId) : 'Plataforma'}
                              </span>
                            </>
                          )}
                          <span>·</span>
                          <span className="tnum">{fmtDateTime(log.createdAt)}</span>
                        </div>

                        {isOpen && (
                          <div className="mt-3 grid gap-3 rounded-xl border border-white/[.07] bg-ink-950/50 p-3.5 sm:grid-cols-2">
                            <ChangeBlock title="Antes" data={log.before} muted />
                            <ChangeBlock title="Después" data={log.after} />
                          </div>
                        )}
                      </div>

                      {expandable && (
                        <ChevronDown
                          className={cx(
                            'mt-1 h-4 w-4 shrink-0 text-ink-500 transition-transform',
                            isOpen && 'rotate-180',
                          )}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-ink-500 tnum">
              {visible.length} de {rows.length}
              {logs.length >= 400 && ' (últimos 400 registros)'}
            </p>
            {shown < rows.length && (
              <Button variant="ghost" size="sm" onClick={() => setShown(shown + PAGE)}>
                Ver más
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** Valores antes/después del cambio, en el mismo orden en ambas columnas. */
function ChangeBlock({
  title,
  data,
  muted,
}: {
  title: string
  data: Record<string, unknown> | null | undefined
  muted?: boolean
}) {
  const entries = Object.entries(data ?? {})
  return (
    <div>
      <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.14em] text-ink-500">{title}</p>
      {entries.length === 0 ? (
        <p className="text-[12px] text-ink-600">—</p>
      ) : (
        <dl className="space-y-1">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 font-mono text-[11px] text-ink-500">{k}</dt>
              <dd
                className={cx(
                  // El valor anterior va tachado, pero legible: si no se puede
                  // leer, la columna «antes» no sirve para nada.
                  'min-w-0 truncate text-right font-mono text-[11.5px]',
                  muted ? 'text-ink-400 line-through decoration-ink-600' : 'text-ink-100',
                )}
                title={format(v)}
              >
                {format(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function format(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
