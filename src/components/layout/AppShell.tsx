import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  Eye,
  LogOut,
  Lock,
  Menu,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import { cx } from '@/lib/utils'
import { getPlan } from '@/config/plans'
import { NAV, NAV_GROUPS } from '@/config/navigation'
import { ROLE_LABELS } from '@/services/auth'
import { useSession } from '@/state/SessionContext'
import { Logo, LogoMark } from '@/components/ui/Logo'
import { Backdrop } from '@/components/ui/Backdrop'
import { Avatar, Badge, FullPageLoader } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { SubscriptionBanner } from './SubscriptionBanner'

// ═══════════════════════════════════════════════════════════════════════════
// Estructura del área privada: sidebar + barra superior + contenido.
//
// El sidebar se colapsa en escritorio y se convierte en cajón en móvil. El
// menú se construye a partir de los permisos del rol y del plan del gimnasio:
// lo que el rol no puede hacer no aparece, y lo que el plan no incluye aparece
// con candado (que es información útil, no un muro).
// ═══════════════════════════════════════════════════════════════════════════

const COLLAPSE_KEY = 'easygym:sidebar-collapsed'

export function AppShell() {
  const { ready, user, gym, signOut, can, hasFeature, impersonatedGymId, impersonateGym } = useSession()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => setMobileOpen(false), [location.pathname])
  useEffect(() => localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'), [collapsed])

  if (!ready) return <FullPageLoader />
  if (!user || !gym) return <FullPageLoader label="Cargando tu gimnasio…" />

  const plan = getPlan(gym.planId)
  const items = NAV.filter((n) => can(n.permission))

  const sidebar = (
    <div className="flex h-full flex-col">
      {/* Marca */}
      <div className={cx('flex items-center gap-2 px-4 py-4', collapsed && 'justify-center px-2')}>
        {collapsed ? (
          <LogoMark size={32} />
        ) : (
          <NavLink to="/dashboard" className="min-w-0">
            <Logo size="sm" still />
          </NavLink>
        )}
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto rounded-lg p-1.5 text-ink-400 hover:bg-white/5 lg:hidden"
          aria-label="Cerrar menú"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Gimnasio activo */}
      <div className={cx('mx-3 mb-3', collapsed && 'mx-2')}>
        <div
          className={cx(
            'rounded-xl border border-white/[.07] bg-gradient-to-br from-gym/[.09] to-transparent p-3',
            collapsed && 'flex justify-center p-2',
          )}
        >
          {collapsed ? (
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gym/20 text-[11px] font-bold text-gym">
              {gym.name.slice(0, 2).toUpperCase()}
            </span>
          ) : (
            <>
              <p className="truncate text-[13px] font-semibold text-ink-50">{gym.name}</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Badge tone={plan.accent === 'ink' ? 'neutral' : (plan.accent as never)}>{plan.name}</Badge>
                <span className="truncate font-mono text-[10px] text-ink-500">/{gym.slug}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Navegación */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((i) => i.group === group)
          if (groupItems.length === 0) return null
          return (
            <div key={group} className="mb-4">
              {!collapsed && (
                <p className="mb-1.5 px-3 font-mono text-[10px] uppercase tracking-[.2em] text-ink-600">
                  {group}
                </p>
              )}
              <ul className="space-y-0.5">
                {groupItems.map((item) => {
                  const locked = item.feature ? !hasFeature(item.feature) : false
                  const Icon = item.icon
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={locked ? '/planes' : item.to}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cx(
                            'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-all duration-200',
                            collapsed && 'justify-center px-2',
                            isActive && !locked
                              ? 'bg-gym/[.12] text-gym'
                              : locked
                                ? 'text-ink-600 hover:bg-white/[.03] hover:text-ink-400'
                                : 'text-ink-300 hover:bg-white/[.05] hover:text-ink-50',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && !locked && (
                              <span className="absolute inset-y-1.5 -left-3 w-[3px] rounded-r-full bg-gym" />
                            )}
                            <Icon className="h-[17px] w-[17px] shrink-0" />
                            {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                            {!collapsed && locked && <Lock className="h-3.5 w-3.5 shrink-0 opacity-60" />}
                          </>
                        )}
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* Pie: usuario */}
      <div className="border-t border-white/[.06] p-3">
        <div className={cx('flex items-center gap-2.5', collapsed && 'justify-center')}>
          <Avatar name={user.name} size={collapsed ? 30 : 34} />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink-100">{user.name}</p>
              <p className="truncate text-[11px] text-ink-500">{ROLE_LABELS[user.role]}</p>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={async () => {
                await signOut()
                navigate('/login')
              }}
              className="rounded-lg p-2 text-ink-400 transition hover:bg-white/5 hover:text-danger-400"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="relative min-h-screen">
      <Backdrop variant="app" />

      {/* Sidebar escritorio */}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 hidden border-r border-white/[.06] bg-ink-950/80 backdrop-blur-xl transition-all duration-300 ease-spring lg:block',
          collapsed ? 'w-[72px]' : 'w-[248px]',
        )}
      >
        {sidebar}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="absolute -right-3 top-20 z-10 grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-ink-850 text-ink-400 transition hover:text-gym"
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          <ChevronLeft className={cx('h-3.5 w-3.5 transition-transform', collapsed && 'rotate-180')} />
        </button>
      </aside>

      {/* Cajón móvil */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink-1000/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[272px] animate-slide-in-right border-r border-white/[.08] bg-ink-950/95 backdrop-blur-xl">
            {sidebar}
          </aside>
        </div>
      )}

      {/* Contenido */}
      <div className={cx('transition-all duration-300 ease-spring', collapsed ? 'lg:pl-[72px]' : 'lg:pl-[248px]')}>
        <header className="no-print sticky top-0 z-30 border-b border-white/[.06] bg-ink-950/75 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-ink-300 transition hover:bg-white/5 lg:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink-300 lg:hidden">{gym.name}</p>
            </div>

            {impersonatedGymId && (
              <button
                onClick={async () => {
                  await impersonateGym(null)
                  navigate('/superadmin')
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-warn-500/30 bg-warn-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-warn-300 transition hover:bg-warn-500/20"
              >
                <Eye className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Viendo como SuperAdmin</span>
                <span className="sm:hidden">SuperAdmin</span>
              </button>
            )}

            <button
              onClick={() => window.location.reload()}
              className="hidden rounded-lg p-2 text-ink-400 transition hover:bg-white/5 hover:text-ink-100 sm:block"
              aria-label="Recargar"
              title="Recargar"
            >
              <RefreshCw className="h-4 w-4" />
            </button>

            {plan.id !== 'BUSINESS' && plan.id !== 'ENTERPRISE' && (
              <Button
                variant="outline-gym"
                size="sm"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                onClick={() => navigate('/planes')}
              >
                <span className="hidden sm:inline">Mejorar plan</span>
                <span className="sm:hidden">Plan</span>
              </Button>
            )}
          </div>
          <SubscriptionBanner gym={gym} />
        </header>

        <main className="px-4 py-5 sm:px-6 sm:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
