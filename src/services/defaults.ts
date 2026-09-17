import type { DayHours, GymSettings, OnboardingState, Weekday } from '@/types'

// Configuración inicial de un gimnasio recién creado.
// NADA de esto está escrito a fuego en la aplicación: todo se edita después
// desde /configuracion. Esto es solo el punto de partida.

const weekday = (open = '06:00', close = '22:00'): DayHours => ({ open, close, closed: false })

export function defaultHours(): Record<Weekday, DayHours> {
  return {
    1: weekday(),
    2: weekday(),
    3: weekday(),
    4: weekday(),
    5: weekday(),
    6: weekday('08:00', '16:00'),
    0: { open: '09:00', close: '14:00', closed: true },
  }
}

export function defaultSettings(gymId: string): GymSettings {
  return {
    id: gymId,
    gymId,
    hours: defaultHours(),
    nearExpirationDays: 7,
    cancellationWindowMin: 120,
    reservationOpensHoursBefore: 72,
    // Suficiente para apartar una clase al día durante casi una semana sin
    // que nadie bloquee el cupo de todo el mes.
    maxActiveReservationsPerMember: 6,
    spinning: { rows: 4, cols: 5, instructorAt: 'top', aisles: [] },
    access: {
      visitGrantsAccess: true,
      allowExpiredEntry: false,
      graceDays: 0,
      methods: ['fingerprint', 'qr', 'reception', 'manual'],
    },
    visits: { defaultPrice: 100, memberGuestPrice: 80 },
    payments: {
      methods: ['cash', 'card', 'transfer'],
      taxRate: 0,
      receiptFooter: '¡Gracias por entrenar con nosotros!',
    },
    notifications: {
      channels: ['inapp', 'email'],
      nearExpirationDaysBefore: 5,
      classReminderHoursBefore: 2,
    },
    printing: { receiptWidth: '80mm', printLogo: true },
    updatedAt: Date.now(),
  }
}

export function defaultOnboarding(): OnboardingState {
  return {
    dismissed: false,
    steps: {
      gymInfo: false,
      firstMembership: false,
      firstMember: false,
      classes: false,
      spinning: false,
      staff: false,
      payments: false,
    },
  }
}

export const ONBOARDING_STEPS: Array<{
  id: keyof OnboardingState['steps']
  title: string
  detail: string
  to: string
  cta: string
}> = [
  {
    id: 'gymInfo',
    title: 'Configura tu gimnasio',
    detail: 'Nombre, dirección, horarios y el color de tu marca.',
    to: '/configuracion',
    cta: 'Configurar',
  },
  {
    id: 'firstMembership',
    title: 'Crea tu primera membresía',
    detail: 'Define precio y duración: mensual, trimestral, anual…',
    to: '/membresias',
    cta: 'Crear membresía',
  },
  {
    id: 'firstMember',
    title: 'Agrega socios',
    detail: 'Da de alta a tu primer socio y asígnale su membresía.',
    to: '/socios',
    cta: 'Agregar socio',
  },
  {
    id: 'classes',
    title: 'Configura tus clases',
    detail: 'Spinning, box, yoga… con instructor, horario y cupo.',
    to: '/clases',
    cta: 'Crear clase',
  },
  {
    id: 'spinning',
    title: 'Arma el salón de spinning',
    detail: 'Define filas, columnas y numera tus bicicletas.',
    to: '/spinning',
    cta: 'Configurar salón',
  },
  {
    id: 'staff',
    title: 'Agrega a tu equipo',
    detail: 'Recepción, entrenadores y administradores.',
    to: '/usuarios',
    cta: 'Agregar usuario',
  },
  {
    id: 'payments',
    title: 'Configura tus cobros',
    detail: 'Métodos de pago, precio de visita y pie del recibo.',
    to: '/configuracion',
    cta: 'Configurar cobros',
  },
]

/** Membresías sugeridas al crear un gimnasio. El dueño las puede borrar. */
export const STARTER_MEMBERSHIP_TEMPLATES = [
  { name: 'Visita', price: 100, duration: 'DAILY' as const, days: 1, benefits: ['Acceso por un día'] },
  {
    name: 'Mensual',
    price: 500,
    duration: 'MONTHLY' as const,
    days: 30,
    benefits: ['Acceso ilimitado', 'Área de pesas', 'Cardio'],
  },
  {
    name: 'Trimestral',
    price: 1350,
    duration: 'QUARTERLY' as const,
    days: 90,
    benefits: ['Acceso ilimitado', 'Clases grupales', '10% de descuento'],
  },
  {
    name: 'Semestral',
    price: 2400,
    duration: 'BIANNUAL' as const,
    days: 180,
    benefits: ['Acceso ilimitado', 'Clases grupales', 'Evaluación física'],
  },
  {
    name: 'Anual',
    price: 4200,
    duration: 'ANNUAL' as const,
    days: 365,
    benefits: ['Acceso ilimitado', 'Todas las clases', 'Plan nutricional', '30% de descuento'],
  },
]

/** Horarios de ejemplo — el dueño los cambia desde /clases y /configuracion. */
export const SAMPLE_CLASS_SCHEDULES = {
  spinning: { days: [1, 2, 3, 4] as Weekday[], times: ['07:00', '08:00', '19:00', '20:00'] },
  spinningFriday: { days: [5] as Weekday[], times: ['07:00', '08:00'] },
  box: { days: [1, 2, 3, 4, 5] as Weekday[], times: ['17:00', '18:00', '19:00', '20:00', '21:00'] },
}
