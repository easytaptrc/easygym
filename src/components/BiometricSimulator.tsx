import { useCallback, useEffect, useMemo, useState } from 'react'
import { CloudOff, Fingerprint, LogIn, LogOut, Radio, Usb, Wifi } from 'lucide-react'
import type { BiometricEventType, Employee } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import { fullName } from '@/services/employees'
import { recordBiometricEvent } from '@/services/biometricEvents'
import { methodFor, usbProvider, lanProvider } from '@/services/biometric'
import { isOnline, pendingCount, subscribe } from '@/services/syncQueue'
import { newId } from '@/lib/utils'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Segmented, Select } from '@/components/ui/Inputs'
import { ConnectionStatus } from '@/components/ConnectionStatus'

// ═══════════════════════════════════════════════════════════════════════════
// SIMULADOR DE LECTOR.
//
// Existe porque todavía no hay hardware, y sin él no se puede probar lo que
// realmente importa: que un fichaje por huella acabe siendo un retardo bien
// calculado, y que perder Internet a media mañana no pierda ningún evento.
//
// Va DELIBERADAMENTE marcado como simulación. Un simulador que se disfraza de
// aparato real es la forma más rápida de que alguien crea que ya funciona.
//
// Cuando exista el Agente de Windows, este panel se sustituye por su estado y
// nada más cambia: el camino que recorre el evento es el mismo.
// ═══════════════════════════════════════════════════════════════════════════

