// Carga el ledger de gastos 2026 (Fecha · Concepto · Monto) a la tabla gastos.
//   node import_gastos_2026.js "<ruta xlsx>"
import XLSX from 'xlsx'
import { supabase, money } from './lib.js'

const file = process.argv[2] || 'C:/Users/Usuario/Downloads/GASTOS 2026 DE ENERO A 15 DE JULIO.xlsx'

// M/D/YY -> Date. Corrige año '06' -> 2026 (error de tipeo). Devuelve {fecha, flag}
function parseFecha(s) {
  s = String(s).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    let [, mo, d, y] = m
    y = Number(y); if (y < 100) y = 2000 + y
    if (y !== 2026) y = 2026        // corrige 2006 -> 2026
    return { fecha: `2026-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, flag: null }
  }
  // "0603/26" roto -> asume 06/03 (6-mar), marca para confirmar
  const b = s.match(/^(\d{2})(\d{2})\/(\d{2})$/)
  if (b) return { fecha: `2026-${b[1]}-${b[2]}`, flag: 'fecha ambigua (era "' + s + '")' }
  return { fecha: null, flag: 'sin fecha' }
}

function categoria(c) {
  c = c.toLowerCase()
  if (/sueldo|adelanto|planilla|a cuenta|gratific/.test(c)) return 'planilla'
  if (/prestamo|préstamo|presta|tarjeta|cuota|deuda|retiro|interes|tia|tía/.test(c)) return 'deuda_retiro'
  if (/luz|agua|internet|gas|alquiler|marketing|piwi|worldspace|google|celular|recarga|contador|servicio/.test(c)) return 'admin_gerencial'
  return 'compras'
}

async function main() {
  const wb = XLSX.readFile(file, { cellDates: false })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Hoja1'], { header: 1, raw: false, defval: '' })

  const filas = []
  const problemas = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const concepto = String(r[1] || '').trim()
    const monto = money(r[2])
    // fila total (sin fecha ni concepto, solo monto grande)
    if (!r[0] && !concepto) continue
    const { fecha, flag } = parseFecha(r[0])
    if (!fecha || monto == null) { problemas.push({ fila: i + 1, r: r.slice(0, 3) }); continue }
    filas.push({
      fecha, concepto, monto, categoria: categoria(concepto),
      sede_id: null, nota: flag,
    })
  }

  await supabase.from('gastos').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  // insertar en lotes
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await supabase.from('gastos').insert(filas.slice(i, i + 500))
    if (error) { console.error('ERR:', error.message); process.exit(1) }
  }

  const tot = filas.reduce((a, f) => a + f.monto, 0)
  const porCat = {}
  for (const f of filas) porCat[f.categoria] = (porCat[f.categoria] || 0) + f.monto
  console.log(`✓ ${filas.length} gastos cargados. Total: S/ ${tot.toFixed(2)}`)
  for (const k in porCat) console.log(`   ${k.padEnd(16)} S/ ${porCat[k].toFixed(2)}`)
  if (problemas.length) { console.log('\nFilas no cargadas:'); problemas.forEach(p => console.log('  fila', p.fila, JSON.stringify(p.r))) }
}
main().catch(e => { console.error(e); process.exit(1) })
