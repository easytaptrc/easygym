import type { Member } from '@/types'
import { norm } from '@/lib/utils'
import type { TenantRepo } from './db'

// ═══════════════════════════════════════════════════════════════════════════
// Búsqueda de socios — detrás de una interfaz.
//
// Firestore NO hace búsqueda de texto. Lo que sí hace, y bien, es rangos sobre
// strings: eso resuelve la búsqueda por PREFIJO sin traerse la colección.
//
//   searchKey >= "mar"  &&  searchKey <= "mar"
//
// Eso encuentra «María» escribiendo «mar». No encuentra «María Herrera»
// escribiendo «herrera», ni tolera erratas, ni busca por teléfono o correo.
//
// Ese límite es real y no se arregla con más código de cliente: hace falta un
// índice invertido. Por eso la búsqueda vive detrás de `SearchProvider`:
// cambiar a Typesense o Algolia es implementar esta interfaz y cambiar una
// línea en `searchProvider`, sin tocar ninguna pantalla.
// ═══════════════════════════════════════════════════════════════════════════

export interface MemberSearchResult {
  member: Member
  /** Por qué campo se encontró. Sirve para explicarlo en la interfaz. */
  matchedOn: 'name' | 'memberNumber' | 'phone' | 'email'
}

export interface SearchCapabilities {
  /** Nombre del motor, para mostrarlo en diagnósticos. */
  engine: string
  /** ¿Encuentra por cualquier parte del texto, no solo por el principio? */
  fullText: boolean
  /** ¿Tolera erratas? */
  typoTolerant: boolean
  searchableFields: Array<'name' | 'memberNumber' | 'phone' | 'email'>
}

export interface SearchProvider {
  readonly capabilities: SearchCapabilities
  searchMembers(repo: TenantRepo, term: string, limit?: number): Promise<MemberSearchResult[]>
}

// ───────────────────── Implementación sobre Firestore ───────────────────────

class FirestorePrefixSearch implements SearchProvider {
  readonly capabilities: SearchCapabilities = {
    engine: 'Firestore (prefijo)',
    fullText: false,
    typoTolerant: false,
    searchableFields: ['name', 'memberNumber'],
  }

  async searchMembers(repo: TenantRepo, term: string, limit = 30): Promise<MemberSearchResult[]> {
    const q = norm(term.trim())
    if (!q) return []

    const results: MemberSearchResult[] = []
    const seen = new Set<string>()

    // Un término puramente numérico casi siempre es el número de socio.
    if (/^\d+$/.test(q)) {
      const byNumber = await repo.list('members', {
        where: [{ field: 'memberNumber', op: '==', value: Number(q) }],
        limit: 5,
      })
      for (const m of byNumber) {
        if (!seen.has(m.id)) {
          seen.add(m.id)
          results.push({ member: m, matchedOn: 'memberNumber' })
        }
      }
    }

    // Prefijo de nombre, resuelto en el servidor con un rango.
    const byName = await repo.list('members', {
      where: [
        { field: 'searchKey', op: '>=', value: q },
        { field: 'searchKey', op: '<=', value: `${q}` },
      ],
      orderBy: { field: 'searchKey', dir: 'asc' },
      limit,
    })
    for (const m of byName) {
      if (!seen.has(m.id)) {
        seen.add(m.id)
        results.push({ member: m, matchedOn: 'name' })
      }
    }

    return results.slice(0, limit)
  }
}

/**
 * Motor externo — plantilla lista para conectar.
 *
 * El patrón es siempre el mismo: una Cloud Function con trigger en `members`
 * empuja el documento al índice, y aquí se consulta el índice en vez de
 * Firestore. El filtro por `gymId` es OBLIGATORIO también aquí: un buscador
 * mal filtrado es una fuga de datos entre gimnasios.
 *
 * ```ts
 * class TypesenseSearch implements SearchProvider {
 *   readonly capabilities = {
 *     engine: 'Typesense',
 *     fullText: true,
 *     typoTolerant: true,
 *     searchableFields: ['name', 'memberNumber', 'phone', 'email'],
 *   }
 *
 *   async searchMembers(repo, term, limit = 30) {
 *     const res = await this.client.collections('members').documents().search({
 *       q: term,
 *       query_by: 'name,phone,email,memberNumber',
 *       filter_by: `gymId:=${repo.gymId}`,   // ← el aislamiento, también aquí
 *       per_page: limit,
 *     })
 *     return res.hits.map((h) => ({ member: h.document, matchedOn: 'name' }))
 *   }
 * }
 * ```
 */

/**
 * Motor activo.
 *
 * Cambiar de buscador es cambiar esta línea:
 *   export const searchProvider: SearchProvider = new TypesenseSearch(client)
 */
export const searchProvider: SearchProvider = new FirestorePrefixSearch()

/** Atajo que usan las pantallas. */
export function searchMembers(repo: TenantRepo, term: string, limit?: number) {
  return searchProvider.searchMembers(repo, term, limit)
}

/** Texto que explica al usuario qué encuentra el buscador actual. */
export function searchHint(): string {
  const c = searchProvider.capabilities
  if (c.fullText) return 'Busca por nombre, teléfono, correo o número de socio.'
  return 'La búsqueda encuentra por el principio del nombre o por número de socio.'
}
