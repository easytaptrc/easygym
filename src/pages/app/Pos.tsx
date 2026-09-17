import { useMemo, useState } from 'react'
import { Minus, Package, Plus, Printer, Search, ShoppingCart, Trash2, X } from 'lucide-react'
import type { PaymentMethod, Product, SaleItem } from '@/types'
import { useSession } from '@/state/SessionContext'
import { useCollection } from '@/hooks/useCollection'
import { useToast } from '@/hooks/useToast'
import { PAYMENT_METHOD_LABEL, registerPayment } from '@/services/billing'
import { printReceipt } from '@/services/printing'
import { dayKey } from '@/lib/date'
import { money, money0 } from '@/lib/format'
import { reportError } from '@/lib/errors'
import { cx, norm } from '@/lib/utils'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Avatar, Badge, EmptyState } from '@/components/ui/Feedback'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SearchInput, Select } from '@/components/ui/Inputs'
import { MemberPicker } from '@/components/MemberPicker'
import { IfFeature } from '@/components/PlanGuard'

// Punto de venta. Pensado para el mostrador: pocos toques, números grandes,
// y el carrito siempre visible.

const CATEGORY_LABELS: Record<Product['category'], string> = {
  BEBIDA: 'Bebidas',
  SUPLEMENTO: 'Suplementos',
  ACCESORIO: 'Accesorios',
  ROPA: 'Ropa',
  OTRO: 'Otros',
}

