import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes'
import { SessionProvider } from './state/SessionContext'
import { PlansProvider } from './state/PlansContext'
import { ToastProvider } from './hooks/useToast'
import { UpdateBanner } from './components/UpdateBanner'
import { iniciarControlDeVersiones } from './services/appUpdate'
import './index.css'

// Quita el splash del index.html en cuanto React toma el control.
document.getElementById('boot')?.remove()

const root = document.getElementById('root')
if (!root) throw new Error('No se encontró #root')

// Antes de renderizar: la red de seguridad contra chunks de una versión vieja
// tiene que estar escuchando antes de que el router pida la primera pantalla.
iniciarControlDeVersiones()

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
      {/* Fuera del router: un aviso de versión nueva no pertenece a ninguna
          pantalla, y tiene que sobrevivir a que el router falle. */}
      <UpdateBanner />
    </ToastProvider>
  </StrictMode>,
)
