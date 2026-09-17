import type { SyncQueueItem, SyncStatus } from '@/types'
import { STORAGE_PREFIX } from '@/config/brand'
import { newId } from '@/lib/utils'

// ═══════════════════════════════════════════════════════════════════════════
// MODO SIN CONEXIÓN Y COLA DE SINCRONIZACIÓN.
//
// EL PROBLEMA REAL
//
// Se cae Internet a las 7 de la mañana, con quince personas esperando para
// entrar. Si EasyGym deja de funcionar, el gimnasio deja de funcionar: nadie
// entra, nadie ficha, nadie cobra. Un sistema de operación diaria que exige
// conexión permanente no es un sistema de operación diaria.
//
// CÓMO SE RESUELVE
//
//   Con Internet:     evento → base local → Firestore
//   Sin Internet:     evento → base local → COLA (PENDING)
//   Al volver:        COLA → sincronizar → Firestore
//
// LA IDEMPOTENCIA NO ES UN DETALLE
//
// Reintentar es normal: se cae a media subida, el navegador se cierra, el
// recepcionista recarga. Sin una clave estable, cada reintento crea un
// registro nuevo y un empleado acaba fichando tres veces a la misma hora.
//
// Por eso todo evento lleva `eventId` generado en el ORIGEN, y encolar el
// mismo `eventId` dos veces no crea dos entradas: devuelve la que ya estaba.
//
// ▸ PRODUCCIÓN: esta cola vive en localStorage porque el prototipo corre en el
//   navegador. En el Agente de Windows será SQLite, sobrevivirá al reinicio
//   del equipo y no dependerá de que la pestaña siga abierta. La INTERFAZ de
//   este archivo es la que el Agente implementará.
// ═══════════════════════════════════════════════════════════════════════════

const KEY = `${STORAGE_PREFIX}:syncqueue:v1`

/** Reintentos antes de rendirse y pedir intervención humana. */
export const MAX_RETRIES = 5

function read(): SyncQueueItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SyncQueueItem[]) : []
  } catch {
    // Un almacenamiento ilegible no puede tumbar la recepción: se empieza de
    // cero y se sigue operando. Lo que se pierde son eventos ya perdidos.
    return []
  }
}

function write(items: SyncQueueItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch (err) {
    console.error('[EasyGym] No se pudo guardar la cola de sincronización:', err)
  }
}

// ──────────────────────────────── Encolar ───────────────────────────────────

export interface EnqueueInput {
  gymId: string
  /** Identificador estable del evento. Si falta, se genera uno. */
  eventId?: string
  type: SyncQueueItem['type']
  payload: Record<string, unknown>
}

/**
 * Mete un evento en la cola.
 *
 * IDEMPOTENTE: el mismo `eventId` dos veces devuelve el elemento existente y
 * no añade nada. Es la garantía que pide el enunciado: `EVENT-123` enviado dos
 * veces termina en UN evento, no en dos.
 */
export function enqueue(input: EnqueueInput): SyncQueueItem {
  const eventId = input.eventId ?? newId('evt')
  const items = read()

  const existing = items.find((i) => i.eventId === eventId && i.gymId === input.gymId)
  if (existing) return existing

  const item: SyncQueueItem = {
    queueId: newId('q'),
    gymId: input.gymId,
    eventId,
    type: input.type,
    payload: input.payload,
    status: 'PENDING',
    retryCount: 0,
    createdAt: Date.now(),
    lastAttempt: null,
    syncedAt: null,
    lastError: null,
  }

  items.push(item)
  write(items)
  notify()
  return item
}

// ──────────────────────────────── Consultas ─────────────────────────────────

export function all(gymId?: string): SyncQueueItem[] {
  const items = read()
  return gymId ? items.filter((i) => i.gymId === gymId) : items
}

export function byStatus(status: SyncStatus, gymId?: string): SyncQueueItem[] {
  return all(gymId).filter((i) => i.status === status)
}

/** Lo que falta por subir: pendientes más los que fallaron y pueden reintentarse. */
export function pending(gymId?: string): SyncQueueItem[] {
  return all(gymId).filter(
    (i) => i.status === 'PENDING' || (i.status === 'FAILED' && i.retryCount < MAX_RETRIES),
  )
}

/** Los que agotaron los reintentos. Necesitan que alguien mire qué pasó. */
export function stuck(gymId?: string): SyncQueueItem[] {
  return all(gymId).filter((i) => i.status === 'FAILED' && i.retryCount >= MAX_RETRIES)
}

export function pendingCount(gymId?: string): number {
  return pending(gymId).length
}

