import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, Download, Filter, Info, UserPlus, Users } from 'lucide-react'
import type { Member, MemberStatus } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { usePagedCollection } from '@/hooks/usePagedCollection'
import { useCounters } from '@/hooks/useAggregates'
import { computeStatus, daysLeft, memberTag, STATUS_LABEL } from '@/services/members'
import { searchProvider } from '@/services/search'
import { fmtDate } from '@/lib/date'
import { reportError } from '@/lib/errors'
import { phoneFmt, num } from '@/lib/format'
import { cx, downloadCsv, norm } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Avatar, EmptyState, Spinner, StatusChip } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { SearchInput, Select } from '@/components/ui/Inputs'
import { MemberFormModal } from './MemberFormModal'

// ═══════════════════════════════════════════════════════════════════════════
// Listado de socios.
//
// ESCALA: no se carga la colección entera. Se piden páginas de 30 con cursor
// (`usePagedCollection`), los filtros de estado y de plan viajan al servidor
// como `where`, y el total sale del documento de contadores.
//
// BÚSQUEDA: a través de `searchProvider`, no de Firestore directamente. Hoy
// resuelve por prefijo en el servidor —encuentra "Mar…" pero no "…herrera"— y
// por número de socio de forma exacta. Cambiar a Algolia o Typesense es
// implementar esa interfaz, sin tocar esta pantalla (ver README).
// ═══════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS: Array<{ value: MemberStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Todos los estados' },
  { value: 'ACTIVE', label: 'Activos' },
  { value: 'NEAR_EXPIRATION', label: 'Por vencer' },
  { value: 'EXPIRED', label: 'Vencidos' },
  { value: 'INACTIVE', label: 'Inactivos' },
]

const PAGE_SIZE = 30

