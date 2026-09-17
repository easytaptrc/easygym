import { cx } from '@/lib/utils'
import { BRAND } from '@/config/brand'

// Logotipo EASYGYM: "Easy" en blanco, "TAP" en verde, chip NFC y ondas.
// Las ondas se animan en secuencia — es el gesto de "tap" del control de acceso.

interface Props {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  /** Detiene la animación de las ondas (útil en listados). */
  still?: boolean
  /** Usa el color del gimnasio en vez del verde de marca. */
  useGymAccent?: boolean
}

const SIZES = {
  xs: { text: 'text-base', gap: 'gap-1', chip: 13, wave: 11 },
  sm: { text: 'text-xl', gap: 'gap-1.5', chip: 16, wave: 14 },
  md: { text: 'text-2xl', gap: 'gap-2', chip: 20, wave: 17 },
  lg: { text: 'text-4xl', gap: 'gap-2.5', chip: 28, wave: 24 },
  xl: { text: 'text-6xl', gap: 'gap-3', chip: 40, wave: 34 },
} as const

export function NfcMark({
  size = 20,
  still = false,
  className,
}: {
  size?: number
  still?: boolean
  className?: string
}) {
  const w = size * 1.85
  return (
    <svg
      viewBox="0 0 37 20"
      width={w}
      height={size}
      className={cx('shrink-0', className)}
      aria-hidden="true"
      fill="none"
    >
      {/* Chip */}
      <rect x="0.9" y="1.6" width="14.2" height="16.8" rx="2.6" fill="currentColor" opacity="0.75" />
      <rect x="3.6" y="4.3" width="3.3" height="3.1" rx="0.8" fill="#05070A" />
      <rect x="3.6" y="9" width="3.3" height="5.1" rx="0.8" fill="#05070A" />
      <rect x="8.6" y="4.3" width="3.3" height="9.8" rx="0.8" fill="#05070A" />
      {/* Ondas */}
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={
            [
              'M20.4 6.6a5.6 5.6 0 0 1 0 6.8',
              'M25.4 4.1a10.4 10.4 0 0 1 0 11.8',
              'M30.4 1.6a15.2 15.2 0 0 1 0 16.8',
            ][i]
          }
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity={still ? 0.75 : undefined}
          style={
            still
              ? undefined
              : { animation: `nfcpulse 1.8s ease-in-out ${i * 0.22}s infinite` }
          }
        />
      ))}
      <style>{`@keyframes nfcpulse{0%,100%{opacity:.28}45%{opacity:1}}`}</style>
    </svg>
  )
}

export function Logo({ size = 'md', className, still = false, useGymAccent = false }: Props) {
  const s = SIZES[size]
  return (
    <span className={cx('inline-flex select-none items-baseline', s.gap, s.text, className)}>
      <span className="font-sans font-extrabold leading-none tracking-[-0.045em] text-white">
        {BRAND.namePrefix}
      </span>
      <span
        className={cx(
          'font-sans font-extrabold leading-none tracking-[-0.03em]',
          useGymAccent ? 'text-gym' : 'text-tap-400',
        )}
      >
        {BRAND.nameSuffix}
      </span>
      <NfcMark
        size={s.chip}
        still={still}
        className={cx('self-center', useGymAccent ? 'text-gym/80' : 'text-ink-300')}
      />
    </span>
  )
}

/** Marca compacta para el sidebar colapsado y los favicons in-app. */
export function LogoMark({ className, size = 34 }: { className?: string; size?: number }) {
  return (
    <span
      className={cx(
        'inline-grid place-items-center rounded-xl bg-tap-400 font-sans font-extrabold text-ink-950',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      E
    </span>
  )
}
