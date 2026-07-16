// Importa ventas del POS mapeando columnas por NOMBRE de encabezado.
// Sirve para el formato de julio (con Tipo pago) y el histórico 2025 (sin él).
//   node import_ventas_historico.js "<archivo.xlsx>" [Sede]
import XLSX from 'xlsx'
import { supabase, money, getSedeMap } from './lib.js'

const [, , file, sedeArg = 'Amazonas'] = process.argv
if (!file) { console.error('Falta el archivo'); process.exit(1) }

function parseFechaHora(s) {
  const m = String(s).match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!m) return null
  let [, dd, mm, yyyy, h, min, ap] = m; h = Number(h); ap = ap.toUpperCase()
  if (ap === 'PM' && h !== 12) h += 12; if (ap === 'AM' && h === 12) h = 0
  return new Date(`${yyyy}-${mm}-${dd}T${String(h).padStart(2, '0')}:${min}:00`)
}
function parseCanal(v) {
  const s = String(v || '').toUpperCase()
  if (s.startsWith('SALON')) return { canal: 'SALON', mesa: (s.match(/MESA:\s*(.+)$/) || [])[1]?.trim() || null }
  if (s.startsWith('DELIVERY')) return { canal: 'DELIVERY', mesa: null }
  if (s.startsWith('MOSTRADOR')) return { canal: 'MOSTRADOR', mesa: null }
  return { canal: s || null, mesa: null }
}
const limpiaDoc = (v) => String(v || '').replace(/^(NOTA DE VENTA|BOLETA DE VENTA|TICKET)/i, '').trim() || null

async function main() {
  const sedes = await getSedeMap()
  const sedeId = sedes[sedeArg.toLowerCase()]
  if (!sedeId) { console.error('Sede inválida:', sedeArg, Object.keys(sedes)); process.exit(1) }

  console.log('Leyendo', file, '...')
  const wb = XLSX.readFile(file, { cellDates: false })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
  const H = rows[0].map((h) => String(h).trim().toLowerCase())
  const col = (name) => H.findIndex((h) => h === name)
  const colIni = (name) => H.findIndex((h) => h.startsWith(name))
  const iF = col('fecha'), iCaja = col('caja'), iCli = col('cliente'), iDoc = col('documento'),
        iCanal = col('canal venta'), iPago = col('tipo pago'), iTot = colIni('total'), iEst = col('estado')

  const filas = []
  const vistos = new Set()
  let dup = 0
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r || !r[iF]) continue
    const dt = parseFechaHora(r[iF]); if (!dt) continue
    const { canal, mesa } = parseCanal(r[iCanal])
    const documento = limpiaDoc(r[iDoc])
    const clave = documento || `${dt.toISOString()}-${i}`
    if (vistos.has(clave)) { dup++; continue }   // evita choque dentro del mismo archivo
    vistos.add(clave)
    filas.push({
      sede_id: sedeId, vendido_en: dt.toISOString(), fecha: dt.toISOString().slice(0, 10),
      caja: (r[iCaja] || '').toString().trim() || null, cliente: (r[iCli] || '').toString().trim() || null,
      documento, canal, mesa,
      tipo_pago: iPago >= 0 ? ((r[iPago] || '').toString().trim() || null) : null,
      total: money(r[iTot]), estado: (r[iEst] || '').toString().trim() || null,
      origen_archivo: file.split(/[\\/]/).pop(),
    })
  }
  console.log(`Tickets a cargar: ${filas.length}${dup ? ` (${dup} docs duplicados en el archivo, omitidos)` : ''}`)

  let ok = 0
  for (let i = 0; i < filas.length; i += 1000) {
    const lote = filas.slice(i, i + 1000)
    const { error } = await supabase.from('ventas').upsert(lote, { onConflict: 'sede_id,documento' })
    if (error) { console.error('\n✗', error.message); throw error }
    ok += lote.length; process.stdout.write(`\r  cargados: ${ok}/${filas.length}`)
  }
  process.stdout.write('\n✓ Listo\n')
}
main().catch(e => { console.error(e); process.exit(1) })
