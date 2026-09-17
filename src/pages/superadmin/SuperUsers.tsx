import { useMemo, useState } from 'react'
import { ShieldCheck, Users } from 'lucide-react'
import type { AppUser, Role } from '@/types'
import { ROLE_LABELS } from '@/services/auth'
import { fmtDate } from '@/lib/date'
import { num } from '@/lib/format'
import { norm } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Avatar, Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { SearchInput, Select } from '@/components/ui/Inputs'
import { usePlatformData, useMemberCounts } from './usePlatformData'

const ROLE_TONE: Record<Role, 'gym' | 'cyber' | 'plasma' | 'warn' | 'neutral'> = {
  SUPERADMIN: 'plasma',
  OWNER: 'gym',
  ADMIN: 'cyber',
  RECEPCIONISTA: 'warn',
  ENTRENADOR: 'neutral',
  MANTENIMIENTO: 'neutral',
  MEMBER: 'neutral',
}

/** Los que administran un gimnasio. Los socios no salen en esta pantalla. */
const STAFF_ROLES: Role[] = [
  'SUPERADMIN',
  'OWNER',
  'ADMIN',
  'RECEPCIONISTA',
  'ENTRENADOR',
  'MANTENIMIENTO',
]

export default function SuperUsers() {
  const { gyms, users, loading } = usePlatformData()
  const memberCounts = useMemberCounts()
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<Role | 'ALL'>('ALL')
  const [gymFilter, setGymFilter] = useState('ALL')

  const gymName = (id: string) => (id ? (gyms.find((g) => g.id === id)?.name ?? '—') : 'Plataforma')

  const rows = useMemo(() => {
    const q = norm(query.trim())
    return users
      .filter((u) => (role === 'ALL' ? true : u.role === role))
      .filter((u) => (gymFilter === 'ALL' ? true : u.gymId === gymFilter))
      .filter((u) => (!q ? true : norm(u.name).includes(q) || norm(u.email).includes(q)))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [users, query, role, gymFilter])

  const byRole = useMemo(() => {
    const out: Partial<Record<Role, number>> = {}
    for (const u of users) out[u.role] = (out[u.role] ?? 0) + 1
    return out
  }, [users])

  // Los socios no se listan aquí, pero su total sí interesa. Sale de los
  // contadores por gimnasio: un documento por gimnasio en vez de una fila por
  // socio, que en una plataforma con 300 gimnasios serían cientos de miles.
  const totalMembers = useMemo(
    () => Object.values(memberCounts).reduce((a, n) => a + n, 0),
    [memberCounts],
  )

  const columns: Column<AppUser>[] = [
    {
      key: 'user',
      header: 'Usuario',
      sortValue: (u) => u.name,
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.name} src={u.avatarUrl} size={32} />
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-medium text-ink-100">{u.name}</p>
            <p className="truncate text-[11.5px] text-ink-500">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'gym',
      header: 'Gimnasio',
      sortValue: (u) => gymName(u.gymId),
      cell: (u) => <span className="truncate text-[13px] text-ink-300">{gymName(u.gymId)}</span>,
    },
    {
      key: 'role',
      header: 'Rol',
      sortValue: (u) => u.role,
      cell: (u) => <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge>,
    },
    {
      key: 'created',
      header: 'Alta',
      hideOnMobile: true,
      sortValue: (u) => u.createdAt,
      cell: (u) => <span className="whitespace-nowrap text-[12.5px] text-ink-400 tnum">{fmtDate(u.createdAt)}</span>,
    },
    {
      key: 'last',
      header: 'Último acceso',
      hideOnMobile: true,
      sortValue: (u) => u.lastLoginAt ?? 0,
      cell: (u) => (
        <span className="whitespace-nowrap text-[12.5px] text-ink-400 tnum">
          {u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'Nunca'}
        </span>
      ),
    },
    {
      key: 'active',
      header: 'Estado',
      align: 'right',
      cell: (u) => (
        <Badge tone={u.active ? 'gym' : 'danger'} dot>
          {u.active ? 'Activo' : 'Desactivado'}
        </Badge>
      ),
    },
  ]

  if (loading) return <LoadingBlock />

  return (
    <div>
      <PageHeader
        eyebrow="Plataforma"
        title="Usuarios"
        description="Las cuentas que administran gimnasios. Los socios no se listan aquí: son cientos de miles y se consultan dentro de cada gimnasio."
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {STAFF_ROLES.map((r) => (
          <Card key={r} className="p-3.5">
            <p className="truncate text-[11px] text-ink-400">{ROLE_LABELS[r]}</p>
            <p className="mt-1 text-[20px] font-bold text-ink-50 tnum">{byRole[r] ?? 0}</p>
          </Card>
        ))}
        <Card className="p-3.5">
          <p className="truncate text-[11px] text-ink-400">Socios</p>
          <p className="mt-1 text-[20px] font-bold text-plasma-300 tnum">{num(totalMembers)}</p>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={query} onValueChange={setQuery} placeholder="Buscar nombre o correo…" className="w-full sm:w-72" />
        <Select value={role} onChange={(e) => setRole(e.target.value as Role | 'ALL')} containerClassName="w-full sm:w-48">
          <option value="ALL">Todos los roles</option>
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        <Select value={gymFilter} onChange={(e) => setGymFilter(e.target.value)} containerClassName="w-full sm:w-52">
          <option value="ALL">Todos los gimnasios</option>
          {gyms.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(u) => u.uid}
          pageSize={40}
          empty={<EmptyState icon={<Users className="h-6 w-6" />} title="Ningún usuario coincide" />}
        />
      </Card>

      <Card className="mt-3">
        <CardHeader
          title="Aislamiento por gymId"
          subtitle="Por qué un gimnasio nunca ve los datos de otro"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <CardBody>
          <ul className="space-y-2.5 text-[13px] leading-relaxed text-ink-400">
            <li>
              <b className="text-ink-200">En el cliente:</b> todas las consultas pasan por{' '}
              <code className="font-mono text-gym">TenantRepo</code>, que inyecta{' '}
              <code className="font-mono">where(&apos;gymId&apos;, &apos;==&apos;, miGym)</code> en cada query.
              No existe forma de pedir «todos los socios» sin gimnasio.
            </li>
            <li>
              <b className="text-ink-200">En el servidor:</b>{' '}
              <code className="font-mono text-gym">firestore.rules</code> compara el gymId de cada documento
              contra el del usuario autenticado (custom claims, no lo que mande el navegador).
            </li>
            <li>
              <b className="text-ink-200">El SUPERADMIN</b> es la única excepción, y esta pantalla es el único
              lugar de toda la aplicación que consulta sin filtrar por gymId.
            </li>
          </ul>
        </CardBody>
      </Card>
    </div>
  )
}
