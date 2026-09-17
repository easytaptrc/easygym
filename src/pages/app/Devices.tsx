import { useEffect, useMemo, useState } from 'react'
import { Cable, Cpu, DoorOpen, Fingerprint, Pencil, Plus, Trash2, Wifi } from 'lucide-react'
import type { Device, DeviceConnection, DeviceType } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import { audit } from '@/services/audit'
import { lanAdapters } from '@/services/biometric'
import { reportError } from '@/lib/errors'
import { cx } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge, EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Inputs'
import { BiometricSimulator } from '@/components/BiometricSimulator'

// ═══════════════════════════════════════════════════════════════════════════
// Lectores, controladores y torniquetes.
//
// ⚠️ AQUÍ NO SE GUARDA NINGÚN SECRETO DEL APARATO.
//
// Este documento lo lee el navegador: cualquier contraseña o token que se
// guardara aquí sería visible para todo el que tenga sesión en el gimnasio.
// Las credenciales del aparato viven en el Agente de Windows, en la máquina
// del gimnasio, que es quien habla con el hardware.
// ═══════════════════════════════════════════════════════════════════════════

const TYPE_LABEL: Record<DeviceType, string> = {
  FINGERPRINT: 'Lector de huella',
  ACCESS_CONTROLLER: 'Controlador de acceso',
  TURNSTILE: 'Torniquete',
}

const TYPE_ICON: Record<DeviceType, typeof Fingerprint> = {
  FINGERPRINT: Fingerprint,
  ACCESS_CONTROLLER: Cpu,
  TURNSTILE: DoorOpen,
}

const CONNECTION_LABEL: Record<DeviceConnection, string> = {
  USB: 'USB',
  LAN: 'Red (cable)',
  WIFI: 'WiFi',
}

