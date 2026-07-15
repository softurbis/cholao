// Importa los dos reportes del POS a Supabase.
//   node import_ventas_pos.js "<Reporte de ventas.xlsx>" "<Ventas por producto.xlsx>" [Sede]
// La sede se pasa por argumento (el export no la trae). Default: Amazonas.
import XLSX from 'xlsx'
import { supabase, money, insertChunked, getSedeMap } from './lib.js'

const [, , fileVentas, fileProductos, sedeArg = 'Amazonas'] = process.argv

// "15-07-2026 3:49 PM" -> ISO
function parseFechaHora(s) {
  const m = String(s).match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!m) return null
  let [, dd, mm, yyyy, h, min, ap] = m
  h = Number(h); ap = ap.toUpperCase()
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return new Date(`${yyyy}-${mm}-${dd}T${String(h).padStart(2,'0')}:${min}:00`)
}
function parseCanal(v) {
  const s = String(v || '').toUpperCase()
  if (s.startsWith('SALON')) {
    const mesa = (s.match(/MESA:\s*(.+)$/) || [])[1] || null
    return { canal: 'SALON', mesa: mesa ? mesa.trim() : null }
  }
  if (s.startsWith('DELIVERY')) return { canal: 'DELIVERY', mesa: null }
  if (s.startsWith('MOSTRADOR')) return { canal: 'MOSTRADOR', mesa: null }
  return { canal: s || null, mesa: null }
}
function limpiaDoc(v) {
  return String(v || '').replace(/^NOTA DE VENTA/i, '').trim() || null
}
function rangoDeHoja(nombre) {
  const fechas = [...String(nombre).matchAll(/(\d{2})-(\d{2})-(\d{4})/g)]
  const toISO = m => `${m[3]}-${m[2]}-${m[1]}`
  return { ini: fechas[0] ? toISO(fechas[0]) : null, fin: fechas[1] ? toISO(fechas[1]) : null }
}

async function main() {
  const sedes = await getSedeMap()
  const sedeId = sedes[sedeArg.toLowerCase()]
  if (!sedeId) { console.error(`Sede "${sedeArg}" no existe. Opciones:`, Object.keys(sedes)); process.exit(1) }
  console.log(`Sede: ${sedeArg} (${sedeId})`)

  // ---- Reporte de ventas (ticket a ticket) ----
  if (fileVentas) {
    const wb = XLSX.readFile(fileVentas)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    const filas = []
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      if (!r || !r[0]) continue
      const dt = parseFechaHora(r[0]); if (!dt) continue
      const { canal, mesa } = parseCanal(r[4])
      filas.push({
        sede_id: sedeId,
        vendido_en: dt.toISOString(),
        fecha: dt.toISOString().slice(0, 10),
        caja: r[1] || null,
        cliente: r[2] || null,
        documento: limpiaDoc(r[3]),
        canal, mesa,
        tipo_pago: (r[5] || '').toString().trim() || null,
        total: money(r[6]),
        estado: (r[7] || '').toString().trim() || null,
        origen_archivo: fileVentas.split(/[\\/]/).pop(),
      })
    }
    console.log(`Reporte de ventas: ${filas.length} tickets`)
    // upsert para no duplicar si se re-corre (unique sede_id+documento)
    let ok = 0
    for (let i = 0; i < filas.length; i += 500) {
      const lote = filas.slice(i, i + 500)
      const { error } = await supabase.from('ventas').upsert(lote, { onConflict: 'sede_id,documento' })
      if (error) { console.error('  ✗', error.message); throw error }
      ok += lote.length; process.stdout.write(`\r  ventas: ${ok}/${filas.length}`)
    }
    process.stdout.write('\n')
  }

  // ---- Ventas por producto (agregado) ----
  if (fileProductos) {
    const wb = XLSX.readFile(fileProductos)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const { ini, fin } = rangoDeHoja(wb.SheetNames[0])
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    const filas = []
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      if (!r || !r[1]) continue
      filas.push({
        sede_id: sedeId, periodo_ini: ini, periodo_fin: fin,
        categoria: r[0] || null, producto: r[1] || null, presentacion: r[2] || null,
        cant_salon: money(r[3]) || 0, cant_mostrador: money(r[4]) || 0, cant_delivery: money(r[5]) || 0,
        cant_total: money(r[6]) || 0, precio_venta: money(r[7]), total: money(r[8]),
        origen_archivo: fileProductos.split(/[\\/]/).pop(),
      })
    }
    console.log(`Ventas por producto: ${filas.length} filas (periodo ${ini} → ${fin})`)
    await insertChunked('ventas_productos', filas)
  }

  console.log('✓ Listo')
}
main().catch(e => { console.error(e); process.exit(1) })
