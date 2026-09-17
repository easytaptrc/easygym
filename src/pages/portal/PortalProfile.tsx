import { useEffect, useState } from 'react'
import { Download, LogOut, Save, Smartphone } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '@/state/SessionContext'
import { useToast } from '@/hooks/useToast'
import { memberTag } from '@/services/members'
import { ageFrom, fmtDate } from '@/lib/date'
import { phoneFmt } from '@/lib/format'
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/Card'
import { Avatar, LoadingBlock } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Inputs'

export default function PortalProfile() {
  const { member, user, gym, repo, signOut } = useSession()
  const toast = useToast()
  const navigate = useNavigate()

  const [form, setForm] = useState({ phone: '', email: '', emergencyName: '', emergencyPhone: '' })
  const [busy, setBusy] = useState(false)
  const [installEvent, setInstallEvent] = useState<Event | null>(null)

  useEffect(() => {
    if (!member) return
    setForm({
      phone: member.phone,
      email: member.email,
      emergencyName: member.emergencyContact?.name ?? '',
      emergencyPhone: member.emergencyContact?.phone ?? '',
    })
  }, [member])

  // Instalación de la PWA: una sola app EasyGym para todos los gimnasios.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setInstallEvent(e)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (!member) return <LoadingBlock />

  async function save() {
    if (!repo || !member) return
    setBusy(true)
    try {
      await repo.update('members', member.id, {
        phone: form.phone,
        email: form.email.trim().toLowerCase(),
        emergencyContact: form.emergencyName
          ? { name: form.emergencyName, phone: form.emergencyPhone }
          : null,
      })
      toast.success('Datos actualizados')
    } catch {
      toast.error('No se pudieron guardar tus datos')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card lit>
        <CardBody className="pt-6 text-center">
          <Avatar name={member.name} src={member.photoUrl} size={82} ring className="mx-auto" />
          <p className="mt-4 text-[22px] font-bold tracking-tight text-ink-50">{member.name}</p>
          <p className="font-mono text-[12px] text-ink-500">{memberTag(member.memberNumber)}</p>
          <p className="mt-1 text-[12.5px] text-ink-400">{gym?.name}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Mis datos" subtitle="Puedes actualizar tu contacto cuando quieras" />
        <CardBody className="space-y-4">
          <Input label="Teléfono" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          <Input label="Correo" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Contacto de emergencia"
              value={form.emergencyName}
              onChange={(e) => setForm((f) => ({ ...f, emergencyName: e.target.value }))}
              placeholder="Nombre"
            />
            <Input
              label="Teléfono de emergencia"
              type="tel"
              value={form.emergencyPhone}
              onChange={(e) => setForm((f) => ({ ...f, emergencyPhone: e.target.value }))}
            />
          </div>
          <Button variant="primary" block loading={busy} icon={<Save className="h-4 w-4" />} onClick={save}>
            Guardar cambios
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Información de la cuenta" />
        <CardBody className="divide-y divide-white/[.05]">
          <DetailRow label="Correo de acceso">{user?.email}</DetailRow>
          <DetailRow label="Teléfono">{phoneFmt(member.phone)}</DetailRow>
          <DetailRow label="Nacimiento">
            {member.birthDate ? `${member.birthDate} (${ageFrom(member.birthDate)} años)` : '—'}
          </DetailRow>
          <DetailRow label="Socio desde">{fmtDate(member.createdAt)}</DetailRow>
          <DetailRow label="Huella registrada">{member.fingerprintId ? 'Sí' : 'No'}</DetailRow>
        </CardBody>
      </Card>

      {/* Instalar como app */}
      <Card>
        <CardHeader
          title="Instala la app"
          subtitle="Una sola app EasyGym para todos los gimnasios"
          icon={<Smartphone className="h-4 w-4" />}
        />
        <CardBody>
          {installEvent ? (
            <Button
              variant="primary"
              block
              icon={<Download className="h-4 w-4" />}
              onClick={async () => {
                const evt = installEvent as Event & { prompt?: () => Promise<void> }
                await evt.prompt?.()
                setInstallEvent(null)
              }}
            >
              Agregar a mi pantalla de inicio
            </Button>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-ink-400">
              En Android: menú del navegador → <b className="text-ink-200">Instalar aplicación</b>.
              <br />
              En iPhone: botón compartir → <b className="text-ink-200">Agregar a pantalla de inicio</b>.
            </p>
          )}
        </CardBody>
      </Card>

      <Button
        variant="ghost"
        block
        className="text-danger-300"
        icon={<LogOut className="h-4 w-4" />}
        onClick={async () => {
          await signOut()
          navigate('/login')
        }}
      >
        Cerrar sesión
      </Button>
    </div>
  )
}
