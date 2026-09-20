import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { FullPageLoader } from '@/components/ui/Feedback'
import { AppShell } from '@/components/layout/AppShell'
import { PortalShell } from '@/components/layout/PortalShell'
import { SuperAdminShell } from '@/components/layout/SuperAdminShell'
import { RedirectIfAuthed, RequireAuth, RequireFeature, RequirePermission, RequireRole } from './guards'

// Las pantallas se cargan bajo demanda: la landing pública no arrastra el
// código del panel, y el portal del socio (que se usa en 4G desde un móvil)
// no arrastra el del punto de venta.

const Landing = lazy(() => import('@/pages/public/Landing'))
const Plans = lazy(() => import('@/pages/public/Plans'))
const Register = lazy(() => import('@/pages/public/Register'))
const Checkout = lazy(() => import('@/pages/public/Checkout'))
const Login = lazy(() => import('@/pages/public/Login'))
const GymPublic = lazy(() => import('@/pages/public/GymPublic'))
const NotFound = lazy(() => import('@/pages/public/NotFound'))

const Dashboard = lazy(() => import('@/pages/app/Dashboard'))
const Members = lazy(() => import('@/pages/app/Members'))
const MemberProfile = lazy(() => import('@/pages/app/MemberProfile'))
const Memberships = lazy(() => import('@/pages/app/Memberships'))
const Payments = lazy(() => import('@/pages/app/Payments'))
const Visits = lazy(() => import('@/pages/app/Visits'))
const AttendancePage = lazy(() => import('@/pages/app/Attendance'))
const Classes = lazy(() => import('@/pages/app/Classes'))
const ReservationsPage = lazy(() => import('@/pages/app/Reservations'))
const Spinning = lazy(() => import('@/pages/app/Spinning'))
const Pos = lazy(() => import('@/pages/app/Pos'))
const Inventory = lazy(() => import('@/pages/app/Inventory'))
const Reports = lazy(() => import('@/pages/app/Reports'))
const StaffPage = lazy(() => import('@/pages/app/Staff'))
const SettingsPage = lazy(() => import('@/pages/app/Settings'))
const SubscriptionPage = lazy(() => import('@/pages/app/Subscription'))
const Activity = lazy(() => import('@/pages/app/Activity'))
const Reception = lazy(() => import('@/pages/reception/Reception'))

// ── Operación interna (Fase 4) ──
const Employees = lazy(() => import('@/pages/app/Employees'))
const EmployeeAttendancePage = lazy(() => import('@/pages/app/EmployeeAttendancePage'))
const Supplies = lazy(() => import('@/pages/app/Supplies'))
const Devices = lazy(() => import('@/pages/app/Devices'))
const StaffReport = lazy(() => import('@/pages/app/StaffReport'))

const PortalHome = lazy(() => import('@/pages/portal/PortalHome'))
const PortalMembership = lazy(() => import('@/pages/portal/PortalMembership'))
const PortalPayments = lazy(() => import('@/pages/portal/PortalPayments'))
const PortalAttendance = lazy(() => import('@/pages/portal/PortalAttendance'))
const PortalReservations = lazy(() => import('@/pages/portal/PortalReservations'))
const PortalProfile = lazy(() => import('@/pages/portal/PortalProfile'))

const SuperAdmin = lazy(() => import('@/pages/superadmin/SuperAdmin'))
const SuperGyms = lazy(() => import('@/pages/superadmin/SuperGyms'))
const SuperPlans = lazy(() => import('@/pages/superadmin/SuperPlans'))
const SuperFeatures = lazy(() => import('@/pages/superadmin/SuperFeatures'))
const SuperSubscriptions = lazy(() => import('@/pages/superadmin/SuperSubscriptions'))
const SuperUsers = lazy(() => import('@/pages/superadmin/SuperUsers'))
const SuperAudit = lazy(() => import('@/pages/superadmin/SuperAudit'))
const SuperSettings = lazy(() => import('@/pages/superadmin/SuperSettings'))
const SuperMaintenance = lazy(() => import('@/pages/superadmin/SuperMaintenance'))

