import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'

// ═══════════════════════════════════════════════════════════════════════════
// Inicialización de Firebase — carga diferida.
//
// Los `import type` se borran al compilar, así que este módulo NO arrastra el
// SDK al bundle inicial. El SDK real se carga con `initFirebase()`, que solo
// se llama cuando VITE_DATA_DRIVER=firebase.
//
// Los valores de `firebaseConfig` NO son secretos: identifican al proyecto y
// viajan al navegador por diseño. Lo que protege los datos son las reglas de
// firestore.rules y las restricciones de la API key en Google Cloud Console.
//
// La clave SECRETA de Stripe nunca aparece aquí ni en ninguna variable VITE_.
// ═══════════════════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)
}

let app: FirebaseApp | null = null
let firestore: Firestore | null = null
let auth: Auth | null = null
let ready: Promise<void> | null = null

/** Carga el SDK e inicializa app, Firestore y Auth. Idempotente. */
export function initFirebase(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    if (!isFirebaseConfigured()) {
      throw new Error(
        '[EasyGym] Firebase no está configurado. Copia .env.example a .env.local y rellena VITE_FIREBASE_*.',
      )
    }
    const [{ initializeApp }, { getAuth }, { getFirestore }] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ])
    app = initializeApp(firebaseConfig)
    firestore = getFirestore(app)
    auth = getAuth(app)
  })()
  return ready
}

function assertReady<T>(value: T | null, what: string): T {
  if (!value) {
    throw new Error(`[EasyGym] ${what} no está inicializado. Llama a initFirebase() primero.`)
  }
  return value
}

export function getFirebaseApp(): FirebaseApp {
  return assertReady(app, 'Firebase')
}

export function getDb(): Firestore {
  return assertReady(firestore, 'Firestore')
}

export function getFirebaseAuth(): Auth {
  return assertReady(auth, 'Firebase Auth')
}
