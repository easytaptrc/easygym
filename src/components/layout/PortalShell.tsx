import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { PORTAL_NAV } from '@/config/navigation'
import { useSession } from '@/state/SessionContext'
import { cx } from '@/lib/utils'
import { Backdrop } from '@/components/ui/Backdrop'
import { Avatar, FullPageLoader } from '@/components/ui/Feedback'

// ═══════════════════════════════════════════════════════════════════════════
// Portal del socio.
//
// Diseñado para el celular primero: barra de navegación abajo, al alcance del
// pulgar, respetando el área segura de iOS. En escritorio la misma barra se
// mueve arriba. Se instala como PWA desde el navegador — una sola app EasyGym
// para todos los gimnasios, nunca una por gimnasio.
// ═══════════════════════════════════════════════════════════════════════════

export function PortalShell() {
  const { ready, user, gym, member, signOut } = useSession()
  const navigate = useNavigate()

  if (!ready) return <FullPageLoader />
  if (!user || !gym) return <FullPageLoader label="Cargando tu membresía…" />

  return (
    <div className="relative flex min-h-screen flex-col">
      <Backdrop variant="app" />

      {/* Encabezado */}
      <header className="pt-safe sticky top-0 z-30 border-b border-white/[.06] bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gym/15 text-[11px] font-bold text-gym">
            {gym.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold text-ink-50">
              {gym.branding.displayName ?? gym.name}
            </p>
            <p className="truncate text-[11px] text-ink-500">{member?.name ?? user.name}</p>
          </div>
          <Avatar name={member?.name ?? user.name} src={member?.photoUrl} size={32} />
          <button
            onClick={async () => {
              await signOut()
              navigate('/login')
            }}
            className="rounded-lg p-2 text-ink-400 transition hover:bg-white/5 hover:text-danger-400"
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        {/* Navegación en escritorio */}
        <nav className="mx-auto hidden max-w-2xl gap-1 px-4 pb-2 sm:flex">
          {PORTAL_NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                  isActive ? 'bg-gym/[.12] text-gym' : 'text-ink-400 hover:bg-white/[.04] hover:text-ink-100',
                )
              }
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-5 pb-24 sm:pb-8">
        <Outlet />
      </main>

      {/* Navegación móvil */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-white/[.07] bg-ink-950/90 backdrop-blur-xl sm:hidden">
        <ul className="mx-auto flex max-w-2xl">
          {PORTAL_NAV.map((n) => (
            <li key={n.to} className="flex-1">
              <NavLink
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    'flex flex-col items-center gap-1 py-2.5 transition-colors',
                    isActive ? 'text-gym' : 'text-ink-500',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      {isActive && (
                        <span className="absolute -inset-2 -z-10 rounded-full bg-gym/[.14]" aria-hidden="true" />
                      )}
                      <n.icon className="h-[19px] w-[19px]" />
                    </span>
                    <span className="text-[10px] font-medium">{n.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
