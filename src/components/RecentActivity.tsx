import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'
import type { AuditLog } from '@/types'
import { useSession } from '@/state/SessionContext'
import { ACTION_LABEL, actionTone, watchAuditLogs } from '@/services/audit'
import { startOfDay } from '@/lib/date'
import { cx } from '@/lib/utils'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVIDAD RECIENTE.
//
// Lo que ha pasado hoy en el gimnasio, en una sola columna: entradas del
// personal, solicitudes de insumos, renovaciones, reservaciones.
//
// Sale de `auditLogs`, la bitácora que ya existía. No se inventa una segunda
// fuente: si hubiera dos, acabarían contando historias distintas.
// ═══════════════════════════════════════════════════════════════════════════

const TONE_DOT: Record<string, string> = {
  gym: 'bg-gym',
  cyber: 'bg-cyber-400',
  warn: 'bg-warn-400',
  danger: 'bg-danger-400',
  plasma: 'bg-plasma-400',
}

export function RecentActivity({ limit = 12 }: { limit?: number }) {
  const { gym, can } = useSession()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!gym) return
    // Solo lo de HOY y con tope: la bitácora crece más rápido que cualquier
    // otra colección y este bloque es un resumen, no un archivo.
    const off = watchAuditLogs({ gymId: gym.id, limit: 60 }, (rows) => {
      const since = startOfDay()
      setLogs(rows.filter((r) => r.createdAt >= since).slice(0, limit))
      setLoading(false)
    })
    return off
  }, [gym, limit])

  // La bitácora del gimnasio es información de administración.
  if (!can('settings.manage')) return null
  if (loading || logs.length === 0) return null

  return (
    <Card className="no-print mt-5">
      <CardHeader
        title="Actividad reciente"
        subtitle="Lo que ha pasado hoy"
        icon={<Activity className="h-4 w-4" />}
        action={
          <Link
            to="/actividad"
            className="text-[12.5px] font-semibold text-gym transition hover:brightness-110"
          >
            Ver todo →
          </Link>
        }
      />
      <CardBody>
        <ul className="space-y-0.5">
          {logs.map((log) => (
            <li key={log.id} className="flex items-baseline gap-3 py-1.5">
              <span className="w-16 shrink-0 font-mono text-[11.5px] text-ink-500 tnum">
                {new Date(log.createdAt).toLocaleTimeString('es-MX', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span
                className={cx(
                  'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                  TONE_DOT[actionTone(log.action)] ?? 'bg-ink-500',
                )}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-200">{log.summary}</span>
              <span className="hidden shrink-0 text-[11.5px] text-ink-600 sm:inline">
                {log.actorName}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-white/[.05] pt-3 text-[11.5px] text-ink-600">
          {ACTION_LABEL[logs[0].action] ?? ''} fue lo último. Todo queda registrado con quién lo hizo.
        </p>
      </CardBody>
    </Card>
  )
}
