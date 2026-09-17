import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { BRAND, PARENT_BRAND } from '@/config/brand'
import { cx } from '@/lib/utils'
import { Logo } from '@/components/ui/Logo'
import { LinkButton } from '@/components/ui/Button'

const LINKS = [
  { to: '/', label: 'Inicio' },
  { to: '/planes', label: 'Planes' },
  { to: '/#funciones', label: 'Funciones' },
]

export function PublicNav() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className={cx(
        'sticky top-0 z-50 transition-all duration-300',
        scrolled && 'border-b border-white/[.07] bg-ink-950/80 backdrop-blur-xl',
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="shrink-0" aria-label={BRAND.name}>
          <Logo size="sm" />
        </Link>

        <ul className="ml-4 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                className={({ isActive }) =>
                  cx(
                    'rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
                    isActive && l.to !== '/#funciones'
                      ? 'text-white'
                      : 'text-ink-400 hover:text-ink-100',
                  )
                }
              >
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <LinkButton to="/login" variant="subtle" size="sm" className="hidden sm:inline-flex">
            Iniciar sesión
          </LinkButton>
          <LinkButton to="/registro" variant="primary" size="sm">
            Comenzar
          </LinkButton>
          <button
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg p-2 text-ink-300 transition hover:bg-white/5 md:hidden"
            aria-label="Menú"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="animate-fade-in border-t border-white/[.07] bg-ink-950/95 px-4 py-3 backdrop-blur-xl md:hidden">
          <ul className="space-y-1">
            {[...LINKS, { to: '/login', label: 'Iniciar sesión' }].map((l) => (
              <li key={l.to}>
                <Link
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-[14px] text-ink-200 transition hover:bg-white/5"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  )
}

export function PublicFooter() {
  return (
    <footer className="border-t border-white/[.06] px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <Logo size="sm" still />
            <p className="mt-2 max-w-xs text-[12.5px] leading-relaxed text-ink-500">
              {BRAND.subtitle}. {BRAND.claim}.
            </p>
            {/* La marca matriz solo aparece aquí: EasyGym es el producto. */}
            <p className="mt-1.5 text-[11.5px] text-ink-600">
              {BRAND.name} es {PARENT_BRAND.byline}
            </p>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-400">
            <li>
              <Link to="/planes" className="transition hover:text-ink-100">
                Planes
              </Link>
            </li>
            <li>
              <Link to="/registro" className="transition hover:text-ink-100">
                Crear gimnasio
              </Link>
            </li>
            <li>
              <Link to="/login" className="transition hover:text-ink-100">
                Iniciar sesión
              </Link>
            </li>
            <li>
              <a href={`mailto:${BRAND.supportEmail}`} className="transition hover:text-ink-100">
                Contacto
              </a>
            </li>
          </ul>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[.05] pt-6">
          <p className="text-[12px] text-ink-600">
            © {new Date().getFullYear()} {PARENT_BRAND.legalName}. Todos los derechos reservados.
          </p>
          <p className="font-mono text-[11px] text-ink-700">Hecho en México 🇲🇽</p>
        </div>
      </div>
    </footer>
  )
}
