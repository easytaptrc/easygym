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

/** Solo los dígitos: "33 1234 5678" y "3312345678" son el mismo teléfono. */
function digits(s: string): string {
  return s.replace(/\D/g, '')
}

class FirestorePrefixSearch implements SearchProvider {
  readonly capabilities: SearchCapabilities = {
    engine: 'Firestore (prefijo)',
    fullText: false,
    typoTolerant: false,
    searchableFields: ['name', 'memberNumber', 'phone', 'email'],
  }

  async searchMembers(repo: TenantRepo, term: string, limit = 30): Promise<MemberSearchResult[]> {
    const raw = term.trim()
    const q = norm(raw)
    if (!q) return []

    const results: MemberSearchResult[] = []
    const seen = new Set<string>()
    const push = (m: Member, matchedOn: MemberSearchResult['matchedOn']) => {
      if (seen.has(m.id)) return
      seen.add(m.id)
      results.push({ member: m, matchedOn })
    }

    const soloDigitos = digits(raw)
    const esNumero = /^\d+$/.test(q)

    // Un término numérico puede ser DOS cosas, y hay que probar las dos: el
    // número de socio (corto, "42") o el teléfono (largo).
    if (esNumero) {
      const byNumber = await repo.list('members', {
        where: [{ field: 'memberNumber', op: '==', value: Number(q) }],
        limit: 5,
      })
      for (const m of byNumber) push(m, 'memberNumber')
    }

    // TELÉFONO. En el mostrador es la vía más rápida: el socio llega sin
    // credencial y lo único que recuerda es su número.
    //
    // Por PREFIJO, para que sirva tecleando a medias, y sobre los dígitos
    // solos: la gente escribe el teléfono con espacios y guiones, y guardarlo
    // de una forma y buscarlo de otra es la manera segura de que «no aparezca
    // nadie» con el dato correcto delante.
    if (soloDigitos.length >= 3) {
      const byPhone = await repo.list('members', {
        where: [
          { field: 'phone', op: '>=', value: soloDigitos },
          { field: 'phone', op: '<=', value: soloDigitos + '\uf8ff' },
        ],
        orderBy: { field: 'phone', dir: 'asc' },
        limit,
      })
      for (const m of byPhone) push(m, 'phone')
    }

    // CORREO, también por prefijo: basta con teclear lo de antes de la arroba.
    if (!esNumero && q.length >= 3) {
      const email = raw.toLowerCase()
      const byEmail = await repo.list('members', {
        where: [
          { field: 'email', op: '>=', value: email },
          { field: 'email', op: '<=', value: email + '\uf8ff' },
        ],
        orderBy: { field: 'email', dir: 'asc' },
        limit,
      })
      for (const m of byEmail) push(m, 'email')
    }

    // NOMBRE por prefijo. Sigue sin encontrar «María Herrera» tecleando
    // «herrera»: eso necesita un índice invertido, no más código aquí.
    if (!esNumero) {
      const byName = await repo.list('members', {
        where: [
          { field: 'searchKey', op: '>=', value: q },
          { field: 'searchKey', op: '<=', value: q + '\uf8ff' },
        ],
        orderBy: { field: 'searchKey', dir: 'asc' },
        limit,
      })
      for (const m of byName) push(m, 'name')
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
  return 'Busca por nombre, teléfono, correo o número de socio. Encuentra por el principio de cada dato.'
}
