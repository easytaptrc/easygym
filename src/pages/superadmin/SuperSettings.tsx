import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { BRAND, PARENT_BRAND } from '@/config/brand'
import { isMockDriver } from '@/services/db'
import { hasServerProvisioning, FUNCTIONS_URL } from '@/services/provisioning'
import { searchProvider, searchHint } from '@/services/search'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'

// ═══════════════════════════════════════════════════════════════════════════
// Configuración de plataforma.
//
// Esta pantalla NO inventa un estado bonito: lee el entorno real y dice qué
// está conectado y qué no. Un panel que afirma «Stripe: activo» cuando no hay
// clave configurada es peor que no tener panel, porque desplaza el momento de
// descubrir el problema hasta el primer cobro fallido.
//
// Lo que aparece aquí sale de variables públicas (`VITE_*`) y de qué driver se
// cargó. Ningún secreto llega al navegador, así que ninguno puede mostrarse:
// lo único que se sabe es si la pieza del servidor está configurada, no cuál
// es su clave.
// ═══════════════════════════════════════════════════════════════════════════

type State = 'ok' | 'pending' | 'off' | 'warn'

const STATE_UI: Record<State, { icon: ReactNode; className: string; label: string }> = {
  ok: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    className: 'text-tap-400',
    label: 'Conectado',
  },
  pending: {
    icon: <CircleDashed className="h-4 w-4" />,
    className: 'text-cyber-300',
    label: 'Simulado',
  },
  warn: {
    icon: <AlertTriangle className="h-4 w-4" />,
    className: 'text-warn-400',
    label: 'Revisar',
  },
  off: {
    icon: <XCircle className="h-4 w-4" />,
    className: 'text-ink-500',
    label: 'Sin configurar',
  },
}

const env = import.meta.env

function envFlag(key: string): boolean {
  const value = (env as unknown as Record<string, string | undefined>)[key]
  return typeof value === 'string' && value.trim() !== ''
}

