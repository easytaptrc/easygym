import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { router } from './routes'
import { SessionProvider } from './state/SessionContext'
import { PlansProvider } from './state/PlansContext'
import { ToastProvider } from './hooks/useToast'
import './index.css'

// Quita el splash del index.html en cuanto React toma el control.
document.getElementById('boot')?.remove()

const root = document.getElementById('root')
if (!root) throw new Error('No se encontró #root')

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      {/* El catálogo de planes va por fuera de la sesión: la landing y la
          página de precios lo necesitan sin haber iniciado sesión. */}
      <PlansProvider>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </PlansProvider>
    </ToastProvider>
  </StrictMode>,
)

// Service worker: una sola PWA "EasyGym" para todos los gimnasios.
if (import.meta.env.PROD) {
  registerSW({ immediate: true })
}