export default function Members() {
  const { settings, repo } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const plans = useCollection('membershipPlans')
  const { counters } = useCounters()

  const [query, setQuery] = useState('')
  const [planFilter, setPlanFilter] = useState('ALL')
  const [formOpen, setFormOpen] = useState(false)

  const statusFilter = (params.get('estado') as MemberStatus | null) ?? 'ALL'
  const nearDays = settings?.nearExpirationDays ?? 7

  // Los filtros son `where` de servidor, no un `.filter()` sobre todo cargado.
  const pagedQuery = useMemo(
    () => ({
      where: [
        ...(statusFilter !== 'ALL'
          ? [{ field: 'status', op: '==' as const, value: statusFilter }]
          : []),
        ...(planFilter !== 'ALL'
          ? [{ field: 'membershipPlanId', op: '==' as const, value: planFilter }]
          : []),
      ],
      orderBy: { field: 'memberNumber', dir: 'desc' as const },
    }),
    [statusFilter, planFilter],
  )

  const paged = usePagedCollection('members', pagedQuery, PAGE_SIZE)

  // ── Búsqueda ──
  const [searchResults, setSearchResults] = useState<Member[] | null>(null)
  const [searching, setSearching] = useState(false)
  const term = query.trim()

  useEffect(() => {
    if (!repo || term.length < 2) {
      setSearchResults(null)
      return
    }
    let live = true
    setSearching(true)
    const timer = setTimeout(() => {
      void (async () => {
        try {
          // Toda la búsqueda pasa por `searchProvider`: el día que se conecte
          // Typesense o Algolia, esta pantalla no se toca. Antes llamaba
          // directamente a la implementación de Firestore y esa dependencia
          // habría que deshacerla en cada sitio.
          const found = await searchProvider.searchMembers(repo, term, 40)
          if (!live) return
          setSearchResults(found.map((r) => r.member))
        } catch (err) {
          reportError('buscar socios', err)
          if (live) setSearchResults([])
        } finally {
          if (live) setSearching(false)
        }
      })()
    }, 220) // pequeño retardo: no se consulta en cada tecla
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [repo, term])

  const searchMode = searchResults !== null

  const rows = useMemo(() => {
    const source = searchMode ? searchResults! : paged.rows
    return source
      .map((m) => ({ ...m, status: computeStatus(m, nearDays) }))
      .filter((m) => (searchMode && statusFilter !== 'ALL' ? m.status === statusFilter : true))
      .filter((m) => (searchMode && planFilter !== 'ALL' ? m.membershipPlanId === planFilter : true))
  }, [searchMode, searchResults, paged.rows, nearDays, statusFilter, planFilter])

  const planName = (id?: string | null) => plans.data.find((p) => p.id === id)?.name ?? '—'

  const totalForFilter =
    statusFilter === 'ALL'
      ? counters.members.total
      : statusFilter === 'ACTIVE'
        ? counters.members.active
        : statusFilter === 'NEAR_EXPIRATION'
          ? counters.members.nearExpiration
          : statusFilter === 'EXPIRED'
            ? counters.members.expired
            : counters.members.inactive

  const columns: Column<Member & { status: MemberStatus }>[] = [
    {
      key: 'member',
      header: 'Socio',
      cell: (m) => (
        <div className="flex items-center gap-3">
          <Avatar name={m.name} src={m.photoUrl} size={34} />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-100">{m.name}</p>
            <p className="truncate font-mono text-[11px] text-ink-500">{memberTag(m.memberNumber)}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contacto',
      hideOnMobile: true,
      cell: (m) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] text-ink-200">{phoneFmt(m.phone)}</p>
          <p className="truncate text-[11.5px] text-ink-500">{m.email || '—'}</p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Membresía',
      cell: (m) => <span className="text-[13px] text-ink-300">{planName(m.membershipPlanId)}</span>,
    },
    {
      key: 'expires',
      header: 'Vence',
      cell: (m) => {
        const left = daysLeft(m)
        return (
          <div>
            <p className="text-[13px] text-ink-200 tnum">{fmtDate(m.expiresAt)}</p>
            {m.expiresAt && (
              <p
                className={cx(
                  'text-[11.5px] tnum',
                  left < 0 ? 'text-danger-400' : left <= nearDays ? 'text-warn-400' : 'text-ink-500',
                )}
              >
                {left < 0 ? `Venció hace ${Math.abs(left)} d` : left === 0 ? 'Vence hoy' : `${left} días`}
              </p>
            )}
          </div>
        )
      },
    },
    {
      key: 'status',
      header: 'Estado',
      align: 'right',
      cell: (m) => <StatusChip status={m.status} />,
    },
  ]

  function exportCsv() {
    downloadCsv(
      `socios-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map((m) => ({
        Numero: m.memberNumber,
        Nombre: m.name,
        Telefono: m.phone,
        Correo: m.email,
        Membresia: planName(m.membershipPlanId),
        Inicio: m.startsAt ? fmtDate(m.startsAt) : '',
        Vence: m.expiresAt ? fmtDate(m.expiresAt) : '',
        DiasRestantes: daysLeft(m),
        Estado: STATUS_LABEL[m.status],
      })),
    )
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Socios"
        description={
          searchMode
            ? `${rows.length} resultados para «${term}»`
            : `${num(rows.length)} cargados de ${num(totalForFilter)} · se cargan de ${PAGE_SIZE} en ${PAGE_SIZE}`
        }
        actions={
          <>
            <Button variant="ghost" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv}>
              Exportar
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<UserPlus className="h-3.5 w-3.5" />}
              onClick={() => setFormOpen(true)}
            >
              Nuevo socio
            </Button>
          </>
        }
      />

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Buscar por nombre o número…"
          className="w-full sm:w-72"
        />
        <Select
          value={statusFilter}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'ALL') params.delete('estado')
            else params.set('estado', v)
            setParams(params, { replace: true })
          }}
          containerClassName="w-full sm:w-52"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          containerClassName="w-full sm:w-52"
        >
          <option value="ALL">Todas las membresías</option>
          {plans.data.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {(statusFilter !== 'ALL' || planFilter !== 'ALL' || query) && (
          <Button
            variant="subtle"
            size="sm"
            icon={<Filter className="h-3.5 w-3.5" />}
            onClick={() => {
              setQuery('')
              setPlanFilter('ALL')
              params.delete('estado')
              setParams(params, { replace: true })
            }}
          >
            Limpiar
          </Button>
        )}
        {searching && <Spinner size={16} />}
      </div>

      {searchMode && (
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-white/[.07] bg-ink-900/50 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          La búsqueda encuentra por el <b className="text-ink-200">principio</b> del nombre o por número
          de socio. Buscar por apellido suelto o por teléfono requiere un índice de texto externo.
        </p>
      )}

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(m) => m.id}
          loading={searchMode ? searching && rows.length === 0 : paged.loading}
          onRowClick={(m) => navigate(`/socios/${m.id}`)}
          // La tabla ya recibe una página: no vuelve a paginar en memoria.
          pageSize={1000}
          mobileCard={(m) => (
            <div className="flex items-center gap-3">
              <Avatar name={m.name} src={m.photoUrl} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-ink-100">{m.name}</p>
                <p className="truncate text-[12px] text-ink-500">
                  {memberTag(m.memberNumber)} · {phoneFmt(m.phone)}
                </p>
                <p className="mt-0.5 truncate text-[11.5px] text-ink-500">
                  {planName(m.membershipPlanId)} · vence {fmtDate(m.expiresAt)}
                </p>
              </div>
              <StatusChip status={m.status} />
            </div>
          )}
          empty={
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title={
                searchMode
                  ? 'Ningún socio coincide'
                  : counters.members.total === 0
                    ? 'Todavía no tienes socios'
                    : 'Ningún socio con estos filtros'
              }
              detail={
                searchMode
                  ? 'Prueba con el principio del nombre, o con el número de socio.'
                  : counters.members.total === 0
                    ? 'Da de alta a tu primer socio y asígnale su membresía. Toma menos de un minuto.'
                    : 'Quita algún filtro para ver más resultados.'
              }
              action={
                counters.members.total === 0 ? (
                  <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                    Registrar primer socio
                  </Button>
                ) : undefined
              }
            />
          }
        />

        {/* Cargar más — modelo de cursor, no de "página 7" */}
        {!searchMode && paged.hasMore && (
          <div className="flex justify-center border-t border-white/[.06] p-4">
            <Button
              variant="ghost"
              loading={paged.loadingMore}
              icon={<ChevronDown className="h-4 w-4" />}
              onClick={paged.loadMore}
            >
              Cargar {PAGE_SIZE} más
            </Button>
          </div>
        )}
        {!searchMode && !paged.hasMore && rows.length > 0 && (
          <p className="border-t border-white/[.06] py-3 text-center text-[12px] text-ink-600">
            Has llegado al final de la lista
          </p>
        )}
      </Card>

      <MemberFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        plans={plans.data}
        currentMemberCount={counters.members.total}
        onSaved={(m) => navigate(`/socios/${m.id}`)}
      />
    </div>
  )
}

export { norm }
