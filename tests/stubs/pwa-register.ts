// Sustituto de `virtual:pwa-register`, que solo existe cuando compila
// vite-plugin-pwa. Las pruebas no registran ningún service worker: lo que se
// comprueba es la lógica de versiones que lo rodea.
export function registerSW(): (recargar?: boolean) => Promise<void> {
  return async () => {}
}
