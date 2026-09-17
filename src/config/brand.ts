/**
 * Identidad de la plataforma.
 *
 * El PRODUCTO se llama EasyGym. EasyTap es la marca matriz: la empresa que lo
 * desarrolla. Por eso aparece únicamente en el pie de página, en los
 * documentos impresos y en los textos legales — nunca como nombre del software
 * de gimnasios.
 *
 * Todo el producto lee estos valores de aquí. Cambiar el nombre visible es
 * tocar ESTE archivo y nada más.
 */
export const BRAND = {
  /** Se pinta en blanco. */
  namePrefix: 'Easy',
  /** Se pinta en verde. */
  nameSuffix: 'GYM',
  /** "EasyGym" — el nombre del producto tal como se escribe en prosa. */
  name: 'EasyGym',
  domain: 'easygym.com',
  tagline: 'Más que software, tu aliado en el crecimiento',
  subtitle: 'El sistema completo para tu gimnasio',
  claim: 'Administra · Controla · Haz crecer tu negocio',
  supportEmail: 'hola@easygym.com',
  /** Verde del logotipo, como tripleta RGB. */
  accentRgb: '34 224 107',
  accentHex: '#22E06B',
} as const

/**
 * Marca matriz. Solo se muestra donde tiene sentido decir quién hace EasyGym:
 * pie de la landing, recibos impresos y contratos.
 */
export const PARENT_BRAND = {
  name: 'EasyTap',
  legalName: 'EasyTap Technologies S.A. de C.V.',
  domain: 'easytap.com',
  /** "EasyGym es un producto de EasyTap" */
  byline: 'un producto de EasyTap',
} as const

/**
 * Prefijo de las claves en localStorage y de los identificadores del producto.
 * Se mantiene estable aunque cambie el nombre comercial: renombrarlo invalida
 * los datos guardados de todos los navegadores que ya usan la aplicación.
 */
export const STORAGE_PREFIX = 'easygym'

/** Paletas sugeridas para que cada gimnasio elija su color. */
export const GYM_ACCENT_PRESETS = [
  { name: 'Verde EasyGym', accent: '34 224 107', soft: '143 255 193', deep: '11 166 72' },
  { name: 'Cian', accent: '56 217 255', soft: '125 233 255', deep: '3 153 196' },
  { name: 'Violeta', accent: '169 112 255', soft: '205 169 255', deep: '112 40 216' },
  { name: 'Ámbar', accent: '255 190 61', soft: '255 217 138', deep: '199 127 0' },
  { name: 'Rojo', accent: '255 107 107', soft: '255 169 169', deep: '212 32 32' },
  { name: 'Rosa', accent: '255 105 180', soft: '255 173 214', deep: '214 40 132' },
  { name: 'Azul', accent: '96 145 255', soft: '160 190 255', deep: '40 90 220' },
  { name: 'Lima', accent: '190 242 60', soft: '218 249 145', deep: '140 190 20' },
] as const