function Lazy() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Outlet />
    </Suspense>
  )
}

const STAFF_ROLES = [
  'OWNER',
  'ADMIN',
  'RECEPCIONISTA',
  'ENTRENADOR',
  'MANTENIMIENTO',
  'SUPERADMIN',
] as const

export const router = createBrowserRouter([
  {
    element: <Lazy />,
    children: [
      // ── Público ──────────────────────────────────────────────────────
      { path: '/', element: <Landing /> },
      { path: '/planes', element: <Plans /> },
      { path: '/g/:slug', element: <GymPublic /> },
      {
        path: '/registro',
        element: (
          <RedirectIfAuthed>
            <Register />
          </RedirectIfAuthed>
        ),
      },
      { path: '/checkout', element: <Checkout /> },
      {
        path: '/login',
        element: (
          <RedirectIfAuthed>
            <Login />
          </RedirectIfAuthed>
        ),
      },

      // ── Área del gimnasio ────────────────────────────────────────────
      {
        element: (
          <RequireAuth>
            <RequireRole roles={[...STAFF_ROLES]}>
              <AppShell />
            </RequireRole>
          </RequireAuth>
        ),
        children: [
          {
            // El panel enseña los INGRESOS del gimnasio. Sin este guardián, un
            // entrenador o un recepcionista escribía /dashboard a mano y veía
            // la facturación del mes: el menú lo escondía, pero la ruta no lo
            // impedía. Esconder no es proteger.
            path: '/dashboard',
            element: (
              <RequirePermission permission="reports.read">
                <Dashboard />
              </RequirePermission>
            ),
          },
          {
            path: '/socios',
            element: (
              <RequirePermission permission="members.read">
                <Members />
              </RequirePermission>
            ),
          },
          {
            path: '/socios/:id',
            element: (
              <RequirePermission permission="members.read">
                <MemberProfile />
              </RequirePermission>
            ),
          },
          {
            path: '/membresias',
            element: (
              <RequirePermission permission="memberships.manage">
                <Memberships />
              </RequirePermission>
            ),
          },
          {
            path: '/pagos',
            element: (
              <RequirePermission permission="payments.read">
                <Payments />
              </RequirePermission>
            ),
          },
          {
            path: '/visitas',
            element: (
              <RequirePermission permission="visits.write">
                <Visits />
              </RequirePermission>
            ),
          },
          {
            path: '/asistencias',
            element: (
              <RequirePermission permission="attendance.write">
                <AttendancePage />
              </RequirePermission>
            ),
          },
          {
            path: '/clases',
            element: (
              <RequirePermission permission="classes.manage">
                <RequireFeature feature="classes">
                  <Classes />
                </RequireFeature>
              </RequirePermission>
            ),
          },
          {
            path: '/reservaciones',
            element: (
              <RequirePermission permission="reservations.manage">
                <RequireFeature feature="reservations">
                  <ReservationsPage />
                </RequireFeature>
              </RequirePermission>
            ),
          },
          {
            path: '/spinning',
            element: (
              <RequirePermission permission="reservations.manage">
                <RequireFeature feature="spinningMap">
                  <Spinning />
                </RequireFeature>
              </RequirePermission>
            ),
          },
          {
            path: '/pos',
            element: (
              <RequirePermission permission="pos.use">
                <RequireFeature feature="posBasic">
                  <Pos />
                </RequireFeature>
              </RequirePermission>
            ),
          },
          {
            path: '/inventario',
            element: (
              <RequirePermission permission="inventory.manage">
                <RequireFeature feature="inventory">
                  <Inventory />
                </RequireFeature>
              </RequirePermission>
            ),
          },
          {
            path: '/reportes',
            element: (
              <RequirePermission permission="reports.read">
                <Reports />
              </RequirePermission>
            ),
          },
          {
            path: '/usuarios',
            element: (
              <RequirePermission permission="staff.manage">
                <StaffPage />
              </RequirePermission>
            ),
          },
          {
            path: '/configuracion',
            element: (
              <RequirePermission permission="settings.manage">
                <SettingsPage />
              </RequirePermission>
            ),
          },
          {
            path: '/suscripcion',
            element: (
              <RequirePermission permission="gym.manage">
                <SubscriptionPage />
              </RequirePermission>
            ),
          },
          {
            path: '/actividad',
            element: (
              <RequirePermission permission="settings.manage">
                <Activity />
              </RequirePermission>
            ),
          },

          // ── Operación interna (Fase 4) ──
          //
          // Cada una detrás de su permiso Y de su funcionalidad de plan. El
          // SuperAdmin decide qué paquete las incluye; hasta entonces la ruta
          // muestra el aviso de mejora y el servidor rechaza las escrituras.
          {
            path: '/empleados',
            element: (
              <RequirePermission permission="employees.read">
                <RequireFeature feature="employees">
                  <Employees />
                </RequireFeature>
              </RequirePermission>
            ),
          },
          {
            path: '/empleados/asistencia',
            element: (
              <RequirePermission permission="workAttendance.read">
                <RequireFeature feature="employeeAttendance">
                  <EmployeeAttendancePage />
                </RequireFeature>
              </RequirePermission>
            ),
          },
          {
            path: '/insumos',
            element: (
              <RequirePermission permission="supplies.request">
                <RequireFeature feature="supplyRequests">
                  <Supplies />
                </RequireFeature>
              </RequirePermission>
            ),
          },
          {
            path: '/configuracion/dispositivos',
            element: (
              <RequirePermission permission="devices.manage">
                <RequireFeature feature="biometrics">
                  <Devices />
                </RequireFeature>
              </RequirePermission>
            ),
          },
          {
            path: '/reportes/personal',
            element: (
              <RequirePermission permission="workAttendance.read">
                <RequireFeature feature="employeeAttendance">
                  <StaffReport />
                </RequireFeature>
              </RequirePermission>
            ),
          },
        ],
      },

      // ── Recepción (pantalla completa, sin sidebar) ───────────────────
      {
        path: '/recepcion',
        element: (
          <RequireAuth>
            <RequirePermission permission="reception.use">
              <Reception />
            </RequirePermission>
          </RequireAuth>
        ),
      },

      // ── Portal del socio ─────────────────────────────────────────────
      {
        element: (
          <RequireAuth>
            <RequireRole roles={['MEMBER']}>
              <PortalShell />
            </RequireRole>
          </RequireAuth>
        ),
        children: [
          { path: '/portal', element: <PortalHome /> },
          { path: '/portal/membresia', element: <PortalMembership /> },
          { path: '/portal/pagos', element: <PortalPayments /> },
          { path: '/portal/asistencias', element: <PortalAttendance /> },
          { path: '/portal/reservaciones', element: <PortalReservations /> },
          { path: '/portal/perfil', element: <PortalProfile /> },
        ],
      },

      // ── SuperAdmin ───────────────────────────────────────────────────
      {
        element: (
          <RequireAuth>
            <RequireRole roles={['SUPERADMIN']}>
              <SuperAdminShell />
            </RequireRole>
          </RequireAuth>
        ),
        children: [
          { path: '/superadmin', element: <SuperAdmin /> },
          { path: '/superadmin/gimnasios', element: <SuperGyms /> },
          { path: '/superadmin/planes', element: <SuperPlans /> },
          { path: '/superadmin/funcionalidades', element: <SuperFeatures /> },
          { path: '/superadmin/suscripciones', element: <SuperSubscriptions /> },
          { path: '/superadmin/usuarios', element: <SuperUsers /> },
          { path: '/superadmin/auditoria', element: <SuperAudit /> },
          { path: '/superadmin/configuracion', element: <SuperSettings /> },
          { path: '/superadmin/mantenimiento', element: <SuperMaintenance /> },
          // Alias en inglés: el enunciado del producto los nombra así.
          { path: '/superadmin/features', element: <Navigate to="/superadmin/funcionalidades" replace /> },
          { path: '/superadmin/plans', element: <Navigate to="/superadmin/planes" replace /> },
        ],
      },

    { path: '/404', element: <NotFound /> },
{ path: '*', element: <Navigate to="/404" replace /> },
    ],
  },
],
{
  basename: '/easygym'
}
)