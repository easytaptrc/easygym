import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Sparkles } from 'lucide-react'
import type { FeatureKey } from '@/types'
import { useSession } from '@/state/SessionContext'
import { usePlans } from '@/state/PlansContext'
import { cx } from '@/lib/utils'
import { money0 } from '@/lib/format'
import { Card } from './ui/Card'
import { LinkButton } from './ui/Button'
import { Badge } from './ui/Feedback'

// ═══════════════════════════════════════════════════════════════════════════
// Puerta de funcionalidad por plan.
//
// Envuelve cualquier pantalla o bloque que no esté incluido en el plan del
// gimnasio. La regla la decide `hasFeature`, nunca una comparación de planId
// suelta por ahí.
//
// ESCONDER NO ES PROTEGER. Este componente quita el botón; quien escriba la
// URL a mano seguirá llegando a la pantalla, y por eso las rutas van además
// envueltas en `RequireFeature` y las escrituras las rechaza `firestore.rules`
// leyendo `gyms/{gymId}.entitlements.features`. Son tres capas y la única que
// cuenta de verdad es la última.
// ═══════════════════════════════════════════════════════════════════════════

const ACCENT = {
  tap: { ring: 'ring-tap-500/30', text: 'text-tap-300', glow: 'shadow-glow-tap', badge: 'tap' },
  cyber: { ring: 'ring-cyber-400/30', text: 'text-cyber-300', glow: 'shadow-glow-cyber', badge: 'cyber' },
  plasma: { ring: 'ring-plasma-400/30', text: 'text-plasma-300', glow: 'shadow-glow-plasma', badge: 'plasma' },
  ink: { ring: 'ring-white/15', text: 'text-ink-200', glow: '', badge: 'neutral' },
} as const

export function PlanGuard({
  feature,
  children,
  /** Qué mostrar en lugar del bloqueo por defecto. */
  fallback,
  /** Versión compacta, para bloquear una tarjeta dentro de una página. */
  compact,
  title,
}: {
  feature: FeatureKey
  children: ReactNode
  fallback?: ReactNode
  compact?: boolean
  title?: string
}) {
  const { hasFeature } = useSession()
  if (hasFeature(feature)) return <>{children}</>
  if (fallback) return <>{fallback}</>
  return <UpgradeNotice feature={feature} compact={compact} {...(title ? { title } : {})} />
}

export function UpgradeNotice({
  feature,
  compact,
  title,
}: {
  feature: FeatureKey
  compact?: boolean
  title?: string
}) {
  const { minimumPlanFor } = usePlans()
  const plan = minimumPlanFor(feature)
  const a = ACCENT[plan.accent as keyof typeof ACCENT] ?? ACCENT.ink

  if (compact) {
    return (
      <div
        className={cx(
          'flex items-center gap-3 rounded-xl border border-white/[.07] bg-ink-900/60 px-4 py-3 ring-1 ring-inset',
          a.ring,
        )}
      >
        <Lock className={cx('h-4 w-4 shrink-0', a.text)} />
        <p className="min-w-0 flex-1 text-[13px] text-ink-300">
          Esta función está disponible en <span className={cx('font-semibold', a.text)}>{plan.name}</span>
        </p>
        <Link
          to="/planes"
          className="shrink-0 whitespace-nowrap text-[12.5px] font-semibold text-gym hover:underline"
        >
          Actualizar plan
        </Link>
      </div>
    )
  }

  return (
    <Card className="relative mx-auto max-w-lg overflow-hidden p-8 text-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 h-48 opacity-30 blur-3xl"
        style={{
          background:
            plan.accent === 'cyber'
              ? 'radial-gradient(ellipse,#38D9FF,transparent 70%)'
              : plan.accent === 'plasma'
                ? 'radial-gradient(ellipse,#A970FF,transparent 70%)'
                : 'radial-gradient(ellipse,#22E06B,transparent 70%)',
        }}
      />

      <div
        className={cx(
          'mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[.04] ring-1 ring-inset',
          a.ring,
        )}
      >
        <Lock className={cx('h-6 w-6', a.text)} />
      </div>

      <h2 className="mt-5 text-xl font-semibold text-ink-50">
        {title ?? 'Esta función está disponible en'}{' '}
        <span className={a.text}>{plan.name}</span>
      </h2>

      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-400">
        Tu plan actual no incluye esta herramienta. Cambia a {plan.name} y actívala al instante — sin
        perder nada de lo que ya tienes cargado.
      </p>

      <div className="mt-5 flex items-center justify-center gap-2">
        <Badge tone={a.badge as never}>
          <Sparkles className="h-3 w-3" />
          {plan.name}
        </Badge>
        {plan.price !== null && (
          <span className="text-sm text-ink-400">
            <span className="font-semibold text-ink-100 tnum">{money0(plan.price)}</span> / mes
          </span>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <LinkButton to="/planes" variant="primary" size="lg" icon={<Sparkles className="h-4 w-4" />}>
          Actualizar plan
        </LinkButton>
        <LinkButton to="/dashboard" variant="subtle" size="lg">
          Volver al panel
        </LinkButton>
      </div>
    </Card>
  )
}

/** Muestra el hijo solo si el plan lo incluye. Sin aviso, sin hueco. */
export function IfFeature({ feature, children }: { feature: FeatureKey; children: ReactNode }) {
  const { hasFeature } = useSession()
  return hasFeature(feature) ? <>{children}</> : null
}
