import { useCallback, useEffect, useState } from 'react'
import { CloudOff, RefreshCw, Wifi } from 'lucide-react'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { uploadQueued } from '@/services/biometricEvents'
import {
  flush,
  isOnline,
  pendingCount,
  retryStuck,
  stuck,
  subscribe,
  watchConnection,
} from '@/services/syncQueue'
import { cx } from '@/lib/utils'

// ═══════════════════════════════════════════════════════════════════════════
// Estado de la conexión y de la cola.
//
// Va en la recepción, que es donde importa: si se cae Internet a las 7 de la
// mañana con quince personas esperando, quien está en el mostrador necesita
// saber DOS cosas de un vistazo —que puede seguir trabajando, y que nada se
// está perdiendo—.
//
// Lo que NO hace: bloquear. Un aviso que impide seguir operando es peor que no
// tener aviso.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Franja completa, pero SOLO cuando hay algo que decir.
 *
 * Con conexión y sin nada pendiente no se pinta: un aviso permanente de «todo
 * bien» deja de leerse a la semana, y entonces tampoco se lee el que importa.
 */
export function OfflineBanner() {
  const { gym } = useSession()
  const [online, setOnline] = useState(() => isOnline())
  const [pending, setPending] = useState(0)

  useEffect(() => {
    const refresh = () => setPending(pendingCount(gym?.id))
    refresh()
    const offQueue = subscribe(refresh)
    const offNet = watchConnection(setOnline)
    return () => {
      offQueue()
      offNet()
    }
  }, [gym?.id])

  if (online && pending === 0) return null
  return (
    <div className="mb-4">
      <ConnectionStatus />
    </div>
  )
}

export function ConnectionStatus({ compact = false }: { compact?: boolean }) {
  const { repo, gym, settings } = useSession()
  const toast = useToast()

  const [online, setOnline] = useState(() => isOnline())
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const refresh = useCallback(() => {
    setPending(pendingCount(gym?.id))
    setFailed(stuck(gym?.id).length)
  }, [gym?.id])

  useEffect(() => {
    refresh()
    const offQueue = subscribe(refresh)
    const offNet = watchConnection(setOnline)
    return () => {
      offQueue()
      offNet()
    }
  }, [refresh])

  const sync = useCallback(async () => {
    if (!repo || syncing) return
    setSyncing(true)
    try {
      const result = await flush((item) => uploadQueued(repo, item, settings), gym?.id)
      if (result.attempted === 0) {
        toast.info('Todo está sincronizado', 'No había eventos pendientes.')
      } else if (result.failed === 0) {
        toast.success(
          'Sincronización completada',
          result.duplicates > 0
            ? `${result.synced} subidos · ${result.duplicates} ya estaban (duplicados ignorados)`
            : `${result.synced} ${result.synced === 1 ? 'evento subido' : 'eventos subidos'}`,
        )
      } else {
        toast.warning(
          'Sincronización incompleta',
          `${result.failed} ${result.failed === 1 ? 'evento pendiente' : 'eventos pendientes'}. Puedes reintentar.`,
        )
      }
    } finally {
      setSyncing(false)
      refresh()
    }
  }, [repo, gym?.id, settings, syncing, toast, refresh])

  // Al recuperar la conexión, se sube solo lo que quedó en la cola. Nadie
  // tiene que acordarse de pulsar nada.
  useEffect(() => {
    if (online && pending > 0 && !syncing) void sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  const tone = !online
    ? 'border-warn-500/30 bg-warn-500/10 text-warn-200'
    : failed > 0
      ? 'border-danger-500/30 bg-danger-500/10 text-danger-200'
      : pending > 0
        ? 'border-cyber-400/30 bg-cyber-400/10 text-cyber-200'
        : 'border-tap-500/25 bg-tap-500/[.08] text-tap-300'

  const label = !online
    ? 'Sin internet'
    : syncing
      ? 'Sincronizando…'
      : failed > 0
        ? `${failed} sin sincronizar`
        : pending > 0
          ? `${pending} pendientes`
          : 'En línea'

  if (compact) {
    return (
      <span
        className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold', tone)}
        title={online ? 'Conectado a EasyGym' : 'Modo sin conexión activo'}
      >
        {online ? <Wifi className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
        <span className="hidden sm:inline">{label}</span>
      </span>
    )
  }

  return (
    <div className={cx('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5', tone)}>
      {online ? <Wifi className="h-4 w-4 shrink-0" /> : <CloudOff className="h-4 w-4 shrink-0" />}

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{label}</p>
        <p className="text-[11.5px] opacity-80">
          {!online
            ? 'Modo sin conexión activo. Sigue trabajando: los registros se guardan aquí y se suben solos al volver.'
            : failed > 0
              ? 'Algunos eventos no se pudieron subir. Reintenta o revisa la conexión.'
              : pending > 0
                ? 'Subiendo lo que quedó guardado…'
                : 'Todo está sincronizado.'}
        </p>
      </div>

      {(pending > 0 || failed > 0) && online && (
        <button
          onClick={() => {
            if (failed > 0) retryStuck(gym?.id)
            void sync()
          }}
          disabled={syncing}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-semibold transition hover:bg-white/20 disabled:opacity-50"
        >
          <RefreshCw className={cx('h-3.5 w-3.5', syncing && 'animate-spin')} />
          {failed > 0 ? 'Reintentar' : 'Sincronizar'}
        </button>
      )}
    </div>
  )
}
