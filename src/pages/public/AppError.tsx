import { useEffect, useState } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { Home, RefreshCw } from 'lucide-react'
import { Backdrop } from '@/components/ui/Backdrop'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'
import { esErrorDeVersion, huboFalloDeVersion, recuperarDeVersionVieja } from '@/services/appUpdate'

/**
 * La última red: si algo revienta dentro de una ruta, aquí se ve.
 *
 * Antes no existía, y por eso el usuario veía el texto crudo de React Router
 * —«Unexpected Application Error!»— sobre una pantalla negra. Ese texto no dice
 * qué pasó, no dice qué hacer, y está en inglés.
 *
 * Se distinguen dos casos porque tienen arreglos distintos:
 *
 *   · Falta un trozo de la aplicación (versión desfasada) → se recarga solo.
 *   · Cualquier otro fallo → se explica y se ofrece salida, sin recargar en
 *     bucle sobre un error que la recarga no va a arreglar.
 */
export default function AppError() {
  const error = useRouteError()
  const [seRecupera, setSeRecupera] = useState(false)

  // Dos caminos para reconocerlo: el mensaje, y la marca que dejó la red de
  // seguridad. Hace falta el segundo porque un import diferido a medio cargar
  // llega aquí con un mensaje que no menciona el chunk por ningún lado.
  const esVersion = esErrorDeVersion(error) || huboFalloDeVersion()

  useEffect(() => {
    if (!esVersion) return
    // Una sola vez: `recuperarDeVersionVieja` lleva la cuenta en sessionStorage
    // y devuelve false si ya se intentó. Sin esa cuenta, un chunk que de verdad
    // no existe dejaría la pantalla recargándose para siempre.
    setSeRecupera(recuperarDeVersionVieja('errorElement'))
  }, [esVersion])

  const detalle = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : null

  return (
    <div className="relative grid min-h-screen place-items-center px-4">
      <Backdrop variant="auth" />
      <div className="w-full max-w-md rounded-2xl border border-white/[.08] bg-ink-900/70 p-8 text-center shadow-card backdrop-blur-xl">
        <div className="flex justify-center">
          <Logo size="sm" />
        </div>

        {esVersion ? (
          <>
            <h1 className="mt-6 text-[20px] font-bold tracking-tight text-white">
              {seRecupera ? 'Actualizando EasyGym…' : 'No se pudo cargar esta pantalla'}
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-400">
              {seRecupera
                ? 'Se publicó una versión nueva mientras tenías la página abierta. Se está recargando sola; no hace falta que hagas nada.'
                : 'Falta un archivo de la aplicación y recargar no lo resolvió. Revisa tu conexión y vuelve a intentarlo.'}
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-[20px] font-bold tracking-tight text-white">
              Algo salió mal
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-400">
              La pantalla no se pudo mostrar. Tus datos no se perdieron: vuelve a intentarlo o
              regresa al inicio.
            </p>
          </>
        )}

        {detalle && !esVersion && (
          <p className="mt-4 break-words rounded-xl border border-white/[.06] bg-ink-950/50 px-3.5 py-2.5 text-left font-mono text-[11.5px] text-ink-500">
            {detalle}
          </p>
        )}

        {!seRecupera && (
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              variant="primary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => window.location.reload()}
            >
              Reintentar
            </Button>
            <Button
              variant="ghost"
              icon={<Home className="h-4 w-4" />}
              // Recarga completa a propósito: si el router está en mal estado,
              // navegar por dentro lo arrastra.
              onClick={() => window.location.assign(import.meta.env.BASE_URL)}
            >
              Ir al inicio
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
