import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Clock, Package, UserCheck, UserX, Users2 } from 'lucide-react'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { fullName } from '@/services/employees'
import { WORK_STATUS_LABEL, WORK_STATUS_TONE, isRestDay } from '@/lib/workSchedule'
import { dayKey } from '@/lib/date'
import { cx } from '@/lib/utils'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Avatar, Badge } from '@/components/ui/Feedback'

// ═══════════════════════════════════════════════════════════════════════════
// PERSONAL — bloque del panel.
//
// Cinco números que el dueño quiere saber al abrir la aplicación por la
// mañana: cuánta gente trabaja hoy, quién ya llegó, quién llegó tarde, quién
// falta y qué le han pedido.
//
// Vive aparte del Dashboard para que el módulo de personal se pueda apagar
// entero desde el SuperAdmin sin dejar huecos en la pantalla principal.
// ═══════════════════════════════════════════════════════════════════════════

export function StaffPanel() {
  const { hasFeature, can } = useSession()
  const today = dayKey()

  const employees = useCollection(
    'employees',
    useMemo(
      () => ({
        where: [{ field: 'status', op: '==' as const, value: 'ACTIVE' }],
        orderBy: { field: 'employeeNumber' as const, dir: 'asc' as const },
        limit: 200,
      }),
      [],
    ),
    { enabled: hasFeature('employees') },
  )

  const todayRecords = useCollection(
    'employeeAttendance',
    useMemo(() => ({ where: [{ field: 'date', op: '==' as const, value: today }], limit: 200 }), [today]),
    { enabled: hasFeature('employeeAttendance') },
  )

  const openSupplies = useCollection(
    'supplyRequests',
    useMemo(
      () => ({
        where: [{ field: 'status', op: '==' as const, value: 'PENDING' }],
        orderBy: { field: 'createdAt' as const, dir: 'desc' as const },
        limit: 40,
      }),
      [],
    ),
    { enabled: hasFeature('supplyRequests') },
  )

  const stats = useMemo(() => {
    // Quien descansa hoy no cuenta como falta: no se puede faltar a un día
    // libre, y contarlo así ensuciaría el número que importa.
    const scheduled = employees.data.filter((e) => !isRestDay(e.schedule, today))
    const byId = new Map(todayRecords.data.map((r) => [r.employeeId, r]))

    let arrived = 0
    let late = 0
    for (const e of scheduled) {
      const r = byId.get(e.id)
      if (!r?.actualEntry) continue
      arrived++
      if (r.status === 'LATE') late++
    }

    return {
      active: employees.data.length,
      scheduled: scheduled.length,
      arrived,
      late,
      missing: Math.max(0, scheduled.length - arrived),
      pendingSupplies: openSupplies.data.length,
    }
  }, [employees.data, todayRecords.data, openSupplies.data, today])

  // Si el plan no incluye nada de personal, el bloque no existe.
  if (!hasFeature('employees') && !hasFeature('supplyRequests')) return null
  if (!can('employees.read') && !can('supplies.request')) return null

  const rows = employees.data
    .filter((e) => !isRestDay(e.schedule, today))
    .map((e) => ({ employee: e, record: todayRecords.data.find((r) => r.employeeId === e.id) ?? null }))
    .sort((a, b) => Number(Boolean(b.record?.actualEntry)) - Number(Boolean(a.record?.actualEntry)))

  return (
    <Card className="no-print mt-5">
      <CardHeader
        title="Personal"
        subtitle="Cómo va el equipo hoy"
        icon={<Users2 className="h-4 w-4" />}
        action={
          <Link
            to="/empleados/asistencia"
            className="text-[12.5px] font-semibold text-gym transition hover:brightness-110"
          >
            Ver asistencia →
          </Link>
        }
      />
      <CardBody>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          <Kpi label="Empleados activos" value={stats.active} icon={<Users2 className="h-3.5 w-3.5" />} />
          <Kpi label="Entradas hoy" value={stats.arrived} tone="gym" icon={<UserCheck className="h-3.5 w-3.5" />} />
          <Kpi label="Retardos hoy" value={stats.late} tone="warn" icon={<Clock className="h-3.5 w-3.5" />} />
          <Kpi label="Sin registrar" value={stats.missing} tone="danger" icon={<UserX className="h-3.5 w-3.5" />} />
          <Kpi
            label="Insumos pendientes"
            value={stats.pendingSupplies}
            tone="cyber"
            icon={<Package className="h-3.5 w-3.5" />}
            to="/insumos"
          />
        </div>

        {hasFeature('employeeAttendance') && can('workAttendance.read') && rows.length > 0 && (
          <ul className="mt-4 divide-y divide-white/[.05] border-t border-white/[.06] pt-1">
            {rows.slice(0, 8).map(({ employee, record }) => (
              <li key={employee.id} className="flex items-center gap-3 py-2.5">
                <Avatar name={fullName(employee)} src={employee.photoUrl} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink-100">{fullName(employee)}</p>
                  <p className="truncate text-[11.5px] text-ink-500">{employee.position}</p>
                </div>
                {record?.actualEntry ? (
                  <>
                    <span className="font-mono text-[12.5px] text-ink-300 tnum">{record.actualEntry}</span>
                    <Badge tone={WORK_STATUS_TONE[record.status]}>
                      {WORK_STATUS_LABEL[record.status]}
                      {record.lateMinutes > 0 && ` ${record.lateMinutes}m`}
                    </Badge>
                  </>
                ) : (
                  <Badge tone="neutral">Sin registrar</Badge>
                )}
              </li>
            ))}
          </ul>
        )}

        {rows.length === 0 && hasFeature('employees') && (
          <p className="mt-4 flex items-center gap-2 border-t border-white/[.06] pt-4 text-[12.5px] text-ink-500">
            <CalendarClock className="h-3.5 w-3.5" />
            Hoy no hay nadie con turno asignado.
          </p>
        )}
      </CardBody>
    </Card>
  )
}

const TONE = {
  ink: 'text-ink-100',
  gym: 'text-gym',
  warn: 'text-warn-400',
  danger: 'text-danger-400',
  cyber: 'text-cyber-400',
} as const

function Kpi({
  label,
  value,
  tone = 'ink',
  icon,
  to,
}: {
  label: string
  value: number
  tone?: keyof typeof TONE
  icon?: React.ReactNode
  to?: string
}) {
  const body = (
    <div className="rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2.5 transition-colors hover:border-white/[.12]">
      <p className="flex items-center gap-1.5 text-[11px] text-ink-500">
        {icon}
        <span className="truncate">{label}</span>
      </p>
      <p className={cx('mt-1 text-[20px] font-bold leading-none tnum', TONE[tone])}>{value}</p>
    </div>
  )
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  )
}
