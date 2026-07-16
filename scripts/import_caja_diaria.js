// Parser de la Caja Diaria por turno (mañana/tarde).
//   node import_caja_diaria.js --dry "<archivo.xlsx>"      -> parsea 1 archivo y muestra
//   node import_caja_diaria.js "<carpeta o archivo>" ...   -> carga a Supabase
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import XLSX from 'xlsx'
import { supabase, money, getSedeMap } from './lib.js'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const paths = args.filter((a) => a !== '--dry')

const sedeDe = (nombre) => /miraflores/i.test(nombre) ? 'Miraflores' : /amazonas/i.test(nombre) ? 'Amazonas' : null
const norm = (s) => String(s || '').trim().toLowerCase()
// Limpia etiquetas: quita emojis/símbolos y acentos, deja solo letras y espacios
const clean = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

// Encuentra el valor del cuadre buscando una etiqueta (limpia) en la col F (idx 5), valor en col G (idx 6)
function cuadreVal(rows, etiqueta, exacto = false) {
  for (const r of rows) {
    const c = clean(r[5])
    if (exacto ? c === etiqueta : c.startsWith(etiqueta)) return { monto: money(r[6]), estado: String(r[7] || '').trim() }
  }
  return { monto: null, estado: '' }
}
function cuadreTexto(rows, etiqueta) {
  for (const r of rows) if (clean(r[5]).startsWith(etiqueta)) return String(r[6] || '').trim()
  return null
}

function parseHojaTurno(nombreHoja, rows) {
  const m = nombreHoja.match(/(\d{2})-(\d{2})-(\d{4}).*(Manana|Mañana|Tarde|Noche)/i)
  if (!m) return null
  const fecha = `${m[3]}-${m[2]}-${m[1]}`
  const turno = /tarde/i.test(m[4]) ? 'tarde' : /noche/i.test(m[4]) ? 'noche' : 'manana'

  // Cajero (fila con "Cajero:" o "Responsable:")
  let cajero = null
  for (const r of rows) if (clean(r[0]).startsWith('cajero') || clean(r[0]).startsWith('responsable')) { cajero = String(r[2] || '').trim() || null; break }

  // Cuadre de pagos (lado derecho)
  const tarjeta = cuadreVal(rows, 'tarjeta').monto
  const plin = cuadreVal(rows, 'plin').monto
  const yapeQr = cuadreVal(rows, 'yape qr').monto
  const yapeFotos = cuadreVal(rows, 'yape fotos').monto
  // "YAPE TOTAL" (formato nuevo) o un solo "Yape" (formato Abril con emojis)
  const yapeTotal = cuadreVal(rows, 'yape total').monto ?? cuadreVal(rows, 'yape', true).monto
  const efectivo = cuadreVal(rows, 'efectivo').monto
  const ventaTotal = cuadreVal(rows, 'total venta').monto
  const ventaSistema = cuadreVal(rows, 'venta del sistema').monto
  const gastosAuto = cuadreVal(rows, 'gastos').monto
  const def = cuadreVal(rows, 'deficit')
  const deficitSobra = def.monto == null ? null : (/sobra/i.test(def.estado) ? def.monto : -def.monto)
  const meta = cuadreVal(rows, 'meta turno').monto
  const rendimiento = cuadreTexto(rows, 'rendimiento')
  const clima = cuadreTexto(rows, 'clima')

  // Secciones de la izquierda: ubicar encabezados
  const idxGastos = rows.findIndex((r) => /egresos/.test(clean(r[0])) && /gast/.test(clean(r[0]) + clean(r[1])))
  const idxDesc = rows.findIndex((r) => /egresos/.test(clean(r[0])) && /descue/.test(clean(r[0]) + clean(r[1])))
  const idxStock = rows.findIndex((r) => clean(r[0]).startsWith('control de stock'))

  // Gastos tienda: filas numeradas entre idxGastos y idxDesc
  const gastos = []
  for (let i = idxGastos + 2; i < (idxDesc > 0 ? idxDesc : rows.length); i++) {
    const r = rows[i]; if (!r) continue
    if (norm(r[0]) === 'total') break
    const mo = money(r[2])
    if (r[1] && mo != null) gastos.push({ descripcion: String(r[1]).trim(), monto: mo, detalle: String(r[3] || '').trim() || null })
  }
  // Descuentos a personal: filas entre idxDesc y idxStock
  const descuentos = []
  if (idxDesc > 0) for (let i = idxDesc + 2; i < (idxStock > 0 ? idxStock : rows.length); i++) {
    const r = rows[i]; if (!r) continue
    if (norm(r[0]) === 'total') break
    const mo = money(r[2])
    if (r[1] && mo != null) descuentos.push({ persona: String(r[1]).trim(), monto: mo, tipo: String(r[3] || '').trim().toUpperCase() || null })
  }
  // Stock: filas después de "PRODUCTO" hasta "TOTALES"
  const stock = []
  if (idxStock > 0) {
    let h = -1
    for (let i = idxStock; i < rows.length; i++) if (norm(rows[i][1]) === 'producto') { h = i; break }
    if (h > 0) for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue
      if (norm(r[0]) === 'totales' || norm(r[1]).startsWith('comparacion')) break
      if (r[1]) stock.push({ producto: String(r[1]).trim(), inicio: money(r[2]), adicion: money(r[3]), salida: money(r[4]), cierre: money(r[7]), vendido: money(r[8]) })
    }
  }

  return {
    fecha, turno, cajero,
    tarjeta, plin, yape_qr: yapeQr, yape_fotos: yapeFotos, yape_total: yapeTotal, efectivo,
    gastos_tienda: gastosAuto, venta_total: ventaTotal, venta_sistema: ventaSistema,
    deficit_sobra: deficitSobra, meta_turno: meta, rendimiento, clima,
    _gastos: gastos, _descuentos: descuentos, _stock: stock,
  }
}

