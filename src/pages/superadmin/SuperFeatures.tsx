import { useMemo, useState } from 'react'
import { Lock, Search, ShieldCheck, SlidersHorizontal, X } from 'lucide-react'
import type { FeatureKey, Plan, PlanId } from '@/types'
import { FEATURES, FEATURE_CATEGORIES, isCoreFeature, type FeatureCategory } from '@/config/features'
import { usePlans } from '@/state/PlansContext'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { setPlanFeature } from '@/services/planCatalog'
import { reportError } from '@/lib/errors'
import { cx, norm } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Segmented } from '@/components/ui/Inputs'

// ═══════════════════════════════════════════════════════════════════════════
// Funcionalidades por plan.
//
// Esta pantalla es la respuesta a «quiero decidir qué incluye cada paquete sin
// que nadie recompile nada». Cada interruptor escribe en `plans/{planId}` y el
// cambio baja a los `entitlements` de cada gimnasio de ese plan.
//
// QUÉ PASA DE VERDAD AL APAGAR UN INTERRUPTOR — tres capas, no una:
//
//   1. La interfaz esconde la opción            (comodidad)
//   2. La ruta deja de abrirse                  (comodidad)
//   3. Firestore RECHAZA la escritura           ← esto es lo que protege
//
// Las dos primeras son cortesía con el usuario. La tercera es la que hace que
// escribir la URL a mano, o llamar a la base desde la consola del navegador,
// tampoco funcione. Por eso cada funcionalidad declara qué colecciones protege
// y aquí se muestra: si una fila no dice nada, su bloqueo es solo visual.
// ═══════════════════════════════════════════════════════════════════════════

type Filter = 'all' | 'differences' | 'guarded'

