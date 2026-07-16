// Parser de la Caja Diaria FORMATO VIEJO (.xlsm, 2025 + ene-mar 2026).
// Cuadre en columnas M-N; egresos con columna Tipo (LOCAL=gasto, ADELANTO=descuento).
// Hojas "DD-MM [sufijo]". Año del path (/2025/ o /2026/), mes del nombre de hoja.
//   node import_caja_viejo.js --dry "<archivo.xlsm>"
//   node import_caja_viejo.js "<carpeta o archivos...>"
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import XLSX from 'xlsx'
import { supabase, money, getSedeMap } from './lib.js'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const paths = args.filter((a) => a !== '--dry')

const sedeDe = (n) => /miraflores/i.test(n) ? 'Miraflores' : /amazonas/i.test(n) ? 'Amazonas' : null
const clean = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const esDescuento = (tipo) => /adelanto|consumo|prestamo|descuento|comida/i.test(tipo || '')

// Busca una etiqueta en cualquier celda y devuelve el monto de la celda a su derecha
function buscarValor(rows, etiqueta) {
  for (const r of rows) for (let c = 0; c < r.length; c++) {
    if (clean(r[c]).startsWith(etiqueta)) { const m = money(r[c + 1]); if (m != null) return m }
  }
  return null
}

function parseHoja(nombre, rows, year) {
  const m = nombre.match(/^(\d{2})-(\d{2})\s*(.*)$/)
  if (!m) return null
  const [, dd, mm, suf] = m
  const fecha = `${year}-${mm}-${dd}`
  let turno = 'manana'
  if (/tarde/i.test(suf)) turno = 'tarde'
  else if (/noche/i.test(suf)) turno = 'noche'
  else if (/mañana|manana/i.test(suf)) turno = 'manana'
  else if (suf.trim()) turno = suf.trim().slice(0, 6).toLowerCase()  // inicial de cajero (Y/L/J...)

  let cajero = null
  for (const r of rows) if (clean(r[0]).startsWith('responsable') || clean(r[0]).startsWith('cajero')) { cajero = String(r[2] || '').trim() || null; break }

  const cab = {
    fecha, turno, cajero,
    tarjeta: buscarValor(rows, 'tarjeta'), plin: buscarValor(rows, 'plin'),
    yape_total: buscarValor(rows, 'yape'), efectivo: buscarValor(rows, 'efectivo'),
    gastos_tienda: buscarValor(rows, 'gastos'),
    venta_total: buscarValor(rows, 'total venta'), venta_sistema: buscarValor(rows, 'venta del sistema'),
    deficit_sobra: buscarValor(rows, 'deficit'),
  }

  // Egresos (izquierda cols 0-4 y tabla derecha cols 6-10): filas numeradas
  const gastos = [], descuentos = []
  for (const r of rows) {
    for (const base of [0, 6]) {
      const nro = String(r[base]).trim()
      if (!/^\d{1,2}$/.test(nro)) continue
      const desc = String(r[base + 1] || '').trim()
      const tipo = String(r[base + 2] || '').trim()
      const mo = money(r[base + 3])
      if (!desc || mo == null) continue
      if (esDescuento(tipo)) descuentos.push({ persona: desc, monto: mo, tipo: tipo.toUpperCase() })
      else gastos.push({ descripcion: desc, monto: mo, detalle: String(r[base + 4] || '').trim() || null })
    }
  }
  return { ...cab, _gastos: gastos, _descuentos: descuentos, _stock: [] }
}

function anioDe(file) {
  if (/[\\/]2025[\\/]/.test(file)) return 2025
  if (/[\\/]2026[\\/]/.test(file)) return 2026
  const y = file.match(/20(25|26)/); return y ? Number(y[0]) : 2025
}
function parseArchivo(file) {
  const wb = XLSX.readFile(file, { cellDates: false })
  const year = anioDe(file)
  const turnos = []
  for (const name of wb.SheetNames) {
    if (!/^\d{2}-\d{2}/.test(name)) continue
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
    const t = parseHoja(name, rows, year)
    if (t && (t.venta_total != null || t._gastos.length || t._descuentos.length)) turnos.push(t)
  }
  return turnos
}
function listar(p) {
  const st = statSync(p)
  if (st.isFile()) return [p]
  const out = []
  for (const f of readdirSync(p)) {
    if (f.startsWith('~$')) continue
    const full = join(p, f)
    if (statSync(full).isDirectory()) out.push(...listar(full))
    else if (/\.(xlsx|xlsm)$/i.test(f) && !/respaldo/i.test(f)) out.push(full)
  }
  return out
}

async function main() {
  const archivos = paths.flatMap(listar)
  if (DRY) {
    const file = archivos[0]
    const turnos = parseArchivo(file)
    console.log('Archivo:', file.split(/[\\/]/).pop(), '| Sede:', sedeDe(file), '| Turnos:', turnos.length)
    for (const t of turnos.slice(0, 4)) {
      console.log(`\n${t.fecha} ${t.turno} — ${t.cajero}`)
      console.log(`  Venta ${t.venta_total} sist ${t.venta_sistema} déf ${t.deficit_sobra} | Tarj ${t.tarjeta} Yape ${t.yape_total} Efec ${t.efectivo}`)
      console.log(`  Gastos(${t._gastos.length}): ${t._gastos.map(g => g.descripcion + ' ' + g.monto).join(', ')}`)
      console.log(`  Descuentos(${t._descuentos.length}): ${t._descuentos.map(d => d.persona + ' ' + d.monto + ' ' + d.tipo).join(', ')}`)
    }
    return
  }
  const sedes = await getSedeMap()
  let total = 0
  for (const file of archivos) {
    const sedeId = sedes[(sedeDe(file) || '').toLowerCase()]
    if (!sedeId) { console.log('· sin sede:', file.split(/[\\/]/).pop()); continue }
    const turnos = parseArchivo(file)
    for (const t of turnos) {
      const { _gastos, _descuentos, _stock, ...cab } = t
      const { data, error } = await supabase.from('caja_turno')
        .upsert({ ...cab, sede_id: sedeId, origen_archivo: file.split(/[\\/]/).pop() }, { onConflict: 'sede_id,fecha,turno' }).select('id').single()
      if (error) { console.error('✗', t.fecha, t.turno, error.message); continue }
      await supabase.from('caja_gastos').delete().eq('turno_id', data.id)
      await supabase.from('caja_descuentos').delete().eq('turno_id', data.id)
      if (_gastos.length) await supabase.from('caja_gastos').insert(_gastos.map(g => ({ ...g, turno_id: data.id })))
      if (_descuentos.length) await supabase.from('caja_descuentos').insert(_descuentos.map(d => ({ ...d, turno_id: data.id })))
      total++
    }
    console.log(`✓ ${(sedeDe(file) || '').padEnd(11)} ${file.split(/[\\/]/).pop().slice(0, 42).padEnd(42)} ${turnos.length} turnos`)
  }
  console.log(`\n✓ TOTAL: ${total} turnos`)
}
main().catch(e => { console.error(e); process.exit(1) })
