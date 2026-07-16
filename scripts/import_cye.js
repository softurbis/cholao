// Parser del "Reporte CyE" de Juan (Compras y Entregas + cuadre del fondo).
// Hojas "DD-MM-YYYY C" (compras + cuadre financiero) y "DD-MM-YYYY E" (entregas).
//   node import_cye.js --dry "<archivo.xlsx>"
//   node import_cye.js "<archivos o carpetas...>"
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import XLSX from 'xlsx'
import { supabase, money, getSedeMap } from './lib.js'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const paths = args.filter((a) => a !== '--dry')

const clean = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

// "10." -> 10 ; "1/2" -> 0.5 ; "-" -> null ; "300." -> 300
function cantidad(v) {
  const s = String(v || '').trim()
  if (!s || s === '-') return null
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  const n = Number(s.replace(/[^\d.]/g, '').replace(/\.$/, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}
function buscarValor(rows, etiqueta) {
  for (const r of rows) for (let c = 0; c < r.length; c++) {
    if (clean(r[c]).includes(etiqueta)) { const m = money(r[c + 1]); if (m != null) return m }
  }
  return null
}
function fechaDe(nombre) {
  const m = nombre.match(/(\d{2})-(\d{2})-(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
// Mes/año del NOMBRE DE ARCHIVO viejo: "Reporte compras ENERO31.xlsx" -> 2026-01
const MESES = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' }
function mesDeArchivo(file) {
  const low = clean(file)
  for (const m in MESES) if (low.includes(m)) {
    const y = file.match(/20(2\d)/) ? file.match(/20(2\d)/)[0] : '2026'
    return `${y}-${MESES[m]}`
  }
  return null
}

function parseCompras(rows, fecha, sedes) {
  const compras = []
  for (const r of rows) {
    if (!/^\d{1,3}$/.test(String(r[0]).trim())) continue
    const monto = money(r[6])
    const producto = String(r[3] || '').trim()
    if (!producto || monto == null || monto === 0) continue
    const cant = cantidad(r[2])
    const sedeTxt = clean(r[7])
    let precio, cantFinal, nota = null
    if (cant && Math.abs(Math.round((monto / cant) * 100) / 100 * cant - monto) < 0.01) {
      cantFinal = cant; precio = Math.round((monto / cant) * 100) / 100
    } else {
      cantFinal = 1; precio = monto
      if (cant) nota = `cant real: ${r[2]}`
    }
    // comprobante va en nota mientras no exista la columna (pendiente ALTER de sql/11)
    const comp = String(r[5] || '').trim()
    const notas = [nota, comp && comp !== '-' ? `comp: ${comp}` : null].filter(Boolean).join(' · ') || null
    compras.push({
      fecha, nombre_libre: producto, cantidad: cantFinal, unidad: String(r[4] || '').trim() || null,
      precio_unitario: precio, proveedor: String(r[1] || '').trim() || null,
      destino_sede_id: sedes[sedeTxt] || null,
      condicion_pago: 'contado', estado_pago: 'pagado', fecha_pago: fecha, nota: notas,
    })
  }
  const cuadre = {
    fecha,
    base_inicial: buscarValor(rows, 'base inici'),
    // nuevo: "Efectivo Mañana/Tarde"; viejo: "Adicionales"+"Efectivo"
    efectivo_manana: buscarValor(rows, 'efectivo m') ?? buscarValor(rows, 'adicionales'),
    efectivo_tarde: buscarValor(rows, 'efectivo t'),
    yape: buscarValor(rows, 'yape'),
    transferencia: buscarValor(rows, 'transferen'),
    dinero_total: buscarValor(rows, 'dinero tot'),
    gasto_total: buscarValor(rows, 'gasto t'),      // "Gasto Total" o "Gasto T"
    entrega_admin: buscarValor(rows, 'entrega a '),
    vuelto_saldo: buscarValor(rows, 'vuelto'),
  }
  let responsable = null
  for (const r of rows) for (let c = 0; c < 4; c++) {
    if (clean(r[c]).includes('responsabl')) { responsable = String(r[c + 1] || r[c + 2] || '').trim() || null; break }
  }
  cuadre.responsable = responsable
  return { compras, cuadre }
}

function parseEntregas(rows, fecha, sedes) {
  const out = []
  for (const r of rows) {
    if (!/^\d{1,3}$/.test(String(r[0]).trim())) continue
    const producto = String(r[2] || '').trim()
    const total = money(r[6])
    if (!producto || total == null) continue
    out.push({
      fecha, producto, presentacion: String(r[3] || '').trim() || null,
      cantidad: cantidad(r[1]), sede_id: sedes[clean(r[4])] || null,
      precio_unit: money(r[5]), total,
    })
  }
  return out
}

function parseArchivo(file, sedes) {
  const wb = XLSX.readFile(file, { cellDates: false })
  const res = { compras: [], cuadres: [], entregas: [] }
  const mesArchivo = mesDeArchivo(file)
  for (const name of wb.SheetNames) {
    let fecha = fechaDe(name)
    let tipo = null
    // Formato viejo: hojas "1C"/"1E" (día + C/E), mes sale del nombre del archivo
    const viejo = name.trim().match(/^(\d{1,2})\s*(C|E)$/i)
    if (!fecha && viejo && mesArchivo) {
      fecha = `${mesArchivo}-${String(viejo[1]).padStart(2, '0')}`
      tipo = viejo[2].toUpperCase()
    } else if (fecha) {
      if (/\bC$/i.test(name.trim())) tipo = 'C'
      else if (/\bE$/i.test(name.trim())) tipo = 'E'
    }
    if (!fecha || !tipo) continue
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
    if (tipo === 'C') {
      const { compras, cuadre } = parseCompras(rows, fecha, sedes)
      res.compras.push(...compras); res.cuadres.push(cuadre)
    } else {
      res.entregas.push(...parseEntregas(rows, fecha, sedes))
    }
  }
  return res
}

function listar(p) {
  const st = statSync(p)
  if (st.isFile()) return [p]
  const out = []
  for (const f of readdirSync(p)) {
    if (f.startsWith('~$')) continue
    const full = join(p, f)
    if (statSync(full).isDirectory()) out.push(...listar(full))
    else if (/reporte cye.*\.xlsx$/i.test(f)) out.push(full)
  }
  return out
}

async function main() {
  const sedesRaw = await getSedeMap()
  const sedes = {}
  for (const k in sedesRaw) sedes[clean(k)] = sedesRaw[k]

  const archivos = paths.flatMap(listar)
  for (const file of archivos) {
    const base = file.split(/[\\/]/).pop()
    const { compras, cuadres, entregas } = parseArchivo(file, sedes)
    const totC = compras.reduce((a, c) => a + c.cantidad * c.precio_unitario, 0)
    const totE = entregas.reduce((a, e) => a + Number(e.total || 0), 0)
    console.log(`${base}: ${cuadres.length} días · ${compras.length} compras S/${totC.toFixed(2)} · ${entregas.length} entregas S/${totE.toFixed(2)}`)
    if (DRY) {
      console.log('  Muestra compra:', JSON.stringify(compras[0]))
      console.log('  Muestra cuadre:', JSON.stringify(cuadres[0]))
      console.log('  Muestra entrega:', JSON.stringify(entregas[0]))
      continue
    }
    // idempotente: compras por rango de fechas del archivo (tabla sin origen_archivo aún);
    // entregas sí tienen origen_archivo
    const fechas = compras.map(c => c.fecha).sort()
    if (fechas.length) {
      await supabase.from('compras').delete().gte('fecha', fechas[0]).lte('fecha', fechas[fechas.length - 1])
    }
    await supabase.from('entregas').delete().eq('origen_archivo', base)
    for (let i = 0; i < compras.length; i += 500)
      await supabase.from('compras').insert(compras.slice(i, i + 500)).then(({ error }) => { if (error) throw new Error('compras: ' + error.message) })
    for (let i = 0; i < entregas.length; i += 500)
      await supabase.from('entregas').insert(entregas.slice(i, i + 500).map(e => ({ ...e, origen_archivo: base }))).then(({ error }) => { if (error) throw new Error('entregas: ' + error.message) })
    for (const q of cuadres) {
      const { error } = await supabase.from('fondo_compras_dia').upsert({ ...q, origen_archivo: base }, { onConflict: 'fecha' })
      if (error) throw new Error('fondo: ' + error.message)
    }
  }
  if (!DRY) console.log('✓ Listo')
}
main().catch(e => { console.error(e); process.exit(1) })
