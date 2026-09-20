import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Building2, Check, CreditCard, Lock, User } from 'lucide-react'
import type { PlanId } from '@/types'
import { usePlans } from '@/state/PlansContext'
import { money0 } from '@/lib/format'
import { cx, slugify } from '@/lib/utils'
import { BRAND } from '@/config/brand'
import { Backdrop } from '@/components/ui/Backdrop'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Inputs'
import { PublicNav } from './PublicChrome'
import type { RegisterGymInput } from '@/services/provisioning'

// ═══════════════════════════════════════════════════════════════════════════
// Registro del gimnasio — asistente de 3 pasos.
//
// NO se crea nada todavía: aquí solo se recogen los datos. La creación del
// tenant ocurre en /checkout, después del pago, y de forma atómica. Así no
// quedan gimnasios fantasma de gente que abandonó el formulario.
// ═══════════════════════════════════════════════════════════════════════════

const ESTADOS = [
  'Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas','Chihuahua','Ciudad de México',
  'Coahuila','Colima','Durango','Estado de México','Guanajuato','Guerrero','Hidalgo','Jalisco','Michoacán',
  'Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí','Sinaloa',
  'Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas',
]

type Step = 0 | 1 | 2

const STEPS = [
  { title: 'Tu plan', icon: CreditCard },
  { title: 'Tu cuenta', icon: User },
  { title: 'Tu gimnasio', icon: Building2 },
]

