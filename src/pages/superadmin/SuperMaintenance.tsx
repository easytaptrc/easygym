import { useState } from 'react'
import { AlertTriangle, Calculator, Database, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import type { Gym } from '@/types'
import { TenantRepo } from '@/services/db'
import { rebuildAggregates } from '@/services/aggregates'
import { syncAllEntitlements } from '@/services/planCatalog'
import { recordAudit } from '@/services/audit'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { LoadingBlock } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { usePlatformData } from './usePlatformData'

// ═══════════════════════════════════════════════════════════════════════════
// Mantenimiento de la plataforma.
//
// Todas estas tareas son RECONSTRUCTIVAS, no destructivas: recalculan datos
// derivados a partir de los documentos reales. Si un contador quedó desfasado
// por una escritura que falló a medias, esto lo arregla; ninguna de ellas
// borra un socio, un pago ni un registro de la bitácora.
//
// Son caras —leen colecciones enteras— y por eso son manuales y están aquí,
// separadas de la operación diaria. En producción viven en Cloud Functions
// invocables, no en el navegador: ver functions/README.md.
// ═══════════════════════════════════════════════════════════════════════════

interface TaskResult {
  ok: boolean
  message: string
  at: number
}

export default function SuperMaintenance() {
  const { gyms, loading } = usePlatformData()
  const { user } = useSession()
  const toast = useToast()

  const [running, setRunning] = useState<string | null>(null)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<Record<string, TaskResult>>({})

  function finish(id: string, ok: boolean, message: string) {
    setResults((r) => ({ ...r, [id]: { ok, message, at: Date.now() } }))
    setRunning(null)
    setProgress('')
  }

  /** Copia funcionalidades y límites del plan a todos sus gimnasios. */
  async function resyncEntitlements() {
    setRunning('entitlements')
    try {
      const n = await syncAllEntitlements()
      await recordAudit({
        gymId: null,
        actor: user,
        action: 'AGGREGATES_REBUILT',
        entityType: 'gyms',
        summary: `Resincronizó permisos de ${n} ${n === 1 ? 'gimnasio' : 'gimnasios'}`,
      })
      toast.success('Permisos al día', `${n} ${n === 1 ? 'gimnasio' : 'gimnasios'}.`)
      finish('entitlements', true, `${n} ${n === 1 ? 'gimnasio actualizado' : 'gimnasios actualizados'}`)
    } catch (err) {
      const friendly = reportError('syncAllEntitlements', err)
      toast.error('No se pudo resincronizar', friendly.message)
      finish('entitlements', false, friendly.message)
    }
  }

  /** Recalcula contadores y resúmenes diarios de TODOS los gimnasios. */
  async function rebuildAll() {
    setRunning('aggregates')
    let done = 0
    let failed = 0
    try {
      for (const gym of gyms as Gym[]) {
        setProgress(`${gym.name} (${done + 1}/${gyms.length})`)
        try {
          await rebuildAggregates(new TenantRepo(gym.id))
          done += 1
        } catch (err) {
          // Un gimnasio que falla no debe detener a los demás: se cuenta y
          // se sigue, porque dejar la mitad a medias es peor que terminar.
          reportError('rebuildAggregates', err, { gymId: gym.id })
          failed += 1
        }
      }
      await recordAudit({
        gymId: null,
        actor: user,
        action: 'AGGREGATES_REBUILT',
        entityType: 'counters',
        summary: `Recalculó estadísticas de ${done} ${done === 1 ? 'gimnasio' : 'gimnasios'}`,
      })
      const msg = failed === 0 ? `${done} gimnasios recalculados` : `${done} recalculados · ${failed} con error`
      toast.success('Estadísticas recalculadas', msg)
      finish('aggregates', failed === 0, msg)
    } catch (err) {
      const friendly = reportError('rebuildAll', err)
      toast.error('No se pudo recalcular', friendly.message)
      finish('aggregates', false, friendly.message)
    }
  }

  /** Detecta gimnasios cuyos entitlements no coinciden con su plan. */
  async function checkDrift() {
    setRunning('drift')
    try {
      const stale = (gyms as Gym[]).filter((g) => !g.entitlements || g.entitlements.planId !== g.planId)
      const msg =
        stale.length === 0
          ? 'Todos los gimnasios coinciden con su plan'
          : `${stale.length} ${stale.length === 1 ? 'gimnasio necesita' : 'gimnasios necesitan'} resincronizar: ${stale
              .slice(0, 5)
              .map((g) => g.name)
              .join(', ')}${stale.length > 5 ? '…' : ''}`
      if (stale.length === 0) toast.success('Sin desviaciones', msg)
      else toast.warning('Hay desviaciones', msg)
      finish('drift', stale.length === 0, msg)
    } catch (err) {
      const friendly = reportError('checkDrift', err)
      finish('drift', false, friendly.message)
    }
  }

  if (loading) return <LoadingBlock />

  const TASKS = [
    {
      id: 'drift',
      icon: <ShieldCheck className="h-5 w-5" />,
      title: 'Comprobar desviaciones',
      description:
        'Revisa si algún gimnasio tiene permisos que no corresponden a su plan. Solo lee: no cambia nada.',
      cost: 'Barato · lee la lista de gimnasios',
      action: checkDrift,
      label: 'Comprobar',
    },
    {
      id: 'entitlements',
      icon: <RefreshCw className="h-5 w-5" />,
      title: 'Resincronizar permisos',
      description:
        'Vuelve a copiar funcionalidades y límites de cada plan a sus gimnasios. Úsalo si un cambio de plan no llegó a aplicarse.',
      cost: `Medio · escribe hasta ${gyms.length} documentos`,
      action: resyncEntitlements,
      label: 'Resincronizar',
    },
    {
      id: 'aggregates',
      icon: <Calculator className="h-5 w-5" />,
      title: 'Recalcular estadísticas',
      description:
        'Rehace contadores y resúmenes diarios leyendo los documentos reales de cada gimnasio. Corrige cualquier desfase acumulado.',
      cost: 'CARO · lee todas las colecciones de todos los gimnasios',
      action: rebuildAll,
      label: 'Recalcular todo',
      heavy: true,
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Plataforma"
        title="Mantenimiento"
        description="Tareas que reconstruyen datos derivados. Ninguna borra información: los socios, los pagos y la bitácora quedan intactos."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {TASKS.map((task) => {
          const result = results[task.id]
          const isRunning = running === task.id
          return (
            <Card key={task.id} className="flex flex-col p-5">
              <span
                className={cx(
                  'grid h-10 w-10 place-items-center rounded-xl border',
                  task.heavy
                    ? 'border-warn-500/25 bg-warn-500/10 text-warn-300'
                    : 'border-plasma-400/25 bg-plasma-400/10 text-plasma-300',
                )}
              >
                {task.icon}
              </span>

              <h3 className="mt-3.5 text-[15px] font-semibold text-ink-50">{task.title}</h3>
              <p className="mt-1.5 flex-1 text-[12.5px] leading-relaxed text-ink-400">{task.description}</p>

              <p
                className={cx(
                  'mt-3 flex items-start gap-1.5 text-[11.5px]',
                  task.heavy ? 'text-warn-400' : 'text-ink-500',
                )}
              >
                {task.heavy && <AlertTriangle className="mt-px h-3 w-3 shrink-0" />}
                {task.cost}
              </p>

              <Button
                variant={task.heavy ? 'ghost' : 'primary'}
                className="mt-4"
                block
                icon={<Play className="h-3.5 w-3.5" />}
                loading={isRunning}
                disabled={running !== null && !isRunning}
                onClick={task.action}
              >
                {task.label}
              </Button>

              {isRunning && progress && (
                <p className="mt-2 truncate text-center text-[11.5px] text-ink-500">{progress}</p>
              )}

              {result && !isRunning && (
                <p
                  className={cx(
                    'mt-2 text-center text-[11.5px] leading-snug',
                    result.ok ? 'text-tap-400' : 'text-warn-400',
                  )}
                >
                  {result.message}
                </p>
              )}
            </Card>
          )
        })}
      </div>

      <Card className="mt-5 p-5">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink-50">
          <Database className="h-4 w-4 text-ink-400" />
          Respaldos
        </h3>
        <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-ink-400">
          Los respaldos no se lanzan desde aquí a propósito. Un respaldo que depende de que alguien abra una pantalla
          y pulse un botón no es un respaldo. Se configuran en Google Cloud como exportación programada de Firestore
          a Cloud Storage, con retención y una prueba de restauración periódica — el procedimiento está en el README,
          en la sección de checklist de producción.
        </p>
        <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-ink-500">
          Lo que sí conviene recordar: un respaldo que nunca se ha restaurado es una suposición, no un respaldo.
        </p>
      </Card>
    </div>
  )
}
