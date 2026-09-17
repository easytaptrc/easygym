import { useSession } from '@/state/SessionContext'
import { AuditLogView } from '@/components/AuditLogView'
import { PageHeader } from '@/components/layout/PageHeader'
import { LoadingBlock } from '@/components/ui/Feedback'

// Bitácora del gimnasio. Muestra EXACTAMENTE lo que pasó en este gimnasio y
// nada más: la consulta va acotada por `gymId` y las reglas de Firestore
// rechazan cualquier intento de leer la de otro.
//
// Para quien administra el negocio, esta pantalla contesta la pregunta que
// siempre acaba apareciendo: «¿quién le cambió la fecha de vencimiento a este
// socio?». Sin bitácora eso es una discusión; con bitácora es un dato.

export default function Activity() {
  const { user } = useSession()

  if (!user) return <LoadingBlock />

  return (
    <div>
      <PageHeader
        eyebrow="Administración"
        title="Actividad"
        description="Todo lo que ha hecho tu equipo: altas, cobros, cambios de membresía y ajustes de configuración, con quién lo hizo y cuándo."
      />
      <AuditLogView gymId={user.gymId} />
    </div>
  )
}