export default function SuperFeatures() {
  const { plans, ready } = usePlans()
  const { user } = useSession()
  const toast = useToast()

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [pending, setPending] = useState<string | null>(null)

  /** Solo los planes que se comercializan: Enterprise se negocia a mano. */
  const columns = useMemo<Plan[]>(() => plans.filter((p) => p.active !== false), [plans])

  const rows = useMemo(() => {
    const q = norm(query.trim())
    return FEATURES.filter((f) => {
      if (q && !norm(f.name).includes(q) && !norm(f.description).includes(q) && !norm(f.key).includes(q)) {
        return false
      }
      if (filter === 'guarded') return Boolean(f.guardsCollections?.length)
      if (filter === 'differences') {
        const values = columns.map((p) => p.features[f.key] === true)
        return new Set(values).size > 1
      }
      return true
    })
  }, [query, filter, columns])

  const byCategory = useMemo(() => {
    const out: Array<{ category: FeatureCategory; items: typeof FEATURES }> = []
    for (const category of FEATURE_CATEGORIES) {
      const items = rows.filter((f) => f.category === category)
      if (items.length > 0) out.push({ category, items })
    }
    return out
  }, [rows])

  async function toggle(planId: PlanId, feature: FeatureKey, next: boolean) {
    if (!user) return
    const cellId = `${planId}:${feature}`
    setPending(cellId)
    try {
      await setPlanFeature(planId, feature, next, user)
    } catch (err) {
      const friendly = reportError('setPlanFeature', err, { planId, feature })
      toast.error(next ? 'No se pudo activar' : 'No se pudo desactivar', friendly.message)
    } finally {
      setPending(null)
    }
  }

  if (!ready) return <LoadingBlock label="Cargando funcionalidades…" />

  return (
    <div>
      <PageHeader
        eyebrow="Plataforma"
        title="Funcionalidades"
        description="Qué incluye cada plan. Al cambiar un interruptor, todos los gimnasios de ese plan lo notan en el acto: sin desplegar, sin recompilar y sin reiniciar nada."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar funcionalidad…"
            className="h-10 w-full rounded-xl border border-white/10 bg-ink-950/60 pl-9 pr-9 text-sm text-ink-100 transition placeholder:text-ink-500 focus:border-plasma-400/60 focus:bg-ink-950 focus:outline-none focus:ring-4 focus:ring-plasma-400/15"
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

        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'differences', label: 'Diferencias', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
            { value: 'guarded', label: 'Con bloqueo real', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
          ]}
        />
      </div>

      {byCategory.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="Ninguna funcionalidad coincide"
            detail="Prueba con otro término o quita el filtro."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse">
              <thead>
                <tr className="border-b border-white/[.08]">
                  <th className="sticky left-0 z-10 bg-ink-900/95 px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[.14em] text-ink-500 backdrop-blur">
                    Funcionalidad
                  </th>
                  {columns.map((p) => (
                    <th key={p.id} className="px-3 py-3 text-center">
                      <span className="block text-[13px] font-bold text-ink-100">{p.name}</span>
                      <span className="mt-0.5 block text-[10.5px] font-normal text-ink-500 tnum">
                        {Object.values(p.features).filter(Boolean).length} activas
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              {byCategory.map(({ category, items }) => (
                <tbody key={category}>
                  <tr>
                    <td
                      colSpan={columns.length + 1}
                      className="sticky left-0 border-y border-white/[.05] bg-ink-950/50 px-5 py-2 text-[11px] font-semibold uppercase tracking-[.16em] text-ink-400"
                    >
                      {category}
                    </td>
                  </tr>

                  {items.map((f) => {
                    const core = isCoreFeature(f.key)
                    return (
                      <tr key={f.key} className="border-b border-white/[.04] last:border-0 hover:bg-white/[.02]">
                        <td className="sticky left-0 z-10 max-w-[340px] bg-ink-900/95 px-5 py-3 backdrop-blur">
                          <div className="flex items-center gap-2">
                            <span className="text-[13.5px] font-medium text-ink-100">{f.name}</span>
                            {core && (
                              <span
                                title="Esencial: no se puede apagar en ningún plan"
                                className="inline-flex items-center gap-1 rounded-full bg-white/[.06] px-2 py-0.5 text-[10px] font-semibold text-ink-400"
                              >
                                <Lock className="h-2.5 w-2.5" />
                                Esencial
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[12px] leading-snug text-ink-500">{f.description}</p>
                          {f.guardsCollections?.length ? (
                            <p className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] text-tap-400/80">
                              <ShieldCheck className="h-3 w-3 shrink-0" />
                              {f.guardsCollections.join(' · ')}
                            </p>
                          ) : null}
                        </td>

                        {columns.map((p) => {
                          const on = p.features[f.key] === true
                          const cellId = `${p.id}:${f.key}`
                          return (
                            <td key={p.id} className="px-3 py-3 text-center">
                              <SwitchCell
                                on={on}
                                locked={core}
                                busy={pending === cellId}
                                label={`${f.name} en ${p.name}`}
                                onToggle={() => toggle(p.id, f.key, !on)}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </Card>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[.07] bg-white/[.02] px-4 py-3.5">
          <p className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-ink-200">
            <ShieldCheck className="h-4 w-4 text-tap-400" />
            Qué significa «con bloqueo real»
          </p>
          <p className="text-[12.5px] leading-relaxed text-ink-400">
            Esas funcionalidades protegen colecciones concretas de la base de datos. Apagarlas no solo esconde el
            botón: el servidor rechaza la escritura aunque alguien escriba la URL a mano o llame a la base desde la
            consola del navegador.
          </p>
        </div>
        <div className="rounded-xl border border-white/[.07] bg-white/[.02] px-4 py-3.5">
          <p className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-ink-200">
            <Lock className="h-4 w-4 text-ink-400" />
            Por qué hay funciones que no se pueden apagar
          </p>
          <p className="text-[12.5px] leading-relaxed text-ink-400">
            Sin socios, membresías, asistencia, cobros o portal, un gimnasio no puede operar. Dejar apagar eso en un
            plan de pago sería vender una aplicación vacía, así que el interruptor no existe.
          </p>
        </div>
      </div>

      <p className="mt-4 text-[12.5px] leading-relaxed text-ink-500">
        Cada cambio queda en <span className="text-ink-300">Auditoría</span> con quién lo hizo, cuándo y qué valor
        tenía antes.
      </p>
    </div>
  )
}

/** Interruptor compacto de la matriz. Bloqueado = funcionalidad esencial. */
function SwitchCell({
  on,
  locked,
  busy,
  label,
  onToggle,
}: {
  on: boolean
  locked: boolean
  busy: boolean
  label: string
  onToggle: () => void
}) {
  if (locked) {
    return (
      <span
        title="Esencial: siempre incluida"
        className="inline-grid h-6 w-11 place-items-center rounded-full bg-gym/25 text-ink-950"
      >
        <Lock className="h-3 w-3" />
        <span className="sr-only">{label}: siempre incluida</span>
      </span>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onToggle}
      className={cx(
        'relative h-6 w-11 rounded-full transition-colors duration-300 disabled:opacity-50',
        on ? 'bg-plasma-400' : 'bg-ink-700 hover:bg-ink-600',
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-300 ease-spring',
          on ? 'left-[22px]' : 'left-0.5',
          busy && 'animate-pulse',
        )}
      />
    </button>
  )
}