export default function SuperSettings() {
  const firebaseReady = envFlag('VITE_FIREBASE_PROJECT_ID') && envFlag('VITE_FIREBASE_API_KEY')
  const stripeSaas = envFlag('VITE_STRIPE_PUBLISHABLE_KEY')

  const rows: Array<{
    title: string
    state: State
    detail: string
    note?: string
  }> = [
    {
      title: 'Base de datos',
      state: isMockDriver ? 'pending' : 'ok',
      detail: isMockDriver
        ? 'Driver de demostración (navegador). Los datos viven en este equipo y no se comparten.'
        : `Firestore · proyecto ${env.VITE_FIREBASE_PROJECT_ID}`,
      note: isMockDriver
        ? 'Para conectar Firestore: VITE_DATA_DRIVER=firebase y las variables VITE_FIREBASE_*.'
        : 'El aislamiento entre gimnasios lo hace cumplir firestore.rules, no el navegador.',
    },
    {
      title: 'Configuración de Firebase',
      state: firebaseReady ? 'ok' : 'off',
      detail: firebaseReady
        ? `authDomain ${env.VITE_FIREBASE_AUTH_DOMAIN}`
        : 'Faltan VITE_FIREBASE_API_KEY y VITE_FIREBASE_PROJECT_ID.',
      note: 'Estas claves son públicas por diseño: identifican el proyecto, no autorizan nada. Lo que autoriza son las reglas y los custom claims.',
    },
    {
      title: 'Cloud Functions',
      state: hasServerProvisioning ? 'ok' : 'pending',
      detail: hasServerProvisioning
        ? FUNCTIONS_URL
        : 'Sin VITE_FUNCTIONS_URL: el alta de gimnasios corre en el navegador.',
      note: 'En producción el alta, los webhooks de Stripe, los contadores y la bitácora los escribe el servidor. Mientras no lo estén, el cliente hace ese trabajo y por eso las reglas siguen permitiéndoselo.',
    },
    {
      title: 'Stripe — suscripciones SaaS',
      state: stripeSaas ? 'ok' : 'pending',
      detail: stripeSaas
        ? 'Clave publicable presente. El cobro del gimnasio a EasyGym pasa por el servidor.'
        : 'Sin clave publicable: el checkout está simulado.',
      note: 'La clave secreta NUNCA llega aquí. Vive en Cloud Functions y es lo único que decide el importe: el navegador no puede proponer cuánto se cobra.',
    },
    {
      title: 'Stripe — cobros del gimnasio',
      state: stripeSaas ? 'ok' : 'pending',
      detail: 'Sistema independiente (Connect): el socio paga a SU gimnasio, no a EasyGym.',
      note: 'Son dos integraciones separadas a propósito. Mezclarlas haría que el dinero de los socios pasara por la cuenta de la plataforma, con las obligaciones que eso implica.',
    },
    {
      title: 'Búsqueda',
      state: searchProvider.capabilities.fullText ? 'ok' : 'warn',
      detail: `${searchProvider.capabilities.engine} — ${searchHint()}`,
      note: 'Firestore no hace búsqueda de texto. Para buscar por cualquier parte del nombre y tolerar erratas hace falta Typesense o Algolia: el punto de cambio es `searchProvider` en services/search.ts.',
    },
    {
      title: 'App Check',
      state: 'off',
      detail: 'No activado.',
      note: 'Impide que alguien use tus credenciales de Firebase desde fuera de tu aplicación. No sustituye a las reglas: las complementa.',
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Plataforma"
        title="Configuración"
        description="Qué piezas están conectadas de verdad en este entorno. Lo que aparece aquí se lee del entorno; nada está simulado para que se vea bien."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((row) => {
          const ui = STATE_UI[row.state]
          return (
            <Card key={row.title} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[14.5px] font-semibold text-ink-50">{row.title}</h3>
                <span className={cx('flex shrink-0 items-center gap-1.5 text-[12px] font-semibold', ui.className)}>
                  {ui.icon}
                  {ui.label}
                </span>
              </div>
              <p className="mt-2 break-words font-mono text-[12px] leading-relaxed text-ink-300">{row.detail}</p>
              {row.note && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">{row.note}</p>}
            </Card>
          )
        })}
      </div>

      <Card className="mt-5 p-5">
        <h3 className="text-[14.5px] font-semibold text-ink-50">Identidad</h3>
        <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <Row label="Producto">{BRAND.name}</Row>
          <Row label="Empresa matriz">{PARENT_BRAND.name}</Row>
          <Row label="Dominio">{BRAND.domain}</Row>
          <Row label="Soporte">{BRAND.supportEmail}</Row>
        </dl>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
          El producto de gestión de gimnasios se llama {BRAND.name}. {PARENT_BRAND.name} es la marca matriz y solo
          aparece como tal: en el pie de la página pública y en los documentos legales.
        </p>
      </Card>

      <Card className="mt-4 p-5">
        <h3 className="flex items-center gap-2 text-[14.5px] font-semibold text-ink-50">
          <AlertTriangle className="h-4 w-4 text-warn-400" />
          Sobre «proteger el código del navegador»
        </h3>
        <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-ink-400">
          Todo el JavaScript que se ejecuta en el navegador de un cliente es visible para ese cliente. La
          minificación lo hace incómodo de leer, no secreto, y bloquear el clic derecho o F12 no impide nada a nadie
          que quiera mirar. Cualquiera puede abrir las herramientas del navegador, leer el código y llamar a la base
          de datos a mano.
        </p>
        <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-ink-400">
          Por eso la seguridad de {BRAND.name} no depende de esconder nada: depende de que el servidor rechace lo que
          no corresponde. Las reglas de Firestore, los custom claims y las Cloud Functions son las que deciden, y
          siguen decidiendo igual aunque alguien tenga el código delante.
        </p>
        <a
          href="https://firebase.google.com/docs/rules"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-plasma-300 hover:text-plasma-200"
        >
          Documentación de reglas de seguridad
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Card>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[.05] py-1.5">
      <dt className="text-[12.5px] text-ink-400">{label}</dt>
      <dd className="text-[13px] font-medium text-ink-100">{children}</dd>
    </div>
  )
}
