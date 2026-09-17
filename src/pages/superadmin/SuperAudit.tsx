import { useMemo, useState } from 'react'
import type { Gym } from '@/types'
import { AuditLogView } from '@/components/AuditLogView'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/ui/Inputs'
import { LoadingBlock } from '@/components/ui/Feedback'
import { usePlatformData } from './usePlatformData'

// Bitácora de toda la plataforma. El SUPERADMIN es el único que ve registros
// de más de un gimnasio; con el selector puede acotar a uno concreto cuando
// investiga algo puntual.

export default function SuperAudit() {
  const { gyms, loading } = usePlatformData()
  const [scope, setScope] = useState('ALL')

  const gymNames = useMemo(() => {
    const out: Record<string, string> = {}
    for (const g of gyms as Gym[]) out[g.id] = g.name
    return out
  }, [gyms])

  if (loading) return <LoadingBlock />

  return (
    <div>
      <PageHeader
        eyebrow="Plataforma"
        title="Auditoría"
        description="Quién hizo qué, cuándo y sobre qué gimnasio. Los registros no se pueden editar ni borrar: una bitácora que el auditado puede modificar no sirve de nada."
        actions={
          <Select value={scope} onChange={(e) => setScope(e.target.value)} containerClassName="w-full sm:w-60">
            <option value="ALL">Toda la plataforma</option>
            {[...(gyms as Gym[])]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </Select>
        }
      />

      <AuditLogView
        key={scope}
        gymId={scope === 'ALL' ? null : scope}
        gymNames={gymNames}
        showGymColumn={scope === 'ALL'}
      />
    </div>
  )
}
