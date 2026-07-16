// Carga los análisis mensuales de "Ventas por producto" (carpeta Analisis de Datos/Historico).
// 1 archivo = 1 mes ("Enero26.xlsx"). Historico = Amazonas, Historico Mira = Miraflores.
//   node import_productos_mes.js "<carpeta>" <Sede>
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import XLSX from 'xlsx'
import { supabase, money, getSedeMap } from './lib.js'

const [, , carpeta, sedeArg] = process.argv
const clean = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const MESES = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', noviemre: '11', diciembre: '12' }

function mesDe(nombre) {
  const low = clean(nombre)
  if (low.includes('-') && /\d{2}-/.test(low)) return null       // rangos tipo "Abril24-Octubre25"
  for (const m in MESES) {
    const re = new RegExp('^' + m + '(\\d{2})')
    const hit = low.match(re)
    if (hit) return { ym: `20${hit[1]}-${MESES[m]}` }
  }
  return null
}
function ultimoDia(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

async function main() {
  const sedes = await getSedeMap()
  const sedeId = sedes[(sedeArg || '').toLowerCase()]
  if (!sedeId) { console.error('Sede inválida:', sedeArg); process.exit(1) }

  const files = readdirSync(carpeta).filter(f => /\.xlsx$/i.test(f) && !f.startsWith('~$'))
  let totalFilas = 0
  for (const f of files) {
    const mes = mesDe(f)
    if (!mes) { console.log('· omito (no es mes simple):', f); continue }
    const { ym } = mes
    const wb = XLSX.readFile(join(carpeta, f), { cellDates: false })
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
    const filas = []
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      if (!r || !r[1]) continue
      filas.push({
        sede_id: sedeId, periodo_ini: `${ym}-01`, periodo_fin: `${ym}-${String(ultimoDia(ym)).padStart(2, '0')}`,
        categoria: r[0] || null, producto: r[1] || null, presentacion: r[2] || null,
        cant_salon: money(r[3]) || 0, cant_mostrador: money(r[4]) || 0, cant_delivery: money(r[5]) || 0,
        cant_total: money(r[6]) || 0, precio_venta: money(r[7]), total: money(r[8]),
        origen_archivo: f,
      })
    }
    // idempotente por archivo
    await supabase.from('ventas_productos').delete().eq('origen_archivo', f)
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await supabase.from('ventas_productos').insert(filas.slice(i, i + 500))
      if (error) { console.error('✗', f, error.message); process.exit(1) }
    }
    totalFilas += filas.length
    console.log(`✓ ${ym}  ${f.padEnd(24)} ${filas.length} filas`)
  }
  console.log(`\n✓ TOTAL: ${totalFilas} filas de productos (${sedeArg})`)
}
main().catch(e => { console.error(e); process.exit(1) })
