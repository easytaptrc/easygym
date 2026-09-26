import { useEffect, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { alHaberVersionNueva } from '@/services/appUpdate'
import { Button } from '@/components/ui/Button'

/**
 * Aviso de versión nueva.
 *
 * Aparece cuando el service worker ya descargó una versión y está esperando.
 * NO se cierra solo y NO recarga solo: puede haber un cobro a medio capturar o
 * una venta abierta en el punto de venta. Quien decide cuándo es buen momento
 * es la persona que está trabajando, no el despliegue.
 *
 * Mientras tanto la aplicación sigue funcionando con su versión, completa y
 * coherente. No hay prisa.
 */
export function UpdateBanner() {
  const [aplicar, setAplicar] = useState<(() => void) | null>(null)
  const [actualizando, setActualizando] = useState(false)

  useEffect(
    () =>
      alHaberVersionNueva((fn) => {
        // `setState` con una función la EJECUTA en vez de guardarla; de ahí el
        // envoltorio. Sin él, la actualización se aplicaría sola al renderizar,
        // que es justo lo que este aviso existe para evitar.
        setAplicar(() => fn)
      }),
    [],
  )

  if (!aplicar) return null

  return (
    <div
      role="status"
      className="no-print fixed inset-x-0 bottom-0 z-[110] flex justify-center p-4 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:p-0"
    >
      <div className="flex w-full max-w-md animate-slide-in-right items-center gap-3 rounded-xl border border-tap-500/30 bg-ink-900/90 px-4 py-3 shadow-pop backdrop-blur-xl">
        <Sparkles className="h-[18px] w-[18px] shrink-0 text-tap-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-white">Hay una versión nueva</p>
          <p className="mt-0.5 text-[12px] text-ink-400">
            Se aplicará al recargar. Termina lo que estés haciendo y actualiza cuando quieras.
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          loading={actualizando}
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={() => {
            setActualizando(true)
            aplicar()
          }}
        >
          Actualizar
        </Button>
      </div>
    </div>
  )
}
