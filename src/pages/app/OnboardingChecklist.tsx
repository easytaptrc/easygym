import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, PartyPopper, X } from 'lucide-react'
import { useSession } from '@/state/SessionContext'
import { platform } from '@/services/db'
import { ONBOARDING_STEPS } from '@/services/defaults'
import { cx } from '@/lib/utils'
import { Progress } from '@/components/ui/Feedback'

/**
 * Lista de puesta en marcha para un gimnasio recién creado.
 *
 * Se descarta sola cuando todos los pasos están hechos, y el dueño puede
 * cerrarla antes. Un checklist que no se puede quitar se vuelve ruido.
 */
export function OnboardingChecklist() {
  const { gym } = useSession()
  const [hidden, setHidden] = useState(false)

  const done = useMemo(
    () => (gym ? ONBOARDING_STEPS.filter((s) => gym.onboarding.steps[s.id]).length : 0),
    [gym],
  )

  if (!gym || gym.onboarding.dismissed || hidden) return null

  const total = ONBOARDING_STEPS.length
  const pct = Math.round((done / total) * 100)
  const complete = done === total

  async function dismiss() {
    setHidden(true)
    if (gym) {
      await platform.update('gyms', gym.id, {
        onboarding: { ...gym.onboarding, dismissed: true },
      })
    }
  }

  return (
    <section className="relative mb-5 overflow-hidden rounded-2xl border border-gym/20 bg-gradient-to-br from-gym/[.08] via-ink-900/70 to-ink-900/70 p-5 backdrop-blur-xl">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 h-48 opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(ellipse,rgb(var(--gym-accent)),transparent 70%)' }}
      />

      <button
        onClick={dismiss}
        className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-500 transition hover:bg-white/5 hover:text-ink-200"
        aria-label="Ocultar guía de inicio"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="relative flex flex-wrap items-center gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gym/15 text-gym ring-1 ring-inset ring-gym/30">
          <PartyPopper className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold text-ink-50">
            {complete ? '¡Tu gimnasio está listo!' : `¡Bienvenido a bordo, ${gym.name}!`}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-400">
            {complete
              ? 'Terminaste la configuración inicial. Puedes ocultar esta guía.'
              : 'Siete pasos para dejarlo todo funcionando.'}
          </p>
        </div>
        <div className="w-full sm:w-40">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[11.5px] text-ink-500">Progreso</span>
            <span className="text-[13px] font-bold text-gym tnum">{pct}%</span>
          </div>
          <Progress value={done} max={total} />
        </div>
      </div>

      <ol className="relative mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {ONBOARDING_STEPS.map((s, i) => {
          const isDone = gym.onboarding.steps[s.id]
          return (
            <li key={s.id}>
              <Link
                to={s.to}
                className={cx(
                  'group flex h-full items-start gap-3 rounded-xl border p-3 transition-all duration-200',
                  isDone
                    ? 'border-gym/20 bg-gym/[.05]'
                    : 'border-white/[.07] bg-white/[.02] hover:-translate-y-0.5 hover:border-white/[.16]',
                )}
              >
                <span
                  className={cx(
                    'grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-bold',
                    isDone ? 'bg-gym text-ink-950' : 'bg-white/[.06] text-ink-400',
                  )}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cx(
                      'block text-[13px] font-medium',
                      isDone ? 'text-ink-400 line-through' : 'text-ink-100',
                    )}
                  >
                    {s.title}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-500">{s.detail}</span>
                </span>
                {!isDone && (
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-600 transition-transform group-hover:translate-x-0.5 group-hover:text-gym" />
                )}
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** Marca un paso del onboarding como completado. Lo llaman las pantallas. */
export async function completeOnboardingStep(
  gym: { id: string; onboarding: { dismissed: boolean; steps: Record<string, boolean> } } | null,
  step: string,
): Promise<void> {
  if (!gym || gym.onboarding.steps[step]) return
  await platform.update('gyms', gym.id, {
    onboarding: { ...gym.onboarding, steps: { ...gym.onboarding.steps, [step]: true } },
  })
}
