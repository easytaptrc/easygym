import type { Gym, GymSettings, Member, Payment, Visit } from '@/types'
import { fmtDate, fmtDateTime } from '@/lib/date'
import { money } from '@/lib/format'
import { BRAND } from '@/config/brand'
import { memberQrPayload, memberTag } from './members'

// ═══════════════════════════════════════════════════════════════════════════
// Impresión.
//
// En el prototipo: se abre una ventana con el documento y se llama a
// `window.print()`. Funciona hoy en cualquier navegador y con cualquier
// impresora instalada en el sistema.
//
// En producción, la app de recepción de Windows toma el mismo HTML y lo manda
// a una impresora térmica por ESC/POS, sin diálogo de impresión.
// ═══════════════════════════════════════════════════════════════════════════

export type Printable = 'receipt' | 'visit' | 'card' | 'contract'

interface PrintContext {
  gym: Gym
  settings: GymSettings | null
}

const styles = (width: string) => `
  @page { size: ${width === 'A4' ? 'A4' : `${width} auto`}; margin: ${width === 'A4' ? '18mm' : '4mm'}; }
  * { box-sizing: border-box; }
  body {
    font-family: ui-monospace, "Courier New", monospace;
    font-size: ${width === 'A4' ? '13px' : '12px'};
    color: #000; background: #fff; margin: 0;
    width: ${width === 'A4' ? 'auto' : width};
  }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  .lg { font-size: 1.35em; font-weight: 700; letter-spacing: -.02em; }
  .xl { font-size: 1.8em; font-weight: 800; letter-spacing: -.03em; }
  .muted { color: #555; font-size: .88em; }
  hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
  .card {
    border: 2px solid #000; border-radius: 10px; padding: 14px; width: 86mm; height: 54mm;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .qr { font-family: monospace; font-size: 8px; line-height: 8px; letter-spacing: 0; }
`

