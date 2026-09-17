import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Pencil, Plus, ShieldCheck, UserCog, UserX } from 'lucide-react'
import type { AppUser, Role } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { platform } from '@/services/db'
import { auth, ROLE_LABELS } from '@/services/auth'
import { audit } from '@/services/audit'
import { getPlan, limitLabel, staffLimitReached } from '@/config/plans'
import { fmtDate } from '@/lib/date'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Avatar, Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Input, Select, Toggle } from '@/components/ui/Inputs'
import { completeOnboardingStep } from './OnboardingChecklist'

// Usuarios del gimnasio. El rol decide qué ve cada quien: un recepcionista no
// tiene por qué ver los reportes de ingresos del dueño.

const ASSIGNABLE_ROLES: Role[] = ['ADMIN', 'RECEPCIONISTA', 'ENTRENADOR', 'MANTENIMIENTO']

const ROLE_DESCRIPTION: Record<Role, string> = {
  SUPERADMIN: 'Administra toda la plataforma EasyGym.',
  OWNER: 'Control total del gimnasio, incluida la suscripción.',
  ADMIN: 'Todo salvo la suscripción y el cambio de dueño.',
  RECEPCIONISTA: 'Socios, cobros, visitas, asistencias y punto de venta.',
  ENTRENADOR: 'Clases, reservaciones y consulta de socios.',
  MANTENIMIENTO: 'Solo las solicitudes de insumos que le tocan.',
  MEMBER: 'Solo su portal personal.',
}

const ROLE_TONE: Record<Role, 'gym' | 'cyber' | 'plasma' | 'warn' | 'neutral'> = {
  SUPERADMIN: 'plasma',
  OWNER: 'gym',
  ADMIN: 'cyber',
  RECEPCIONISTA: 'warn',
  ENTRENADOR: 'neutral',
  MANTENIMIENTO: 'neutral',
  MEMBER: 'neutral',
}

