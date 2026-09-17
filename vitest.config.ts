import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Dos suites con necesidades distintas:
//
//   tests/features/  lógica pura (planes, límites, entitlements).
//                    Corre siempre, sin infraestructura.
//
//   tests/rules/     reglas de Firestore contra el emulador.
//                    Necesita Java y `firebase emulators:exec`.
//
// Por eso `npm test` ejecuta solo la primera: un `npm test` que falla en una
// máquina sin Java deja de ser útil como señal.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'functions/**'],
    testTimeout: 15_000,

    // UN FICHERO A LA VEZ. No es una preferencia de estilo: es obligatorio.
    //
    // Las pruebas de reglas comparten UN emulador, y cada una empieza con
    // `clearFirestore()`, que borra el proyecto ENTERO. Con los ficheros en
    // paralelo, el `clearFirestore()` de uno vacía los datos que el otro acaba
    // de sembrar, y los fallos salen donde no está el error: documentos que
    // "no existen", `Null value error` al leer el gimnasio, y pruebas que pasan
    // o fallan según quién llegue antes.
    //
    // Así se perdieron las primeras horas de depuración de esta suite.
    fileParallelism: false,
  },
})