function parseArchivo(file) {
  const wb = XLSX.readFile(file, { cellDates: false })
  const turnos = []
  for (const name of wb.SheetNames) {
    if (!/\d{2}-\d{2}-\d{4}/.test(name)) continue  // solo hojas diarias
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
    const t = parseHojaTurno(name, rows)
    if (t) turnos.push(t)
  }
  return turnos
}

// ---- main ----
function listarArchivos(p) {
  const st = statSync(p)
  if (st.isFile()) return [p]
  const out = []
  for (const f of readdirSync(p)) {
    const full = join(p, f)
    if (f.startsWith('~$')) continue
    if (statSync(full).isDirectory()) out.push(...listarArchivos(full))
    else if (/\.(xlsx|xlsm)$/i.test(f) && !/respaldo/i.test(f)) out.push(full)
  }
  return out
}

async function main() {
  const archivos = paths.flatMap(listarArchivos)
  if (DRY) {
    const file = archivos[0]
    const sede = sedeDe(file)
    const turnos = parseArchivo(file)
    console.log('Archivo:', file.split(/[\\/]/).pop(), '| Sede:', sede, '| Turnos:', turnos.length)
    for (const t of turnos.slice(0, 3)) {
      console.log(`\n${t.fecha} ${t.turno} — cajero ${t.cajero}`)
      console.log(`  Venta total ${t.venta_total} | sistema ${t.venta_sistema} | déf/sobra ${t.deficit_sobra} | meta ${t.meta_turno}`)
      console.log(`  Tarjeta ${t.tarjeta} Plin ${t.plin} YapeQR ${t.yape_qr} YapeFotos ${t.yape_fotos} Efec ${t.efectivo}`)
      console.log(`  Gastos(${t._gastos.length}):`, t._gastos.map(g => `${g.descripcion} ${g.monto}`).join(', '))
      console.log(`  Descuentos(${t._descuentos.length}):`, t._descuentos.map(d => `${d.persona} ${d.monto} ${d.tipo}`).join(', '))
      console.log(`  Stock filas: ${t._stock.length}`)
    }
    return
  }

  const sedes = await getSedeMap()
  let totalT = 0
  for (const file of archivos) {
    const sedeNombre = sedeDe(file)
    const sedeId = sedes[(sedeNombre || '').toLowerCase()]
    if (!sedeId) { console.log('· (sin sede, omito)', file.split(/[\\/]/).pop()); continue }
    const turnos = parseArchivo(file)
    for (const t of turnos) {
      const { _gastos, _descuentos, _stock, ...cab } = t
      const { data, error } = await supabase.from('caja_turno')
        .upsert({ ...cab, sede_id: sedeId, origen_archivo: file.split(/[\\/]/).pop() }, { onConflict: 'sede_id,fecha,turno' })
        .select('id').single()
      if (error) { console.error('✗', t.fecha, t.turno, error.message); continue }
      const tid = data.id
      await supabase.from('caja_gastos').delete().eq('turno_id', tid)
      await supabase.from('caja_descuentos').delete().eq('turno_id', tid)
      await supabase.from('caja_stock').delete().eq('turno_id', tid)
      if (_gastos.length) await supabase.from('caja_gastos').insert(_gastos.map(g => ({ ...g, turno_id: tid })))
      if (_descuentos.length) await supabase.from('caja_descuentos').insert(_descuentos.map(d => ({ ...d, turno_id: tid })))
      if (_stock.length) await supabase.from('caja_stock').insert(_stock.map(s => ({ ...s, turno_id: tid })))
      totalT++
    }
    console.log(`✓ ${sedeNombre.padEnd(11)} ${file.split(/[\\/]/).pop().slice(0, 40).padEnd(40)} ${turnos.length} turnos`)
  }
  console.log(`\n✓ TOTAL: ${totalT} turnos cargados`)
}
main().catch(e => { console.error(e); process.exit(1) })