export default function Staff() {
  const { gym, user: me } = useSession()
  const toast = useToast()

  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AppUser | null>(null)
  const [removing, setRemoving] = useState<AppUser | null>(null)

  // Los usuarios son colección de plataforma: se consultan por gymId a mano.
  useEffect(() => {
    if (!gym) return
    return platform.watch('users', { where: [{ field: 'gymId', op: '==', value: gym.id }] }, (rows) => {
      setUsers(rows as AppUser[])
      setLoading(false)
    })
  }, [gym])

  const staff = useMemo(() => users.filter((u) => u.role !== 'MEMBER'), [users])
  const memberUsers = useMemo(() => users.filter((u) => u.role === 'MEMBER'), [users])

  const plan = getPlan(gym?.planId)
  const limitHit = gym ? staffLimitReached(gym, staff.length) : false

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Usuarios"
        description="Quién puede entrar al sistema y qué puede hacer."
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setCreating(true)}
            disabled={limitHit}
          >
            Nuevo usuario
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-ink-100">
              {staff.length} de {limitLabel(plan.maxStaff)} usuarios administrativos
            </p>
            <p className="mt-0.5 text-[12px] text-ink-500">
              Tu plan {plan.name} permite {limitLabel(plan.maxStaff)}. Los socios con portal no cuentan.
            </p>
          </div>
          {limitHit && <Badge tone="warn">Llegaste al límite</Badge>}
        </div>
      </Card>

      {loading ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-3">
          <Card>
            <CardHeader title="Equipo" subtitle="Dueño, administradores, recepción y entrenadores" icon={<UserCog className="h-4 w-4" />} />
            <CardBody>
              {staff.length === 0 ? (
                <EmptyState title="Sin usuarios todavía" />
              ) : (
                <ul className="divide-y divide-white/[.05]">
                  {staff
                    .sort((a, b) => a.role.localeCompare(b.role))
                    .map((u) => (
                      <li key={u.uid} className="flex flex-wrap items-center gap-3 py-3">
                        <Avatar name={u.name} src={u.avatarUrl} size={38} />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 truncate text-[14px] font-medium text-ink-100">
                            {u.name}
                            {u.uid === me?.uid && <Badge tone="neutral">Tú</Badge>}
                          </p>
                          <p className="truncate text-[12px] text-ink-500">{u.email}</p>
                        </div>
                        <div className="text-right">
                          <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                          <p className="mt-1 text-[11px] text-ink-600">
                            {u.lastLoginAt ? `Entró ${fmtDate(u.lastLoginAt)}` : 'Nunca ha entrado'}
                          </p>
                        </div>
                        {!u.active && <Badge tone="danger">Desactivado</Badge>}
                        {u.role !== 'OWNER' && (
                          <div className="flex shrink-0 gap-1">
                            <IconButton label="Editar" size="sm" onClick={() => setEditing(u)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </IconButton>
                            <IconButton label="Desactivar" size="sm" onClick={() => setRemoving(u)}>
                              <UserX className="h-3.5 w-3.5" />
                            </IconButton>
                          </div>
                        )}
                      </li>
                    ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {memberUsers.length > 0 && (
            <Card>
              <CardHeader
                title="Socios con acceso al portal"
                subtitle={`${memberUsers.length} socios pueden entrar desde su celular`}
              />
              <CardBody>
                <ul className="divide-y divide-white/[.05]">
                  {memberUsers.slice(0, 10).map((u) => (
                    <li key={u.uid} className="flex items-center gap-3 py-2.5">
                      <Avatar name={u.name} size={30} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-200">{u.name}</span>
                      <span className="truncate text-[11.5px] text-ink-500">{u.email}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {/* Explicación de roles */}
          <Card>
            <CardHeader title="Qué puede hacer cada rol" icon={<ShieldCheck className="h-4 w-4" />} />
            <CardBody>
              <ul className="space-y-2.5">
                {(['OWNER', ...ASSIGNABLE_ROLES, 'MEMBER'] as Role[]).map((r) => (
                  <li key={r} className="flex flex-wrap items-baseline gap-3">
                    <Badge tone={ROLE_TONE[r]} className="w-32 justify-center">
                      {ROLE_LABELS[r]}
                    </Badge>
                    <span className="min-w-0 flex-1 text-[12.5px] text-ink-400">{ROLE_DESCRIPTION[r]}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      )}

      <UserModal
        open={creating || editing !== null}
        user={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSave={async (v) => {
          if (!gym) return
          if (editing) {
            await platform.update('users', editing.uid, {
              name: v.name,
              phone: v.phone,
              role: v.role,
              active: v.active,
            })

            // Un cambio de rol es el cambio con más consecuencias de toda la
            // aplicación: decide quién puede tocar el dinero. Se registra
            // aparte para que se pueda filtrar por él.
            if (v.role !== editing.role) {
              audit({
                gymId: gym.id,
                action: 'STAFF_ROLE_CHANGED',
                entityType: 'users',
                entityId: editing.uid,
                summary: `${editing.name}: ${ROLE_LABELS[editing.role] ?? editing.role} → ${ROLE_LABELS[v.role] ?? v.role}`,
                before: { rol: editing.role },
                after: { rol: v.role },
              })
            }
            audit({
              gymId: gym.id,
              action: 'STAFF_UPDATED',
              entityType: 'users',
              entityId: editing.uid,
              summary: `Edición del usuario ${v.name}`,
              before: { nombre: editing.name, activo: editing.active },
              after: { nombre: v.name, activo: v.active },
            })
            toast.success('Usuario actualizado', v.name)
          } else {
            const created = await auth.signUp({
              email: v.email,
              password: v.password,
              name: v.name,
              phone: v.phone,
              role: v.role,
              gymId: gym.id,
            })
            await completeOnboardingStep(gym, 'staff')
            audit({
              gymId: gym.id,
              action: 'STAFF_CREATED',
              entityType: 'users',
              entityId: created.uid,
              summary: `Usuario creado: ${v.name} (${ROLE_LABELS[v.role] ?? v.role})`,
              after: { nombre: v.name, correo: v.email, rol: v.role },
            })
            toast.success('Usuario creado', `${v.name} ya puede iniciar sesión.`)
          }
          setCreating(false)
          setEditing(null)
        }}
      />

      <ConfirmModal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="¿Desactivar este usuario?"
        message={`${removing?.name} dejará de poder iniciar sesión. No se borra nada de lo que registró.`}
        confirmLabel="Desactivar"
        onConfirm={async () => {
          if (!removing) return
          await platform.update('users', removing.uid, { active: false })
          audit({
            gymId: removing.gymId,
            action: 'STAFF_DEACTIVATED',
            entityType: 'users',
            entityId: removing.uid,
            summary: `Usuario desactivado: ${removing.name}`,
            before: { activo: true },
            after: { activo: false },
          })
          toast.info('Usuario desactivado', removing.name)
          setRemoving(null)
        }}
      />
    </div>
  )
}

function UserModal({
  open,
  user,
  onClose,
  onSave,
}: {
  open: boolean
  user: AppUser | null
  onClose: () => void
  onSave: (v: { name: string; email: string; phone: string; password: string; role: Role; active: boolean }) => Promise<void>
}) {
  const [v, setV] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    role: 'RECEPCIONISTA' as Role,
    active: true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setV(
      user
        ? { name: user.name, email: user.email, phone: user.phone ?? '', password: '', role: user.role, active: user.active }
        : { name: '', email: '', phone: '', password: '', role: 'RECEPCIONISTA', active: true },
    )
  }, [open, user])

  const valid =
    v.name.trim().length >= 3 &&
    (user ? true : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email) && v.password.length >= 8)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? 'Editar usuario' : 'Nuevo usuario'}
      description={user ? undefined : 'Recibirá acceso inmediato con el correo y contraseña que definas.'}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onSave(v)
              } catch (err) {
                setError(reportError('guardar usuario', err).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {user ? 'Guardar' : 'Crear usuario'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Nombre completo"
          required
          value={v.name}
          onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))}
          containerClassName="sm:col-span-2"
        />
        <Input
          label="Correo electrónico"
          type="email"
          required
          value={v.email}
          onChange={(e) => setV((x) => ({ ...x, email: e.target.value }))}
          disabled={Boolean(user)}
          hint={user ? 'El correo no se puede cambiar' : undefined}
        />
        <Input
          label="Teléfono"
          type="tel"
          value={v.phone}
          onChange={(e) => setV((x) => ({ ...x, phone: e.target.value }))}
        />
        {!user && (
          <Input
            label="Contraseña"
            type="password"
            required
            value={v.password}
            onChange={(e) => setV((x) => ({ ...x, password: e.target.value }))}
            hint="Mínimo 8 caracteres"
            prefix={<KeyRound className="h-4 w-4" />}
            containerClassName="sm:col-span-2"
          />
        )}
        <Select
          label="Rol"
          value={v.role}
          onChange={(e) => setV((x) => ({ ...x, role: e.target.value as Role }))}
          hint={ROLE_DESCRIPTION[v.role]}
          containerClassName="sm:col-span-2"
        >
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </div>

      {user && (
        <div className="mt-4">
          <Toggle
            checked={v.active}
            onChange={(active) => setV((x) => ({ ...x, active }))}
            label="Cuenta activa"
            description="Si la desactivas, no podrá iniciar sesión."
          />
        </div>
      )}

      {error && (
        <p className={cx('mt-4 rounded-xl border border-danger-500/30 bg-danger-500/10 px-3.5 py-2.5 text-[13px] text-danger-200')}>
          {error}
        </p>
      )}
    </Modal>
  )
}
