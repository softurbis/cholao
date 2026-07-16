// Parsea el texto del PDF "ARQUEO DE CAJA" del POS y extrae los datos del turno.
// Se usa en el cierre: el cajero sube el PDF y el sistema jala la venta del sistema
// y el desglose de pagos automáticamente (sin tipear).

const num = (s) => {
  if (s == null) return null
  const n = Number(String(s).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}
const buscar = (txt, re) => { const m = txt.match(re); return m ? m[1].trim() : null }

// "16-07-2026" -> "2026-07-16"
function fechaISO(s) {
  const m = String(s || '').match(/(\d{2})-(\d{2})-(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

export function parseArqueo(texto) {
  const t = String(texto || '').replace(/\r/g, '')
  if (!/ARQUEO DE CAJA/i.test(t)) return { ok: false, error: 'El PDF no parece un Arqueo de Caja del POS.' }

  // Sección "== VENTAS ==" (para no confundir con "VENTAS EN EFECTIVO" de arriba)
  const secVentas = (t.split(/==\s*VENTAS\s*==/i)[1] || '').split(/==\s*OTRAS/i)[0] || ''
  const filaVenta = (etiqueta) => {
    const m = secVentas.match(new RegExp(etiqueta + '\\s+(\\d+)\\s+([\\d.,]+)', 'i'))
    return m ? { oper: Number(m[1]), total: num(m[2]) } : { oper: 0, total: 0 }
  }
  const efectivo = filaVenta('EFECTIVO')
  const tarjeta = filaVenta('TARJETA')
  const yape = filaVenta('YAPE')
  const plin = filaVenta('PLIN')

  const turnoTxt = buscar(t, /TURNO:\s*(.+)/i) || ''
  const faltanteM = t.match(/(Faltante|Sobrante)\s*=\s*([\d.,]+)/i)

  return {
    ok: true,
    corte: buscar(t, /CORTE DE TURNO\s*#?\s*(\S+)/i),
    estado: buscar(t, /ESTADO:\s*(.+)/i),
    cajero: buscar(t, /CAJERO:\s*(.+)/i),
    caja: buscar(t, /CAJA:\s*(.+)/i),
    turno_texto: turnoTxt,
    turno: /primer/i.test(turnoTxt) ? 'manana' : /segundo/i.test(turnoTxt) ? 'tarde' : null,
    fecha: fechaISO(buscar(t, /FECHA APERTURA:\s*([\d-]+)/i)),
    hora_apertura: buscar(t, /FECHA APERTURA:\s*[\d-]+\s+(.+)/i),
    hora_cierre: buscar(t, /FECHA CIERRE:\s*[\d-]+\s+(.+)/i),

    // Dinero en caja (según el POS)
    apertura_caja: num(buscar(t, /APERTURA DE CAJA:\s*([\d.,]+)/i)),
    ventas_efectivo: num(buscar(t, /VENTAS EN EFECTIVO:\s*\+?\s*([\d.,]+)/i)),
    efectivo_en_caja: num(buscar(t, /EFECTIVO EN CAJA:\s*=?\s*([\d.,]+)/i)),
    efectivo_en_cierre: num(buscar(t, /EFECTIVO EN CIERRE:\s*([\d.,]+)/i)),
    diferencia_pos: faltanteM ? (/faltante/i.test(faltanteM[1]) ? -num(faltanteM[2]) : num(faltanteM[2])) : null,

    // Ventas por medio de pago (según el sistema)
    sis_efectivo: efectivo.total, sis_efectivo_op: efectivo.oper,
    sis_tarjeta: tarjeta.total, sis_tarjeta_op: tarjeta.oper,
    sis_yape: yape.total, sis_yape_op: yape.oper,
    sis_plin: plin.total,
    venta_sistema: num(buscar(t, /TOTAL VENTAS\s*=\s*([\d.,]+)/i)),

    // Otras operaciones
    descuentos: num(buscar(t, /DESCUENTOS\s+\d+\s+([\d.,]+)/i)),
    cortesias: num(buscar(t, /CORTESIAS\s+\d+\s+([\d.,]+)/i)),
    propinas: num(buscar(t, /TOTAL PROPINAS\s*([\d.,]+)/i)),
  }
}
