import { Link } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import type { Plan } from '@/types'
import { money0 } from '@/lib/format'
import { cx } from '@/lib/utils'

// Tarjeta de plan. El acento de cada plan (verde / cian / violeta) es el mismo
// en toda la plataforma: en la landing, en el sidebar y en los avisos de
// "esta función está disponible en Pro".

const ACCENT = {
  tap: {
    ring: 'ring-tap-500/35',
    glow: 'shadow-glow-tap',
    text: 'text-tap-400',
    btn: 'border-tap-500/50 text-tap-300 hover:bg-tap-500/10',
    btnSolid: 'bg-tap-400 text-ink-950 hover:bg-tap-300',
    halo: '#22E06B',
    check: 'text-tap-400',
  },
  cyber: {
    ring: 'ring-cyber-400/45',
    glow: 'shadow-glow-cyber',
    text: 'text-cyber-400',
    btn: 'border-cyber-400/50 text-cyber-300 hover:bg-cyber-400/10',
    btnSolid: 'bg-cyber-400 text-ink-950 hover:bg-cyber-300',
    halo: '#38D9FF',
    check: 'text-cyber-400',
  },
  plasma: {
    ring: 'ring-plasma-400/35',
    glow: 'shadow-glow-plasma',
    text: 'text-plasma-400',
    btn: 'border-plasma-400/50 text-plasma-300 hover:bg-plasma-400/10',
    btnSolid: 'bg-plasma-400 text-ink-950 hover:bg-plasma-300',
    halo: '#A970FF',
    check: 'text-plasma-400',
  },
  ink: {
    ring: 'ring-white/15',
    glow: '',
    text: 'text-ink-200',
    btn: 'border-white/20 text-ink-200 hover:bg-white/5',
    btnSolid: 'bg-white text-ink-950 hover:bg-ink-100',
    halo: '#6C7E97',
    check: 'text-ink-300',
  },
} as const

export function PlanCard({ plan, compact }: { plan: Plan; compact?: boolean }) {
  const a = ACCENT[plan.accent]

  return (
    <article
      className={cx(
        'relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[.08] bg-ink-900/70 backdrop-blur-xl',
        'ring-1 ring-inset transition-all duration-300 ease-spring hover:-translate-y-1',
        a.ring,
        plan.popular && cx('lg:-mt-4 lg:mb-4', a.glow),
      )}
    >
      {/* Halo de color */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-24 h-48 opacity-[.22] blur-3xl"
        style={{ background: `radial-gradient(ellipse,${a.halo},transparent 70%)` }}
      />

      {plan.popular && (
        <div className="relative z-10 flex justify-center pt-4">
          <span className="rounded-full bg-cyber-400 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-ink-950">
            Más popular
          </span>
        </div>
      )}

      <div className={cx('relative z-10 px-6', plan.popular ? 'pt-4' : 'pt-7')}>
        <h3 className={cx('text-[24px] font-bold tracking-tight', a.text)}>{plan.name}</h3>
        <p className="mt-1 min-h-[34px] text-[12.5px] leading-snug text-ink-400">{plan.tagline}</p>

        <div className="mt-4 flex items-baseline gap-1.5">
          {plan.price === null ? (
            <span className="text-[30px] font-bold text-white">A cotizar</span>
          ) : (
            <>
              <span className="text-[38px] font-bold leading-none tracking-tight text-white tnum">
                {money0(plan.price)}
              </span>
              <span className="text-[13px] font-medium text-ink-400">MXN / mes</span>
            </>
          )}
        </div>
      </div>

      <div className="relative z-10 mt-5 flex-1 px-6">
        <ul className="space-y-2.5">
          {(compact ? plan.highlights.slice(0, 6) : plan.highlights).map((h, i) => (
            <li key={h} className="flex items-start gap-2.5">
              <Check className={cx('mt-0.5 h-4 w-4 shrink-0', a.check)} />
              <span className={cx('text-[13.5px] leading-snug', i === 0 ? 'font-semibold text-ink-100' : 'text-ink-300')}>
                {h}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12.5px] text-ink-500">{plan.support}</p>
      </div>

      <div className="relative z-10 p-6 pt-5">
        <Link
          to={plan.price === null ? '/planes' : `/registro?plan=${plan.id}`}
          className={cx(
            'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-[14px] font-bold transition-all duration-200 ease-spring active:scale-[.98]',
            plan.popular ? cx('border-transparent', a.btnSolid) : a.btn,
          )}
        >
          {plan.price === null ? 'Hablar con ventas' : 'Comenzar ahora'}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  )
}