export default function Pos() {
  const { repo, gym, settings, user, hasFeature } = useSession()
  const toast = useToast()

  const products = useCollection('products')

  const [cart, setCart] = useState<SaleItem[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Product['category'] | 'ALL'>('ALL')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  // Se guarda el socio entero, no solo su id: así no hay que tener la lista de
  // socios cargada para poder escribir su nombre en el ticket.
  const [member, setMember] = useState<{ id: string; name: string } | null>(null)
  const [pickOpen, setPickOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const visible = useMemo(() => {
    const q = norm(query.trim())
    return products.data
      .filter((p) => p.active)
      .filter((p) => (category === 'ALL' ? true : p.category === category))
      .filter((p) => (!q ? true : norm(p.name).includes(q) || norm(p.sku ?? '').includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products.data, query, category])

  const total = useMemo(() => cart.reduce((a, i) => a + i.total, 0), [cart])

  function add(p: Product) {
    if (p.stock <= 0 && hasFeature('inventory')) {
      toast.warning('Sin existencias', `${p.name} está en cero. Registra una entrada en Inventario.`)
      return
    }
    setCart((c) => {
      const found = c.find((i) => i.productId === p.id)
      if (found) {
        return c.map((i) =>
          i.productId === p.id ? { ...i, qty: i.qty + 1, total: (i.qty + 1) * i.unitPrice } : i,
        )
      }
      return [...c, { productId: p.id, name: p.name, qty: 1, unitPrice: p.price, total: p.price }]
    })
  }

  function setQty(productId: string, delta: number) {
    setCart((c) =>
      c
        .map((i) =>
          i.productId === productId
            ? { ...i, qty: Math.max(0, i.qty + delta), total: Math.max(0, i.qty + delta) * i.unitPrice }
            : i,
        )
        .filter((i) => i.qty > 0),
    )
  }

  async function checkout() {
    if (!repo || cart.length === 0) return
    setBusy(true)
    try {
      const sale = await repo.create('sales', {
        items: cart,
        subtotal: total,
        discount: 0,
        total,
        method,
        soldBy: user?.uid ?? '',
        memberId: member?.id ?? null,
        date: dayKey(),
      })

      const payment = await registerPayment(repo, {
        memberId: member?.id ?? null,
        memberName: member?.name ?? null,
        concept:
          cart.length === 1
            ? `${cart[0].name} ×${cart[0].qty}`
            : `Venta de ${cart.length} productos`,
        category: 'PRODUCT',
        amount: total,
        method,
        saleId: sale.id,
        collectedBy: user?.uid ?? null,
      })

      // Descuenta existencias (solo si el plan incluye inventario).
      if (hasFeature('inventory')) {
        for (const item of cart) {
          const p = products.data.find((x) => x.id === item.productId)
          if (p) await repo.update('products', p.id, { stock: Math.max(0, p.stock - item.qty) })
        }
      }

      toast.success('Venta registrada', `${money0(total)} · ${PAYMENT_METHOD_LABEL[method]}`)
      if (gym) printReceipt({ gym, settings }, payment, null)
      setCart([])
      setMember(null)
    } catch (err) {
      toast.error('No se pudo cobrar', reportError('cobrar en el punto de venta', err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Punto de venta"
        description="Bebidas, suplementos y accesorios. Cada venta entra al reporte como 'Productos'."
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        {/* Catálogo */}
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchInput value={query} onValueChange={setQuery} placeholder="Buscar producto…" className="w-full sm:w-64" />
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as Product['category'] | 'ALL')}
              containerClassName="w-full sm:w-44"
            >
              <option value="ALL">Todas las categorías</option>
              {(Object.keys(CATEGORY_LABELS) as Product['category'][]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>

          {visible.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Package className="h-6 w-6" />}
                title={products.data.length === 0 ? 'Todavía no tienes productos' : 'Sin resultados'}
                detail={
                  products.data.length === 0
                    ? 'Agrega productos desde Inventario para poder venderlos aquí.'
                    : 'Prueba con otro nombre o cambia la categoría.'
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map((p) => {
                const low = p.stock <= p.minStock
                return (
                  <button
                    key={p.id}
                    onClick={() => add(p)}
                    className="group flex flex-col rounded-2xl border border-white/[.07] bg-ink-900/60 p-3.5 text-left transition-all duration-200 ease-spring hover:-translate-y-0.5 hover:border-gym/35 hover:bg-gym/[.05] active:scale-[.98]"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[.04] text-ink-400 transition group-hover:text-gym">
                      <Package className="h-5 w-5" />
                    </span>
                    <p className="mt-2.5 line-clamp-2 min-h-[34px] text-[13px] font-medium leading-snug text-ink-100">
                      {p.name}
                    </p>
                    <p className="mt-1.5 text-[17px] font-bold text-gym tnum">{money0(p.price)}</p>
                    <IfFeature feature="inventory">
                      <p className={cx('mt-1 text-[11px] tnum', low ? 'text-warn-400' : 'text-ink-500')}>
                        {p.stock} en existencia
                      </p>
                    </IfFeature>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Carrito */}
        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader
            title="Venta"
            subtitle={`${cart.reduce((a, i) => a + i.qty, 0)} artículos`}
            icon={<ShoppingCart className="h-4 w-4" />}
            action={
              cart.length > 0 ? (
                <button
                  onClick={() => setCart([])}
                  className="rounded-lg p-1.5 text-ink-500 transition hover:bg-white/5 hover:text-danger-400"
                  aria-label="Vaciar"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : undefined
            }
          />
          <CardBody>
            {cart.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-ink-500">
                Toca un producto para agregarlo a la venta.
              </p>
            ) : (
              <ul className="divide-y divide-white/[.05]">
                {cart.map((i) => (
                  <li key={i.productId} className="flex items-center gap-2.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink-100">{i.name}</p>
                      <p className="text-[11.5px] text-ink-500 tnum">{money(i.unitPrice)} c/u</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => setQty(i.productId, -1)}
                        className="grid h-7 w-7 place-items-center rounded-lg bg-white/[.05] text-ink-300 transition hover:bg-white/[.1]"
                        aria-label="Quitar uno"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-[13px] font-semibold text-ink-100 tnum">
                        {i.qty}
                      </span>
                      <button
                        onClick={() => setQty(i.productId, 1)}
                        className="grid h-7 w-7 place-items-center rounded-lg bg-white/[.05] text-ink-300 transition hover:bg-white/[.1]"
                        aria-label="Agregar uno"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <span className="w-16 shrink-0 text-right text-[13px] font-semibold text-ink-50 tnum">
                      {money0(i.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 space-y-3 border-t border-white/[.07] pt-4">
              <Select
                label="Método de pago"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {(settings?.payments.methods ?? ['cash', 'card', 'transfer']).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </Select>
              {/* Socio: se busca, no se elige de una lista desplegable. Con
                  6 000 socios, un <select> con 6 000 opciones ni se puede usar
                  ni se puede cargar. */}
              <div>
                <p className="mb-1.5 text-[12.5px] font-medium text-ink-300">Socio (opcional)</p>
                {member ? (
                  <div className="flex items-center gap-2 rounded-xl border border-gym/30 bg-gym/[.07] px-3 py-2.5">
                    <Avatar name={member.name} size={26} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-100">{member.name}</span>
                    <button
                      onClick={() => setMember(null)}
                      aria-label="Quitar socio"
                      className="rounded-md p-1 text-ink-400 transition hover:bg-white/5 hover:text-ink-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <Button variant="ghost" block icon={<Search className="h-3.5 w-3.5" />} onClick={() => setPickOpen(true)}>
                    Buscar socio · o deja público general
                  </Button>
                )}
              </div>

              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-ink-300">Total</span>
                <span className="text-[28px] font-bold text-gym tnum">{money0(total)}</span>
              </div>

              <Button
                variant="primary"
                size="lg"
                block
                loading={busy}
                disabled={cart.length === 0}
                icon={<Printer className="h-4 w-4" />}
                onClick={checkout}
              >
                Cobrar e imprimir
              </Button>

              <IfFeature feature="inventory">
                <p className="text-center text-[11.5px] text-ink-500">
                  Al cobrar se descuenta el inventario automáticamente.
                </p>
              </IfFeature>
              {!hasFeature('inventory') && (
                <Badge tone="neutral" className="w-full justify-center">
                  El descuento de inventario está en Business
                </Badge>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        title="Asociar la venta a un socio"
        description="Sirve para que la venta aparezca en su historial. No es obligatorio."
        size="md"
      >
        <MemberPicker
          onPick={(m) => {
            setMember({ id: m.id, name: m.name })
            setPickOpen(false)
          }}
        />
      </Modal>
    </div>
  )
}