export function BiometricSimulator() {
  const { repo, settings } = useSession()
  const toast = useToast()

  const [connection, setConnection] = useState<'USB' | 'LAN'>('USB')
  const [employeeId, setEmployeeId] = useState('')
  const [kind, setKind] = useState<BiometricEventType>('EMPLOYEE_ENTRY')
  const [reading, setReading] = useState(false)
  const [last, setLast] = useState<string | null>(null)
  const [forcedOffline, setForcedOffline] = useState(false)
  const [pending, setPending] = useState(0)

  const employees = useCollection(
    'employees',
    useMemo(
      () => ({
        where: [{ field: 'status', op: '==' as const, value: 'ACTIVE' }],
        orderBy: { field: 'employeeNumber' as const, dir: 'asc' as const },
        limit: 100,
      }),
      [],
    ),
  )

  useEffect(() => {
    const refresh = () => setPending(pendingCount(repo?.gymId))
    refresh()
    return subscribe(refresh)
  }, [repo?.gymId])

  useEffect(() => {
    if (!employeeId && employees.data.length > 0) setEmployeeId(employees.data[0].id)
  }, [employees.data, employeeId])

  const employee: Employee | null = employees.data.find((e) => e.id === employeeId) ?? null

  /**
   * Simula el corte de Internet.
   *
   * Se sustituye `navigator.onLine` porque no hay forma de desconectar la red
   * desde la propia página, y probar el modo sin conexión es justo lo que hay
   * que poder demostrar. Se restaura al apagarlo.
   */
  const toggleOffline = useCallback((off: boolean) => {
    setForcedOffline(off)
    Object.defineProperty(navigator, 'onLine', { value: !off, configurable: true })
    window.dispatchEvent(new Event(off ? 'offline' : 'online'))
  }, [])

  useEffect(() => {
    // Si se sale de la pantalla con el corte activo, se devuelve la conexión:
    // dejar la aplicación creyendo que no hay red sería peor que el problema.
    return () => {
      if (forcedOffline) {
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
        window.dispatchEvent(new Event('online'))
      }
    }
  }, [forcedOffline])

  async function scan() {
    if (!repo || !employee) return
    setReading(true)
    try {
      const provider = connection === 'USB' ? usbProvider : lanProvider

      // El lector solo dice «esta huella pasó». Quién es y si llegó tarde lo
      // decide EasyGym: ese es el reparto de responsabilidades del diseño.
      const fingerprintId = employee.fingerprintId ?? `fp_sim_${employee.id}`
      provider.seed([{ subjectId: employee.id, fingerprintId }])
      const read = await provider.verify(fingerprintId)
      if (!read.ok) {
        toast.warning('Huella no reconocida', 'Pide que lo intente de nuevo.')
        return
      }

      const result = await recordBiometricEvent({
        repo,
        employee,
        settings,
        event: {
          eventId: newId('EVENT'),
          type: kind,
          deviceId: null,
          employeeId: employee.id,
          fingerprintId,
          occurredAt: Date.now(),
          method: methodFor(connection),
        },
      })

      if (result.queued) {
        setLast('Guardado sin conexión')
        toast.info(
          'Guardado sin conexión',
          'El evento quedó en la cola local. Se subirá solo al volver Internet.',
        )
      } else if (result.duplicate) {
        setLast('Duplicado ignorado')
        toast.info('Evento repetido', 'Ya estaba registrado: no se creó un segundo.')
      } else {
        setLast(kind === 'EMPLOYEE_ENTRY' ? 'Entrada registrada' : 'Salida registrada')
        toast.success(
          kind === 'EMPLOYEE_ENTRY' ? 'Entrada registrada' : 'Salida registrada',
          `${fullName(employee)} · ${connection === 'USB' ? 'lector USB' : 'lector en red'}`,
        )
      }
    } catch (err) {
      toast.error('No se pudo registrar', reportError('evento biométrico', err).message)
    } finally {
      setReading(false)
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader
        title="Simulador de lector"
        subtitle="Para probar el flujo completo sin hardware"
        icon={<Radio className="h-4 w-4" />}
        action={<Badge tone="warn">Simulación</Badge>}
      />
      <CardBody>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Segmented
            value={connection}
            onChange={setConnection}
            options={[
              { value: 'USB', label: 'USB', icon: <Usb className="h-3.5 w-3.5" /> },
              { value: 'LAN', label: 'Red', icon: <Wifi className="h-3.5 w-3.5" /> },
            ]}
          />
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {employees.data.map((e) => (
              <option key={e.id} value={e.id}>
                {fullName(e)} · {e.position}
              </option>
            ))}
          </Select>
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'EMPLOYEE_ENTRY' as const, label: 'Entrada', icon: <LogIn className="h-3.5 w-3.5" /> },
              { value: 'EMPLOYEE_EXIT' as const, label: 'Salida', icon: <LogOut className="h-3.5 w-3.5" /> },
            ]}
          />
        </div>

        <Button
          variant="primary"
          size="lg"
          block
          loading={reading}
          disabled={!employee}
          icon={<Fingerprint className="h-5 w-5" />}
          onClick={scan}
        >
          {reading ? 'Leyendo huella…' : 'Simular lectura de huella'}
        </Button>

        {last && (
          <p
            className={cx(
              'mt-3 text-center text-[13px] font-semibold',
              last.includes('sin conexión')
                ? 'text-warn-300'
                : last.includes('Duplicado')
                  ? 'text-cyber-300'
                  : 'text-gym',
            )}
          >
            {last}
          </p>
        )}

        {/* Corte de Internet, para poder enseñar el modo sin conexión. */}
        <div className="mt-4 rounded-xl border border-white/[.07] bg-white/[.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-100">
                <CloudOff className="h-4 w-4 text-warn-400" />
                Simular corte de Internet
              </p>
              <p className="mt-0.5 text-[12px] text-ink-500">
                Los fichajes siguen funcionando y se guardan en la cola local.
              </p>
            </div>
            <Button
              variant={forcedOffline ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => toggleOffline(!forcedOffline)}
            >
              {forcedOffline ? 'Restablecer conexión' : 'Cortar conexión'}
            </Button>
          </div>

          {(forcedOffline || pending > 0 || !isOnline()) && (
            <div className="mt-3">
              <ConnectionStatus />
            </div>
          )}
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-ink-500">
          El lector real no llega hasta aquí: habla con el{' '}
          <span className="text-ink-300">Agente de Windows</span>, que carga el SDK del fabricante y
          empuja el evento a EasyGym. Lo que este botón simula es ese último paso — el mismo que
          recorrerá el evento real.
        </p>
      </CardBody>
    </Card>
  )
}