export default function Devices() {
  const { repo, can } = useSession()
  const toast = useToast()

  const [editing, setEditing] = useState<Device | null>(null)
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Device | null>(null)
  const [busy, setBusy] = useState(false)

  const devices = useCollection(
    'devices',
    useMemo(() => ({ orderBy: { field: 'createdAt' as const, dir: 'desc' as const }, limit: 100 }), []),
  )

  const canManage = can('devices.manage')
  const hasAdapters = Object.keys(lanAdapters).length > 0

  if (devices.loading) return <LoadingBlock label="Cargando dispositivos…" />

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        eyebrow="Configuración"
        title="Dispositivos"
        description="Lectores de huella, controladores de acceso y torniquetes del gimnasio."
        actions={
          canManage && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setCreating(true)}
            >
              Agregar
            </Button>
          )
        }
      />

      {/* Mientras no haya hardware, esto es lo que permite probar el flujo
          completo: huella → evento → fichaje → cola → sincronización. */}
      <BiometricSimulator />

      {/* Cómo funciona de verdad. Sin esto, alguien va a esperar que el
          navegador hable con el lector, y no puede. */}
      <Card className="mb-4 p-5">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink-50">
          <Cable className="h-4 w-4 text-cyber-400" />
          Cómo se conecta un aparato
        </h3>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-white/[.06] bg-ink-950/60 p-3.5 font-mono text-[11.5px] leading-relaxed text-ink-300">
{`  LECTOR (USB o red)
       │
       ▼
  AGENTE DE WINDOWS        en el equipo del gimnasio · carga el SDK
       │                   del fabricante y guarda sus credenciales
       ▼
  ADAPTADOR                traduce el protocolo de ESE modelo
       │
       ▼
  EVENTO / TEMPLATE        un identificador, jamás la huella
       │
       ▼
  BASE LOCAL ──► SINCRONIZACIÓN ──► EASYGYM`}
        </pre>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-400">
          El navegador <span className="text-ink-200">no habla</span> con el hardware, y no debería
          poder hacerlo. Lo que se configura aquí es qué aparato es, dónde está y cómo se conecta —
          nunca su contraseña.
        </p>
        {!hasAdapters && (
          <p className="mt-3 rounded-xl border border-warn-500/25 bg-warn-500/[.08] px-3.5 py-3 text-[12.5px] leading-relaxed text-warn-200">
            Todavía no hay ningún adaptador de fabricante implementado. Los lectores dados de alta
            aquí funcionan en modo simulación, que es suficiente para probar el flujo completo. Para
            conectar hardware real hace falta el modelo concreto y su SDK — ver el README.
          </p>
        )}
      </Card>

      {devices.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Fingerprint className="h-6 w-6" />}
            title="Sin dispositivos dados de alta"
            detail="Agrega tu lector de huella o tu torniquete para asociar los fichajes al aparato que los generó."
            action={
              canManage ? (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                  Agregar dispositivo
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {devices.data.map((d) => {
            const Icon = TYPE_ICON[d.type]
            return (
              <Card key={d.id} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[.07] bg-white/[.03] text-cyber-400">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold text-ink-50">{d.name}</p>
                    <p className="truncate text-[12.5px] text-ink-400">{TYPE_LABEL[d.type]}</p>
                  </div>
                  <Badge tone={d.status === 'ONLINE' ? 'gym' : d.status === 'DISABLED' ? 'danger' : 'neutral'} dot>
                    {d.status === 'ONLINE' ? 'En línea' : d.status === 'DISABLED' ? 'Desactivado' : 'Sin verificar'}
                  </Badge>
                </div>

                <dl className="mt-3 space-y-1 border-t border-white/[.06] pt-3 text-[12px]">
                  <Row label="Conexión">
                    <span className="inline-flex items-center gap-1.5">
                      {d.connectionType === 'WIFI' ? (
                        <Wifi className="h-3 w-3" />
                      ) : (
                        <Cable className="h-3 w-3" />
                      )}
                      {CONNECTION_LABEL[d.connectionType]}
                    </span>
                  </Row>
                  <Row label="Ubicación">{d.location || '—'}</Row>
                  {d.connectionType !== 'USB' && (
                    <Row label="Dirección">
                      <span className="font-mono">
                        {d.ip ? `${d.ip}${d.port ? `:${d.port}` : ''}` : 'sin definir'}
                      </span>
                    </Row>
                  )}
                  {(d.vendor || d.model) && (
                    <Row label="Modelo">{[d.vendor, d.model].filter(Boolean).join(' ')}</Row>
                  )}
                </dl>

                {canManage && (
                  <div className="mt-3 flex justify-end gap-1.5 border-t border-white/[.06] pt-3">
                    <IconButton label="Editar" size="sm" onClick={() => setEditing(d)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton label="Eliminar" size="sm" onClick={() => setRemoving(d)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <DeviceModal
        open={creating || editing !== null}
        device={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSave={async (v) => {
          if (!repo) return
          try {
            if (editing) {
              await repo.update('devices', editing.id, v)
              audit({
                gymId: repo.gymId,
                action: 'DEVICE_UPDATED',
                entityType: 'devices',
                entityId: editing.id,
                summary: `Dispositivo editado: ${v.name}`,
                before: { nombre: editing.name, conexión: editing.connectionType },
                after: { nombre: v.name, conexión: v.connectionType },
              })
              toast.success('Dispositivo actualizado', v.name)
            } else {
              const created = await repo.create('devices', { ...v, status: 'UNKNOWN' as const })
              audit({
                gymId: repo.gymId,
                action: 'DEVICE_ADDED',
                entityType: 'devices',
                entityId: created.id,
                summary: `Dispositivo agregado: ${v.name} (${TYPE_LABEL[v.type]})`,
                after: { nombre: v.name, tipo: v.type, conexión: v.connectionType, ubicación: v.location },
              })
              toast.success('Dispositivo agregado', v.name)
            }
            setCreating(false)
            setEditing(null)
          } catch (err) {
            toast.error('No se pudo guardar', reportError('guardar dispositivo', err).message)
          }
        }}
      />

      <ConfirmModal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="¿Eliminar este dispositivo?"
        message={`${removing?.name ?? ''} dejará de aparecer. Los fichajes que ya generó se conservan: siguen siendo prueba de quién entró y cuándo.`}
        confirmLabel="Eliminar"
        loading={busy}
        onConfirm={async () => {
          if (!repo || !removing) return
          setBusy(true)
          try {
            await repo.remove('devices', removing.id)
            audit({
              gymId: repo.gymId,
              action: 'DEVICE_REMOVED',
              entityType: 'devices',
              entityId: removing.id,
              summary: `Dispositivo eliminado: ${removing.name}`,
              before: { nombre: removing.name, tipo: removing.type },
            })
            toast.info('Dispositivo eliminado', removing.name)
            setRemoving(null)
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-ink-200">{children}</dd>
    </div>
  )
}

interface DeviceValues {
  name: string
  type: DeviceType
  connectionType: DeviceConnection
  ip: string | null
  port: number | null
  location: string
  vendor: string | null
  model: string | null
}

function DeviceModal({
  open,
  device,
  onClose,
  onSave,
}: {
  open: boolean
  device: Device | null
  onClose: () => void
  onSave: (v: DeviceValues) => Promise<void>
}) {
  const [v, setV] = useState<DeviceValues>({
    name: '',
    type: 'FINGERPRINT',
    connectionType: 'USB',
    ip: null,
    port: null,
    location: '',
    vendor: null,
    model: null,
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setV({
      name: device?.name ?? '',
      type: device?.type ?? 'FINGERPRINT',
      connectionType: device?.connectionType ?? 'USB',
      ip: device?.ip ?? null,
      port: device?.port ?? null,
      location: device?.location ?? '',
      vendor: device?.vendor ?? null,
      model: device?.model ?? null,
    })
  }, [open, device])

  const needsAddress = v.connectionType !== 'USB'
  const valid = v.name.trim().length >= 2 && (!needsAddress || (v.ip ?? '').trim().length >= 7)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={device ? 'Editar dispositivo' : 'Agregar dispositivo'}
      size="md"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave(v)
              } finally {
                setBusy(false)
              }
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Nombre"
          required
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
          placeholder="Lector de recepción"
          autoFocus
        />
        <Input
          label="Ubicación"
          value={v.location}
          onChange={(e) => setV({ ...v, location: e.target.value })}
          placeholder="Recepción"
        />
        <Select
          label="Tipo"
          value={v.type}
          onChange={(e) => setV({ ...v, type: e.target.value as DeviceType })}
        >
          {(Object.keys(TYPE_LABEL) as DeviceType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <Select
          label="Conexión"
          value={v.connectionType}
          onChange={(e) => setV({ ...v, connectionType: e.target.value as DeviceConnection })}
        >
          {(Object.keys(CONNECTION_LABEL) as DeviceConnection[]).map((c) => (
            <option key={c} value={c}>
              {CONNECTION_LABEL[c]}
            </option>
          ))}
        </Select>

        {needsAddress && (
          <>
            <Input
              label="Dirección IP"
              required
              value={v.ip ?? ''}
              onChange={(e) => setV({ ...v, ip: e.target.value })}
              placeholder="192.168.1.50"
            />
            <Input
              label="Puerto"
              type="number"
              value={v.port ?? ''}
              onChange={(e) => setV({ ...v, port: e.target.value ? Number(e.target.value) : null })}
              placeholder="4370"
            />
          </>
        )}

        <Input
          label="Marca (opcional)"
          value={v.vendor ?? ''}
          onChange={(e) => setV({ ...v, vendor: e.target.value || null })}
          placeholder="ZKTeco"
        />
        <Input
          label="Modelo (opcional)"
          value={v.model ?? ''}
          onChange={(e) => setV({ ...v, model: e.target.value || null })}
          placeholder="K40"
        />
      </div>

      <p
        className={cx(
          'mt-4 rounded-xl border px-3.5 py-3 text-[12px] leading-relaxed',
          'border-danger-500/25 bg-danger-500/[.07] text-danger-200',
        )}
      >
        No escribas aquí contraseñas ni tokens del aparato. Este documento lo lee el navegador de
        todo el personal del gimnasio. Las credenciales van en el Agente de Windows, que es el único
        que se conecta al hardware.
      </p>

      {(v.vendor || v.model) && (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
          Marca y modelo deciden qué adaptador se usará cuando exista. Mientras tanto el aparato
          funciona en modo simulación.
        </p>
      )}
    </Modal>
  )
}
