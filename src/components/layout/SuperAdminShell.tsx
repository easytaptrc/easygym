import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Building2,
  CreditCard,
  FileClock,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  SlidersHorizontal,
  Users,
  Wrench,
} from 'lucide-react'
import { useSession } from '@/state/SessionContext'
import { cx } from '@/lib/utils'
import { Backdrop } from '@/components/ui/Backdrop'
import { Avatar, Badge, FullPageLoader } from '@/components/ui/Feedback'
import { Logo } from '@/components/ui/Logo'

// Consola de plataforma. Visualmente se distingue del panel de un gimnasio
// (acento violeta, no el color del tenant) para que nadie confunda "estoy
// administrando EasyGym" con "estoy administrando un gimnasio".

const NAV = [
  { to: '/superadmin', label: 'Resumen', icon: LayoutDashboard, end: true },
  { to: '/superadmin/gimnasios', label: 'Gimnasios', icon: Building2 },
  { to: '/superadmin/planes', label: 'Planes', icon: Package },
  { to: '/superadmin/funcionalidades', label: 'Funcionalidades', icon: SlidersHorizontal },
  { to: '/superadmin/suscripciones', label: 'Suscripciones', icon: CreditCard },
  { to: '/superadmin/usuarios', label: 'Usuarios', icon: Users },
  { to: '/superadmin/auditoria', label: 'Auditoría', icon: FileClock },
  { to: '/superadmin/configuracion', label: 'Configuración', icon: Settings },
  { to: '/superadmin/mantenimiento', label: 'Mantenimiento', icon: Wrench },
]

export function SuperAdminShell() {
  const { ready, user, signOut } = useSession()
  const navigate = useNavigate()

  if (!ready) return <FullPageLoader />
  if (!user) return <FullPageLoader />

  return (
    <div className="relative min-h-screen">
      <Backdrop variant="app" />

      <header className="sticky top-0 z-30 border-b border-white/[.06] bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
          <Logo size="xs" still />
          <Badge tone="plasma">Plataforma</Badge>

          <nav className="no-scrollbar ml-2 flex flex-1 gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                    isActive
                      ? 'bg-plasma-400/[.14] text-plasma-300'
                      : 'text-ink-400 hover:bg-white/[.04] hover:text-ink-100',
                  )
                }
              >
                <n.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{n.label}</span>
              </NavLink>
            ))}
          </nav>

          <Avatar name={user.name} size={30} />
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
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
