import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, UserX, X } from 'lucide-react'
import type { Member } from '@/types'
import { useSession } from '@/state/SessionContext'
import { searchProvider, searchHint } from '@/services/search'
import { memberTag } from '@/services/members'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { Avatar, Badge, Spinner } from '@/components/ui/Feedback'

// ═══════════════════════════════════════════════════════════════════════════
// Selector de socio — busca en el SERVIDOR.
//
// La versión ingenua de esta pantalla se descarga la colección `members` y
// filtra en memoria. Funciona perfectamente con los 100 socios de la demo y se
// vuelve inutilizable con 6 000: son megabytes de descarga y 6 000 lecturas
// facturadas cada vez que alguien abre el modal para apuntar a una persona.
//
// Aquí se consulta a `searchProvider`, que resuelve por prefijo con un rango
// sobre `searchKey` y devuelve como mucho `limit` documentos. Cuando se conecte
// Typesense o Algolia, este componente no cambia.
//
// El único caso que sigue leyendo varios documentos sin término de búsqueda es
// la lista inicial de sugerencias, y va acotada a 8.
// ═══════════════════════════════════════════════════════════════════════════

export interface PickableMember {
  id: string
  name: string
  photoUrl: string | null
  memberNumber: number
  membershipPlanId: string | null
  expiresAt: number | null
  status: Member['status']
}

function toPickable(m: Member): PickableMember {
  return {
    id: m.id,
    name: m.name,
    photoUrl: m.photoUrl ?? null,
    memberNumber: m.memberNumber,
    membershipPlanId: m.membershipPlanId ?? null,
    expiresAt: m.expiresAt ?? null,
    status: m.status,
  }
}

export function MemberPicker({
  onPick,
  limit = 8,
  autoFocus = true,
  includeInactive = false,
  placeholder = 'Buscar por nombre o número de socio…',
  emptyHint,
}: {
  onPick: (member: PickableMember) => void | Promise<void>
  limit?: number
  autoFocus?: boolean
  /** Los socios dados de baja se ocultan salvo que se pidan expresamente. */
  includeInactive?: boolean
  placeholder?: string
  emptyHint?: string
}) {
  const { repo } = useSession()
  const [term, setTerm] = useState('')
  const [rows, setRows] = useState<PickableMember[]>([])
  const [loading, setLoading] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    if (!repo) return
    const id = ++requestId.current
    setLoading(true)

    // 220 ms: suficiente para no lanzar una consulta por tecla, poco para que
    // se note. Lo que llega tarde se descarta comparando el identificador, así
    // que una respuesta lenta nunca pisa a otra más reciente.
    const timer = setTimeout(async () => {
      try {
        const query = term.trim()
        const found = query
          ? (await searchProvider.searchMembers(repo, query, limit)).map((r) => toPickable(r.member))
          : (
              await repo.list('members', {
                orderBy: { field: 'memberNumber', dir: 'desc' },
                limit,
              })
            ).map(toPickable)

        if (id !== requestId.current) return
        setRows(includeInactive ? found : found.filter((m) => m.status !== 'INACTIVE'))
      } catch (err) {
        if (id !== requestId.current) return
        reportError('buscar socios', err)
        setRows([])
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    }, 220)

    return () => clearTimeout(timer)
  }, [repo, term, limit, includeInactive])

  const hint = useMemo(() => emptyHint ?? searchHint(), [emptyHint])

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
        <input
          value={term}
          autoFocus={autoFocus}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={placeholder}
          className="h-10 w-full rounded-xl border border-white/10 bg-ink-950/60 pl-9 pr-9 text-sm text-ink-100 transition placeholder:text-ink-500 focus:border-gym/60 focus:bg-ink-950 focus:outline-none focus:ring-4 focus:ring-gym/15"
        />
        {loading ? (
          <Spinner size={16} className="absolute right-3 top-1/2 -translate-y-1/2" />
        ) : term ? (
          <button
            onClick={() => setTerm('')}
            aria-label="Limpiar búsqueda"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-500 transition hover:bg-white/5 hover:text-ink-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <ul className="mt-3 space-y-1">
        {rows.map((m) => (
          <li key={m.id}>
            <button
              disabled={picking !== null}
              onClick={async () => {
                setPicking(m.id)
                try {
                  await onPick(m)
                } finally {
                  setPicking(null)
                }
              }}
              className={cx(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition',
                'hover:bg-white/[.05] disabled:opacity-50',
              )}
            >
              <Avatar name={m.name} src={m.photoUrl} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-ink-100">{m.name}</span>
                <span className="block font-mono text-[11px] text-ink-500">{memberTag(m.memberNumber)}</span>
              </span>
              {m.status === 'EXPIRED' && <Badge tone="danger">Vencido</Badge>}
              {m.status === 'NEAR_EXPIRATION' && <Badge tone="warn">Por vencer</Badge>}
              {m.status === 'INACTIVE' && <Badge tone="neutral">Baja</Badge>}
            </button>
          </li>
        ))}

        {!loading && rows.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <UserX className="h-5 w-5 text-ink-600" />
            <p className="text-[13px] text-ink-400">
              {term ? 'Ningún socio coincide' : 'Escribe para buscar un socio'}
            </p>
            <p className="max-w-xs text-[11.5px] leading-snug text-ink-600">{hint}</p>
          </li>
        )}
      </ul>
    </div>
  )
}