export default function Register() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const { publicPlans, getPlan } = usePlans()

  const initialPlan = (params.get('plan')?.toUpperCase() as PlanId) || 'PRO'
  const [planId, setPlanId] = useState<PlanId>(initialPlan)
  const [step, setStep] = useState<Step>(params.get('plan') ? 1 : 0)

  const [form, setForm] = useState({
    ownerName: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
    gymName: '',
    address: '',
    city: '',
    state: 'Jalisco',
    zip: '',
    gymPhone: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setErrors((prev) => {
      if (!prev[k]) return prev
      const { [k]: _drop, ...rest } = prev
      void _drop
      return rest
    })
  }

  const plan = getPlan(planId)
  const slug = useMemo(() => slugify(form.gymName) || 'tu-gimnasio', [form.gymName])

  function validateAccount(): boolean {
    const e: Record<string, string> = {}
    if (form.ownerName.trim().length < 3) e.ownerName = 'Escribe tu nombre completo.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = 'Ese correo no parece válido.'
    if (form.phone.replace(/\D/g, '').length < 10) e.phone = 'Necesitamos 10 dígitos.'
    if (form.password.length < 8) e.password = 'Mínimo 8 caracteres.'
    if (form.password !== form.confirm) e.confirm = 'Las contraseñas no coinciden.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function validateGym(): boolean {
    const e: Record<string, string> = {}
    if (form.gymName.trim().length < 3) e.gymName = 'Escribe el nombre de tu gimnasio.'
    if (form.address.trim().length < 5) e.address = 'Escribe la dirección.'
    if (form.city.trim().length < 3) e.city = 'Escribe la ciudad.'
    if (!/^\d{5}$/.test(form.zip)) e.zip = 'El código postal son 5 dígitos.'
    if (form.gymPhone.replace(/\D/g, '').length < 10) e.gymPhone = 'Necesitamos 10 dígitos.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function next() {
    if (step === 0) return setStep(1)
    if (step === 1) return validateAccount() && setStep(2)
    if (step === 2 && validateGym()) {
      const payload: Omit<RegisterGymInput, 'card'> = {
        ownerName: form.ownerName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone,
        password: form.password,
        gymName: form.gymName.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state,
        zip: form.zip,
        gymPhone: form.gymPhone,
        logoUrl: null,
        planId,
      }
      navigate('/checkout', { state: payload })
    }
  }

  return (
    <div className="relative min-h-screen">
      <Backdrop variant="auth" />
      <PublicNav />

      <main className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6">
        {/* Indicador de pasos */}
        <ol className="mb-8 flex items-center gap-2">
          {STEPS.map((s, i) => {
            const done = i < step
            const active = i === step
            return (
              <li key={s.title} className="flex flex-1 items-center gap-2">
                <div
                  className={cx(
                    'flex items-center gap-2.5 rounded-xl px-3 py-2 transition-all duration-300',
                    active && 'bg-gym/10 ring-1 ring-inset ring-gym/30',
                  )}
                >
                  <span
                    className={cx(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12px] font-bold transition-colors',
                      done
                        ? 'bg-gym text-ink-950'
                        : active
                          ? 'bg-gym/20 text-gym'
                          : 'bg-white/[.05] text-ink-500',
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span
                    className={cx(
                      'hidden text-[13px] font-medium sm:inline',
                      active ? 'text-ink-50' : done ? 'text-ink-300' : 'text-ink-500',
                    )}
                  >
                    {s.title}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <span className={cx('h-px flex-1 transition-colors', done ? 'bg-gym/40' : 'bg-white/10')} />
                )}
              </li>
            )
          })}
        </ol>

        <div className="rounded-2xl border border-white/[.08] bg-ink-900/70 p-6 shadow-card backdrop-blur-xl sm:p-8">
          {/* ── Paso 1: plan ── */}
          {step === 0 && (
            <div className="animate-fade-up">
              <h1 className="text-[24px] font-bold tracking-tight text-white">Elige tu plan</h1>
              <p className="mt-1.5 text-sm text-ink-400">
                Puedes cambiarlo después desde tu panel, sin perder nada.
              </p>

              <div className="mt-6 space-y-2.5">
                {publicPlans.map((p) => (
                  <label
                    key={p.id}
                    className={cx(
                      'flex cursor-pointer items-start gap-4 rounded-xl border p-4 transition-all duration-200',
                      planId === p.id
                        ? 'border-gym/50 bg-gym/[.07] ring-1 ring-inset ring-gym/25'
                        : 'border-white/[.08] bg-white/[.02] hover:border-white/20',
                    )}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={p.id}
                      checked={planId === p.id}
                      onChange={() => setPlanId(p.id)}
                      className="sr-only"
                    />
                    <span
                      className={cx(
                        'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
                        planId === p.id ? 'border-gym bg-gym' : 'border-ink-600',
                      )}
                    >
                      {planId === p.id && <Check className="h-3 w-3 text-ink-950" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[16px] font-bold text-white">{p.name}</span>
                        {p.popular && (
                          <span className="rounded-full bg-cyber-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyber-300">
                            Más popular
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] text-ink-400">{p.tagline}</span>
                      <span className="mt-2 block text-[12px] text-ink-500">
                        {p.highlights.slice(0, 3).join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[20px] font-bold text-white tnum">
                        {money0(p.price ?? 0)}
                      </span>
                      <span className="text-[11px] text-ink-500">MXN / mes</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── Paso 2: cuenta ── */}
          {step === 1 && (
            <div className="animate-fade-up">
              <h1 className="text-[24px] font-bold tracking-tight text-white">Crea tu cuenta</h1>
              <p className="mt-1.5 text-sm text-ink-400">
                Serás el <span className="font-semibold text-gym">dueño</span> del gimnasio, con acceso a
                todo.
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <Input
                  label="Nombre completo"
                  required
                  value={form.ownerName}
                  onChange={set('ownerName')}
                  error={errors.ownerName}
                  placeholder="Bruno Ramírez"
                  containerClassName="sm:col-span-2"
                  autoComplete="name"
                />
                <Input
                  label="Correo electrónico"
                  required
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  error={errors.email}
                  placeholder="tu@correo.com"
                  autoComplete="email"
                />
                <Input
                  label="Teléfono"
                  required
                  type="tel"
                  value={form.phone}
                  onChange={set('phone')}
                  error={errors.phone}
                  placeholder="33 1234 5678"
                  autoComplete="tel"
                />
                <Input
                  label="Contraseña"
                  required
                  type="password"
                  value={form.password}
                  onChange={set('password')}
                  error={errors.password}
                  hint="Mínimo 8 caracteres"
                  autoComplete="new-password"
                />
                <Input
                  label="Confirmar contraseña"
                  required
                  type="password"
                  value={form.confirm}
                  onChange={set('confirm')}
                  error={errors.confirm}
                  autoComplete="new-password"
                />
              </div>

              <p className="mt-5 flex items-start gap-2 text-[12px] leading-relaxed text-ink-500">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Tu contraseña se guarda cifrada en Firebase Authentication. {BRAND.name} nunca la ve ni
                puede recuperarla.
              </p>
            </div>
          )}

          {/* ── Paso 3: gimnasio ── */}
          {step === 2 && (
            <div className="animate-fade-up">
              <h1 className="text-[24px] font-bold tracking-tight text-white">Registra tu gimnasio</h1>
              <p className="mt-1.5 text-sm text-ink-400">
                Estos datos aparecen en los recibos, contratos y en el portal de tus socios.
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <Input
                  label="Nombre del gimnasio"
                  required
                  value={form.gymName}
                  onChange={set('gymName')}
                  error={errors.gymName}
                  placeholder="Iron Fitness"
                  containerClassName="sm:col-span-2"
                  hint={`Tu portal será ${BRAND.domain}/g/${slug}`}
                />
                <Input
                  label="Dirección"
                  required
                  value={form.address}
                  onChange={set('address')}
                  error={errors.address}
                  placeholder="Av. Chapultepec 1450"
                  containerClassName="sm:col-span-2"
                />
                <Input
                  label="Ciudad"
                  required
                  value={form.city}
                  onChange={set('city')}
                  error={errors.city}
                  placeholder="Guadalajara"
                />
                <Select label="Estado" required value={form.state} onChange={set('state')}>
                  {ESTADOS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Código postal"
                  required
                  inputMode="numeric"
                  maxLength={5}
                  value={form.zip}
                  onChange={set('zip')}
                  error={errors.zip}
                  placeholder="44160"
                />
                <Input
                  label="Teléfono del gimnasio"
                  required
                  type="tel"
                  value={form.gymPhone}
                  onChange={set('gymPhone')}
                  error={errors.gymPhone}
                  placeholder="33 1245 7890"
                />
              </div>

              {/* Resumen */}
              <div className="mt-6 rounded-xl border border-white/[.07] bg-ink-950/50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-ink-500">
                  Resumen
                </p>
                <div className="mt-3 flex items-baseline justify-between gap-4">
                  <span className="text-[14px] text-ink-200">
                    Plan <span className="font-semibold text-white">{plan.name}</span>
                  </span>
                  <span className="text-[18px] font-bold text-white tnum">
                    {money0(plan.price ?? 0)}
                    <span className="text-[11px] font-medium text-ink-400"> /mes</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Navegación */}
          <div className="mt-7 flex items-center justify-between gap-3">
            <Button
              variant="subtle"
              icon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => (step === 0 ? navigate('/planes') : setStep((s) => (s - 1) as Step))}
            >
              {step === 0 ? 'Ver planes' : 'Atrás'}
            </Button>
            <Button
              variant="primary"
              size="lg"
              iconRight={<ArrowRight className="h-4 w-4" />}
              onClick={next}
            >
              {step === 2 ? 'Ir al pago' : 'Continuar'}
            </Button>
          </div>
        </div>

        <p className="mt-5 text-center text-[12.5px] text-ink-500">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="font-semibold text-gym hover:underline">
            Inicia sesión
          </Link>
        </p>
      </main>
    </div>
  )
}