// ──────────────────────────────── Sincronizar ───────────────────────────────

export interface SyncResult {
  attempted: number
  synced: number
  failed: number
  /** Eventos que el servidor ya tenía. No son un error: son la prueba de que
   *  la idempotencia funciona. */
  duplicates: number
}

/**
 * Sube un evento. Devuelve `true` si quedó en el servidor.
 *
 * Debe ser idempotente en el destino: subir dos veces el mismo `eventId` no
 * puede crear dos documentos. Quien la implementa usa `eventId` como id del
 * documento, que es lo que hace `biometricEvents`.
 */
export type Uploader = (item: SyncQueueItem) => Promise<'synced' | 'duplicate'>

/**
 * Vacía la cola contra el servidor.
 *
 * Se procesa en orden de llegada: un fichaje de entrada tiene que subir antes
 * que su salida, o el servidor recibe una salida sin entrada.
 */
export async function flush(uploader: Uploader, gymId?: string): Promise<SyncResult> {
  const result: SyncResult = { attempted: 0, synced: 0, failed: 0, duplicates: 0 }
  const queue = pending(gymId).sort((a, b) => a.createdAt - b.createdAt)

  for (const item of queue) {
    result.attempted++
    patch(item.queueId, { status: 'SYNCING', lastAttempt: Date.now() })

    try {
      const outcome = await uploader(item)
      patch(item.queueId, { status: 'SYNCED', syncedAt: Date.now(), lastError: null })
      if (outcome === 'duplicate') result.duplicates++
      else result.synced++
    } catch (err) {
      result.failed++
      patch(item.queueId, {
        status: 'FAILED',
        retryCount: item.retryCount + 1,
        lastError: err instanceof Error ? err.message : String(err),
      })
    }
  }

  notify()
  return result
}

/** Devuelve a la cola lo que se rindió, para volver a intentarlo a mano. */
export function retryStuck(gymId?: string): number {
  const items = read()
  let count = 0
  for (const item of items) {
    if (item.gymId === (gymId ?? item.gymId) && item.status === 'FAILED') {
      item.status = 'PENDING'
      item.retryCount = 0
      item.lastError = null
      count++
    }
  }
  write(items)
  notify()
  return count
}

function patch(queueId: string, changes: Partial<SyncQueueItem>): void {
  const items = read()
  const idx = items.findIndex((i) => i.queueId === queueId)
  if (idx === -1) return
  items[idx] = { ...items[idx], ...changes }
  write(items)
}

/**
 * Limpia lo ya sincronizado.
 *
 * Se conservan 24 horas: si algo salió mal, ese es el margen para verlo antes
 * de que desaparezca. Más tiempo solo llena el almacenamiento del navegador.
 */
export function purgeSynced(olderThanMs = 86_400_000): number {
  // `<=` y no `<`: con margen cero, «lo sincronizado hace más de 0 ms» es
  // todo lo sincronizado. Con `<`, un evento subido en este mismo
  // milisegundo se salvaba de la purga por casualidad.
  const cutoff = Date.now() - olderThanMs
  const items = read()
  const keep = items.filter((i) => !(i.status === 'SYNCED' && (i.syncedAt ?? 0) <= cutoff))
  const removed = items.length - keep.length
  if (removed > 0) {
    write(keep)
    notify()
  }
  return removed
}

/** Vacía la cola entera. Solo para pruebas y para la demostración. */
export function clearQueue(): void {
  write([])
  notify()
}

// ─────────────────────────── Avisos a la interfaz ───────────────────────────

type Listener = () => void
const listeners = new Set<Listener>()

/** La recepción se suscribe para pintar «12 eventos pendientes» en vivo. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  for (const l of listeners) {
    try {
      l()
    } catch (err) {
      console.error('[EasyGym] Error avisando del cambio en la cola:', err)
    }
  }
}

// ──────────────────────────── Estado de la conexión ─────────────────────────

/**
 * ¿Hay Internet?
 *
 * `navigator.onLine` dice si hay INTERFAZ de red, no si se llega a Firestore:
 * con el WiFi del gimnasio conectado pero sin salida, devuelve `true`. Es una
 * señal útil y barata, no una verdad. Por eso la interfaz dice «sin conexión»
 * y no «Firestore caído», y por eso nada se bloquea basándose solo en esto.
 */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

export function watchConnection(onChange: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const up = () => onChange(true)
  const down = () => onChange(false)
  window.addEventListener('online', up)
  window.addEventListener('offline', down)
  return () => {
    window.removeEventListener('online', up)
    window.removeEventListener('offline', down)
  }
}