function openAndPrint(title: string, bodyHtml: string, width: string): void {
  const win = window.open('', '_blank', 'width=420,height=680')
  if (!win) {
    alert('Tu navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para imprimir.')
    return
  }
  win.document.write(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${title}</title><style>${styles(width)}</style></head><body>${bodyHtml}</body></html>`,
  )
  win.document.close()
  win.focus()
  // Espera un tick para que el layout se calcule antes de imprimir.
  setTimeout(() => {
    win.print()
    win.close()
  }, 220)
}

function header(gym: Gym): string {
  return `
    <div class="center">
      <div class="lg">${gym.name}</div>
      <div class="muted">${gym.address}</div>
      <div class="muted">${gym.city}, ${gym.state} · ${gym.phone}</div>
    </div>
    <hr />`
}

function footer(settings: GymSettings | null): string {
  return `
    <hr />
    <div class="center muted">
      ${settings?.payments.receiptFooter ?? '¡Gracias por tu preferencia!'}<br />
      Emitido con ${BRAND.name} · ${BRAND.domain}
    </div>`
}

// ─────────────────────────────── Documentos ─────────────────────────────────

export function printReceipt(ctx: PrintContext, payment: Payment, member?: Member | null): void {
  const w = ctx.settings?.printing.receiptWidth ?? '80mm'
  openAndPrint(
    `Recibo ${payment.id.slice(0, 8)}`,
    `
    ${header(ctx.gym)}
    <div class="center bold">RECIBO DE PAGO</div>
    <div class="center muted">Folio ${payment.id.slice(0, 10).toUpperCase()}</div>
    <hr />
    <div class="row"><span>Fecha</span><span>${fmtDateTime(payment.createdAt)}</span></div>
    ${member ? `<div class="row"><span>Socio</span><span>${member.name}</span></div>` : ''}
    ${member ? `<div class="row"><span>No. socio</span><span>${memberTag(member.memberNumber)}</span></div>` : ''}
    <div class="row"><span>Concepto</span><span>${payment.concept}</span></div>
    <div class="row"><span>Método</span><span>${payment.method.toUpperCase()}</span></div>
    ${payment.transactionId ? `<div class="row"><span>Transacción</span><span>${payment.transactionId}</span></div>` : ''}
    <hr />
    <div class="row xl"><span>TOTAL</span><span>${money(payment.amount)}</span></div>
    ${member?.expiresAt ? `<hr /><div class="center">Membresía vigente hasta<br /><span class="bold">${fmtDate(member.expiresAt)}</span></div>` : ''}
    ${footer(ctx.settings)}
  `,
    w,
  )
}

export function printVisitTicket(ctx: PrintContext, visit: Visit): void {
  const w = ctx.settings?.printing.receiptWidth ?? '80mm'
  openAndPrint(
    `Visita ${visit.id.slice(0, 8)}`,
    `
    ${header(ctx.gym)}
    <div class="center bold">PASE DE VISITA</div>
    <div class="center muted">Válido únicamente el día de hoy</div>
    <hr />
    <div class="row"><span>Nombre</span><span>${visit.name}</span></div>
    <div class="row"><span>Fecha</span><span>${visit.date}</span></div>
    <div class="row"><span>Hora</span><span>${visit.time}</span></div>
    <div class="row"><span>Método</span><span>${visit.method.toUpperCase()}</span></div>
    <hr />
    <div class="row xl"><span>TOTAL</span><span>${money(visit.amount)}</span></div>
    <hr />
    <div class="center muted">Folio ${visit.id.slice(0, 10).toUpperCase()}</div>
    ${footer(ctx.settings)}
  `,
    w,
  )
}

export function printMemberCard(ctx: PrintContext, member: Member): void {
  openAndPrint(
    `Credencial ${member.name}`,
    `
    <div class="card">
      <div>
        <div class="bold lg">${ctx.gym.name}</div>
        <div class="muted">CREDENCIAL DE SOCIO</div>
      </div>
      <div>
        <div class="bold" style="font-size:1.2em">${member.name}</div>
        <div class="muted">${memberTag(member.memberNumber)}</div>
      </div>
      <div class="row">
        <div>
          <div class="muted">Vigencia</div>
          <div class="bold">${member.expiresAt ? fmtDate(member.expiresAt) : '—'}</div>
        </div>
        <div class="right">
          <div class="muted">Código</div>
          <div class="qr">${memberQrPayload(member)}</div>
        </div>
      </div>
    </div>
    <div class="muted center" style="width:86mm;margin-top:6px">Emitida con ${BRAND.name}</div>
  `,
    'A4',
  )
}

export function printContract(ctx: PrintContext, member: Member, planName: string, price: number): void {
  openAndPrint(
    `Contrato ${member.name}`,
    `
    ${header(ctx.gym)}
    <div class="center bold lg">CONTRATO DE MEMBRESÍA</div>
    <hr />
    <p>En <b>${ctx.gym.city}, ${ctx.gym.state}</b>, a ${fmtDate(Date.now())}, <b>${ctx.gym.name}</b>
    (en adelante «el Gimnasio») y <b>${member.name}</b> (en adelante «el Socio»)
    celebran el presente contrato de prestación de servicios deportivos.</p>

    <p><b>PRIMERA · Objeto.</b> El Gimnasio otorga al Socio el derecho de acceso y uso de sus
    instalaciones bajo la modalidad <b>${planName}</b>, con vigencia del
    ${member.startsAt ? fmtDate(member.startsAt) : '—'} al ${member.expiresAt ? fmtDate(member.expiresAt) : '—'}.</p>

    <p><b>SEGUNDA · Contraprestación.</b> El Socio cubre la cantidad de <b>${money(price)}</b> por el periodo señalado.</p>

    <p><b>TERCERA · Identificación.</b> El acceso es personal e intransferible y se verifica mediante
    credencial, código QR o huella digital registrada.</p>

    <p><b>CUARTA · Datos biométricos.</b> En caso de registrar huella digital, el Gimnasio almacena
    únicamente una plantilla matemática irreversible. No se conserva imagen alguna de la huella.</p>

    <p><b>QUINTA · Reglamento.</b> El Socio declara conocer y aceptar el reglamento interno,
    los horarios y las políticas de cancelación de clases vigentes.</p>

    <br /><br />
    <table>
      <tr>
        <td class="center">_______________________<br />El Gimnasio</td>
        <td class="center">_______________________<br />${member.name}</td>
      </tr>
    </table>
    ${footer(ctx.settings)}
  `,
    'A4',
  )
}

/** Imprime lo que haya en pantalla (reportes, listados). */
export function printCurrentView(): void {
  window.print()
}
