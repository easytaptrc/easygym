import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Package, Pencil, Plus } from 'lucide-react'
import type { Product } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import { fmtDateTime } from '@/lib/date'
import { money, money0 } from '@/lib/format'
import { cx, norm } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Badge, EmptyState } from '@/components/ui/Feedback'
import { Button, IconButton } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, SearchInput, Select, Toggle } from '@/components/ui/Inputs'

const CATEGORIES: Array<{ value: Product['category']; label: string }> = [
  { value: 'BEBIDA', label: 'Bebidas' },
  { value: 'SUPLEMENTO', label: 'Suplementos' },
  { value: 'ACCESORIO', label: 'Accesorios' },
  { value: 'ROPA', label: 'Ropa' },
  { value: 'OTRO', label: 'Otros' },
]

export default function Inventory() {
  const { repo, user } = useSession()
  const toast = useToast()

  const products = useCollection('products')
  // El catálogo de productos es pequeño por naturaleza; el historial de
  // movimientos no lo es: crece con cada entrada y cada venta. Para enseñar
  // los doce últimos basta con pedir los doce últimos.
  const movements = useCollection(
    'inventory',
    useMemo(() => ({ orderBy: { field: 'createdAt' as const, dir: 'desc' as const }, limit: 12 }), []),
  )

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)
  const [moving, setMoving] = useState<{ product: Product; kind: 'IN' | 'OUT' } | null>(null)

  const rows = useMemo(() => {
    const q = norm(query.trim())
    return products.data
      .filter((p) => (!q ? true : norm(p.name).includes(q) || norm(p.sku ?? '').includes(q)))
      .sort((a, b) => Number(a.stock > a.minStock) - Number(b.stock > b.minStock) || a.name.localeCompare(b.name))
  }, [products.data, query])

  const stats = useMemo(() => {
    const value = products.data.reduce((a, p) => a + p.stock * p.cost, 0)
    const retail = products.data.reduce((a, p) => a + p.stock * p.price, 0)
    const low = products.data.filter((p) => p.stock <= p.minStock).length
    return { value, retail, low, count: products.data.length }
  }, [products.data])

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: 'Producto',
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-ink-100">{p.name}</p>
          <p className="truncate font-mono text-[11px] text-ink-500">{p.sku ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Categoría',
      hideOnMobile: true,
      sortValue: (p) => p.category,
      cell: (p) => <Badge tone="neutral">{CATEGORIES.find((c) => c.value === p.category)?.label}</Badge>,
    },
    {
      key: 'cost',
      header: 'Costo',
      align: 'right',
      hideOnMobile: true,
      sortValue: (p) => p.cost,
      cell: (p) => <span className="text-[13px] text-ink-400 tnum">{money(p.cost)}</span>,
    },
    {
      key: 'price',
      header: 'Precio',
      align: 'right',
      sortValue: (p) => p.price,
      cell: (p) => <span className="text-[13px] font-semibold text-ink-100 tnum">{money(p.price)}</span>,
    },
    {
      key: 'margin',
      header: 'Margen',
      align: 'right',
      hideOnMobile: true,
      sortValue: (p) => (p.price > 0 ? (p.price - p.cost) / p.price : 0),
      cell: (p) => (
        <span className="text-[12.5px] text-tap-400 tnum">
          {p.price > 0 ? `${(((p.price - p.cost) / p.price) * 100).toFixed(0)}%` : '—'}
        </span>
      ),
    },
    {
      key: 'stock',
      header: 'Existencias',
      align: 'right',
      sortValue: (p) => p.stock,
      cell: (p) => (
        <span
          className={cx(
            'text-[13.5px] font-semibold tnum',
            p.stock <= 0 ? 'text-danger-400' : p.stock <= p.minStock ? 'text-warn-400' : 'text-ink-100',
          )}
        >
          {p.stock}
          {p.stock <= p.minStock && <AlertTriangle className="ml-1.5 inline h-3.5 w-3.5" />}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <IconButton
            label="Entrada"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setMoving({ product: p, kind: 'IN' })
            }}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label="Salida"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setMoving({ product: p, kind: 'OUT' })
            }}
          >
            <ArrowUpFromLine className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label="Editar"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setEditing(p)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Inventario"
        description="Existencias, costos y movimientos de tus productos."
        actions={
          <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCreating(true)}>
            Nuevo producto
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { label: 'Productos', value: String(stats.count), tone: 'text-ink-50' },
          { label: 'Valor a costo', value: money0(stats.value), tone: 'text-ink-50' },
          { label: 'Valor a venta', value: money0(stats.retail), tone: 'text-gym' },
          { label: 'Stock bajo', value: String(stats.low), tone: stats.low > 0 ? 'text-warn-400' : 'text-ink-50' },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-[11.5px] text-ink-400">{s.label}</p>
            <p className={cx('mt-1.5 text-[22px] font-bold tnum', s.tone)}>{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="mb-4">
        <SearchInput value={query} onValueChange={setQuery} placeholder="Buscar producto o SKU…" className="w-full sm:w-72" />
      </div>

      <Card className="mb-3 overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          loading={products.loading}
          pageSize={25}
          empty={
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title="Todavía no tienes productos"
              detail="Agrega bebidas, suplementos o accesorios para venderlos desde el punto de venta."
              action={
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                  Agregar producto
                </Button>
              }
            />
          }
        />
      </Card>

      {/* Movimientos recientes */}
      <Card>
        <CardHeader title="Movimientos recientes" subtitle="Entradas y salidas registradas" />
        <CardBody>
          {movements.data.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-500">Sin movimientos todavía.</p>
          ) : (
            <ul className="divide-y divide-white/[.05]">
              {movements.data
                .slice(0, 12)
                .map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2.5">
                    <span
                      className={cx(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                        m.kind === 'IN' ? 'bg-tap-500/12 text-tap-400' : 'bg-warn-500/12 text-warn-400',
                      )}
                    >
                      {m.kind === 'IN' ? (
                        <ArrowDownToLine className="h-4 w-4" />
                      ) : (
                        <ArrowUpFromLine className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink-100">{m.productName}</p>
                      <p className="truncate text-[11.5px] text-ink-500">
                        {fmtDateTime(m.createdAt)} · {m.reason}
                      </p>
                    </div>
                    <span
                      className={cx(
                        'shrink-0 text-[13.5px] font-semibold tnum',
                        m.kind === 'IN' ? 'text-tap-400' : 'text-warn-400',
                      )}
                    >
                      {m.kind === 'IN' ? '+' : '−'}
                      {m.qty}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <ProductModal
        open={creating || editing !== null}
        product={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSave={async (v) => {
          if (!repo) return
          if (editing) {
            await repo.update('products', editing.id, v)
            toast.success('Producto actualizado', v.name)
          } else {
            await repo.create('products', { ...v, imageUrl: null })
            toast.success('Producto agregado', v.name)
          }
          setCreating(false)
          setEditing(null)
        }}
      />

      <MovementModal
        open={moving !== null}
        product={moving?.product ?? null}
        kind={moving?.kind ?? 'IN'}
        onClose={() => setMoving(null)}
        onSave={async (qty, reason) => {
          if (!repo || !moving) return
          const { product, kind } = moving
          const next = kind === 'IN' ? product.stock + qty : Math.max(0, product.stock - qty)
          await repo.update('products', product.id, { stock: next })
          await repo.create('inventory', {
            productId: product.id,
            productName: product.name,
            kind,
            qty,
            reason,
            by: user?.uid ?? '',
          })
          toast.success(
            kind === 'IN' ? 'Entrada registrada' : 'Salida registrada',
            `${product.name} · ${next} en existencia`,
          )
          setMoving(null)
        }}
      />
    </div>
  )
}

// ────────────────────────────── Modales ─────────────────────────────────────

interface ProductValues {
  name: string
  sku: string
  category: Product['category']
  price: number
  cost: number
  stock: number
  minStock: number
  active: boolean
}

function ProductModal({
  open,
  product,
  onClose,
  onSave,
}: {
  open: boolean
  product: Product | null
  onClose: () => void
  onSave: (v: ProductValues) => Promise<void>
}) {
  const [v, setV] = useState<ProductValues>({
    name: '',
    sku: '',
    category: 'BEBIDA',
    price: 0,
    cost: 0,
    stock: 0,
    minStock: 5,
    active: true,
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setV(
      product
        ? {
            name: product.name,
            sku: product.sku ?? '',
            category: product.category,
            price: product.price,
            cost: product.cost,
            stock: product.stock,
            minStock: product.minStock,
            active: product.active,
          }
        : { name: '', sku: '', category: 'BEBIDA', price: 0, cost: 0, stock: 0, minStock: 5, active: true },
    )
  }, [open, product])

  const margin = v.price > 0 ? ((v.price - v.cost) / v.price) * 100 : 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? 'Editar producto' : 'Nuevo producto'}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!v.name.trim()}
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
          onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))}
          containerClassName="sm:col-span-2"
          placeholder="Proteína en polvo 2kg"
        />
        <Input label="SKU" value={v.sku} onChange={(e) => setV((x) => ({ ...x, sku: e.target.value }))} placeholder="SKU-001" />
        <Select
          label="Categoría"
          value={v.category}
          onChange={(e) => setV((x) => ({ ...x, category: e.target.value as Product['category'] }))}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <Input
          label="Costo"
          type="number"
          min={0}
          value={v.cost}
          onChange={(e) => setV((x) => ({ ...x, cost: Number(e.target.value) }))}
          prefix="$"
        />
        <Input
          label="Precio de venta"
          type="number"
          min={0}
          value={v.price}
          onChange={(e) => setV((x) => ({ ...x, price: Number(e.target.value) }))}
          prefix="$"
          hint={v.price > 0 ? `Margen: ${margin.toFixed(0)}%` : undefined}
        />
        <Input
          label="Existencias"
          type="number"
          min={0}
          value={v.stock}
          onChange={(e) => setV((x) => ({ ...x, stock: Number(e.target.value) }))}
          disabled={Boolean(product)}
          hint={product ? 'Usa entradas y salidas para moverlo' : undefined}
        />
        <Input
          label="Alerta de stock bajo"
          type="number"
          min={0}
          value={v.minStock}
          onChange={(e) => setV((x) => ({ ...x, minStock: Number(e.target.value) }))}
        />
      </div>
      <div className="mt-4">
        <Toggle
          checked={v.active}
          onChange={(active) => setV((x) => ({ ...x, active }))}
          label="Disponible en el punto de venta"
        />
      </div>
    </Modal>
  )
}

function MovementModal({
  open,
  product,
  kind,
  onClose,
  onSave,
}: {
  open: boolean
  product: Product | null
  kind: 'IN' | 'OUT'
  onClose: () => void
  onSave: (qty: number, reason: string) => Promise<void>
}) {
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setQty(1)
      setReason(kind === 'IN' ? 'Compra a proveedor' : 'Merma')
    }
  }, [open, kind])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={kind === 'IN' ? 'Entrada de inventario' : 'Salida de inventario'}
      description={product ? `${product.name} · ${product.stock} en existencia` : ''}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={qty <= 0}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave(qty, reason)
              } finally {
                setBusy(false)
              }
            }}
          >
            Registrar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Cantidad"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          autoFocus
        />
        <Input label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
        {product && (
          <p className="rounded-xl border border-white/[.07] bg-ink-950/40 px-3.5 py-3 text-[13px] text-ink-300">
            Quedará en{' '}
            <b className="text-ink-50 tnum">
              {kind === 'IN' ? product.stock + qty : Math.max(0, product.stock - qty)}
            </b>{' '}
            unidades.
          </p>
        )}
      </div>
    </Modal>
  )
}
