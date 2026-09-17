/** @type {import('tailwindcss').Config} */

// Paleta EasyGym: negro profundo + verde neón (del logo) + cian/violeta para
// los planes. El color `gym-*` NO es fijo: se resuelve en runtime desde la
// variable CSS --gym-accent, que cada gimnasio elige en /configuracion.
const gymVar = (v) => `rgb(var(${v}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Superficies — negro EasyGym
        ink: {
          1000: '#000000',
          950: '#05070A',
          900: '#080B11',
          880: '#0B0F16',
          850: '#0F141D',
          800: '#141A25',
          750: '#1A222F',
          700: '#222C3C',
          650: '#2C3849',
          600: '#3A485C',
          500: '#4E5E75',
          400: '#6C7E97',
          300: '#95A4BA',
          200: '#C3CDDC',
          100: '#E6ECF4',
          50: '#F4F7FB',
        },
        // Verde del logo "TAP"
        tap: {
          50: '#E8FFF1',
          100: '#C6FFDE',
          200: '#8FFFC1',
          300: '#4DF89C',
          400: '#22E06B',
          500: '#12C95B',
          600: '#0BA648',
          700: '#0A8039',
          800: '#0B622F',
          900: '#0A4A26',
        },
        // Plan PRO — cian
        cyber: {
          300: '#7DE9FF',
          400: '#38D9FF',
          500: '#0EC0F0',
          600: '#0399C4',
        },
        // Plan BUSINESS — violeta
        plasma: {
          300: '#CDA9FF',
          400: '#A970FF',
          500: '#8B44F7',
          600: '#7028D8',
        },
        danger: {
          300: '#FFA9A9',
          400: '#FF6B6B',
          500: '#F43F3F',
          600: '#D42020',
        },
        warn: {
          300: '#FFD98A',
          400: '#FFBE3D',
          500: '#F5A300',
          600: '#C77F00',
        },
        // Color propio de cada gimnasio (branding del tenant)
        gym: {
          DEFAULT: gymVar('--gym-accent'),
          soft: gymVar('--gym-accent-soft'),
          deep: gymVar('--gym-accent-deep'),
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,.04) inset, 0 12px 40px -18px rgba(0,0,0,.9)',
        pop: '0 32px 90px -28px rgba(0,0,0,.95)',
        'glow-tap': '0 0 0 1px rgba(34,224,107,.35), 0 0 42px -8px rgba(34,224,107,.55)',
        'glow-cyber': '0 0 0 1px rgba(56,217,255,.35), 0 0 42px -8px rgba(56,217,255,.55)',
        'glow-plasma': '0 0 0 1px rgba(169,112,255,.35), 0 0 42px -8px rgba(169,112,255,.55)',
        'glow-gym': '0 0 0 1px rgb(var(--gym-accent) / .35), 0 0 42px -8px rgb(var(--gym-accent) / .5)',
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem', '3xl': '1.5rem', '4xl': '2rem' },
      backgroundImage: {
        'grid-fade':
          'linear-gradient(to bottom, rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,.055) 1px, transparent 1px)',
        'radial-fade': 'radial-gradient(ellipse at top, var(--tw-gradient-stops))',
      },
      backgroundSize: { grid: '48px 48px', 'grid-sm': '22px 22px' },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'none' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'scale-in': { '0%': { opacity: '0', transform: 'scale(.96)' }, '100%': { opacity: '1', transform: 'none' } },
        'slide-in-right': { '0%': { opacity: '0', transform: 'translateX(24px)' }, '100%': { opacity: '1', transform: 'none' } },
        shimmer: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(200%)' } },
        // Ondas del chip NFC del logo
        'tap-wave': {
          '0%': { transform: 'scale(.55)', opacity: '.85' },
          '80%': { transform: 'scale(1.9)', opacity: '0' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        // Línea de escaneo futurista
        scanline: { '0%': { transform: 'translateY(-110%)' }, '100%': { transform: 'translateY(410%)' } },
        // Nebulosa de fondo
        aurora: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%': { transform: 'translate3d(6%,-8%,0) scale(1.12)' },
          '66%': { transform: 'translate3d(-7%,6%,0) scale(.94)' },
        },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        'border-spin': { '100%': { transform: 'rotate(1turn)' } },
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        flicker: { '0%,100%': { opacity: '1' }, '45%': { opacity: '.72' }, '50%': { opacity: '1' } },
        'grid-drift': { '0%': { backgroundPosition: '0 0' }, '100%': { backgroundPosition: '48px 48px' } },
      },
      animation: {
        'fade-up': 'fade-up .45s cubic-bezier(.16,1,.3,1) both',
        'fade-in': 'fade-in .3s ease both',
        'scale-in': 'scale-in .18s cubic-bezier(.16,1,.3,1) both',
        'slide-in-right': 'slide-in-right .3s cubic-bezier(.16,1,.3,1) both',
        shimmer: 'shimmer 2.2s infinite',
        'tap-wave': 'tap-wave 2s cubic-bezier(.2,.6,.3,1) infinite',
        scanline: 'scanline 2.4s linear infinite',
        aurora: 'aurora 22s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        'border-spin': 'border-spin 5s linear infinite',
        marquee: 'marquee 34s linear infinite',
        flicker: 'flicker 5s ease-in-out infinite',
        'grid-drift': 'grid-drift 9s linear infinite',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(.16,1,.3,1)',
      },
    },
  },
  plugins: [],
}
