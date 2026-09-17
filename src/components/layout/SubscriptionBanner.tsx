import { Link } from 'react-router-dom'
import { AlertTriangle, CreditCard, Info } from 'lucide-react'
import type { Gym } from '@/types'
import { policyFor } from '@/services/gymStatus'

/**
 * Aviso de estado de la suscripción del DUEÑO con EasyGym.
 *
 * El texto NO se decide aquí: sale de `services/gymStatus.ts`, que es donde
 * vive la política de estados. Antes esta franja tenía su propia copia de las
 * reglas, y una copia siempre acaba contradiciendo a la original — el banner
 * diciendo una cosa y el sistema haciendo otra.
 *
 * Política deliberada: un gimnasio con pago rechazado sigue operando
 * (PAST_DUE), porque dejar a un negocio sin poder cobrar por un cargo fallido
 * es peor que esperar unos días. Solo CANCELED/SUSPENDED restringen, y ni así
 * se borra nada.
 */

const TONE = {
  info: { icon: Info, className: 'border-cyber-400/25 bg-cyber-400/10 text-cyber-200' },
  warn: { icon: CreditCard, className: 'border-warn-500/25 bg-warn-500/10 text-warn-200' },
  danger: { icon: AlertTriangle, className: 'border-danger-500/25 bg-danger-500/10 text-danger-200' },
} as const

export function SubscriptionBanner({ gym }: { gym: Gym }) {
  const { banner } = policyFor(gym)
  if (!banner) return null

  const { icon: Icon, className } = TONE[banner.tone]

  return (
    <div className={`flex flex-wrap items-center gap-3 border-t px-4 py-2.5 sm:px-6 ${className}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 text-[12.5px]">
        <span className="font-semibold">{banner.title}.</span>{' '}
        <span className="opacity-80">{banner.detail}</span>
      </p>
      <Link
        to={banner.to}
        className="shrink-0 whitespace-nowrap rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-semibold transition hover:bg-white/20"
      >
        {banner.cta}
      </Link>
    </div>
  )
}
