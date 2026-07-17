// =====================================================================
// Febrero 2026 de Amazonas se importó DOS veces, desde dos Excel distintos
// que usan convenciones de turno distintas:
//   'CAJA FEBRERO 2026-AMAZONAS IA.xlsm'   -> pestañas M / T  (mañana/tarde)
//   'CAJA FEBRERO 2026-AMAZONAS BEL.xlsm'  -> pestañas Y / J / B (iniciales de cajera)
// Como `turno` es texto libre, el unique(sede_id,fecha,turno) no los vio como
// duplicados y el mes quedó contado dos veces.
//
// Este script NO borra nada: solo pone los dos archivos lado a lado para que
// el dueño decida cuál vale. Son ~S/ 50.000 y no se recuperan.
//
//   node reporte_febrero_dup.js
// =====================================================================
import { supabase } from './lib.js'

const sol = (v) => 'S/ ' + Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const esIA = (x) => /FEBRERO 2026-AMAZONAS IA/i.test(x.origen_archivo || '')
const esBEL = (x) => /FEBRERO 2026-AMAZONAS BEL/i.test(x.origen_archivo || '')

const { data: sedes } = await supabase.from('sedes').select('id, nombre')
const nom = Object.fromEntries(sedes.map((s) => [s.id, s.nombre]))
const amazonas = sedes.find((s) => s.nombre === 'Amazonas')

const { data: filas } = await supabase.from('caja_turno').select('*')
  .eq('sede_id', amazonas.id).gte('fecha', '2026-02-01').lt('fecha', '2026-03-01').order('fecha')

const ia = filas.filter(esIA)
const bel = filas.filter(esBEL)
const otros = filas.filter((x) => !esIA(x) && !esBEL(x))

console.log('\n══════════ FEBRERO 2026 — AMAZONAS ══════════')
console.log(`Archivo IA  : ${ia.length} turnos · ${sol(ia.reduce((a, x) => a + Number(x.venta_total || 0), 0))}`)
console.log(`Archivo BEL : ${bel.length} turnos · ${sol(bel.reduce((a, x) => a + Number(x.venta_total || 0), 0))}`)
if (otros.length) console.log(`Otros       : ${otros.length} turnos (${[...new Set(otros.map((x) => x.origen_archivo))].join(', ')})`)

// Cuántos gastos/adelantos cuelgan de cada lado: borrar el archivo equivocado
// se lleva también sus hijos por cascade.
async function hijos(ids) {
  if (!ids.length) return { gastos: 0, adelantos: 0, montoG: 0 }
  const [{ data: g }, { data: d }] = await Promise.all([
    supabase.from('caja_gastos').select('monto, turno_id').in('turno_id', ids),
    supabase.from('caja_descuentos').select('monto, turno_id').in('turno_id', ids),
  ])
  return {
    gastos: (g || []).length, adelantos: (d || []).length,
    montoG: (g || []).reduce((a, x) => a + Number(x.monto || 0), 0),
  }
}
const hIA = await hijos(ia.map((x) => x.id))
const hBEL = await hijos(bel.map((x) => x.id))
console.log(`\nLo que cuelga de cada uno (se borraría con él):`)
console.log(`  IA  : ${hIA.gastos} gastos (${sol(hIA.montoG)}) · ${hIA.adelantos} adelantos`)
console.log(`  BEL : ${hBEL.gastos} gastos (${sol(hBEL.montoG)}) · ${hBEL.adelantos} adelantos`)

// ---------------------------------------------------------------------
// Día por día
// ---------------------------------------------------------------------
console.log('\n══════════ DÍA POR DÍA ══════════')
console.log('(cada línea: turno · cajero · venta del sistema)\n')

const dias = [...new Set(filas.map((x) => x.fecha))].sort()
let soloIA = 0, soloBEL = 0, enAmbos = 0
let ventaIAdup = 0, ventaBELdup = 0

for (const f of dias) {
  const dIA = ia.filter((x) => x.fecha === f)
  const dBEL = bel.filter((x) => x.fecha === f)
  const dOtro = otros.filter((x) => x.fecha === f)
  const dia = new Date(f + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'short' })

  if (dIA.length && !dBEL.length) soloIA++
  else if (!dIA.length && dBEL.length) soloBEL++
  else if (dIA.length && dBEL.length) {
    enAmbos++
    ventaIAdup += dIA.reduce((a, x) => a + Number(x.venta_total || 0), 0)
    ventaBELdup += dBEL.reduce((a, x) => a + Number(x.venta_total || 0), 0)
  }

  const marca = dIA.length && dBEL.length ? '⚠️ EN AMBOS' : dIA.length ? '   solo IA ' : dBEL.length ? '   solo BEL' : '   —'
  console.log(`${f} (${dia})  ${marca}`)
  const linea = (x, et) => `      ${et}  ${String(x.turno).padEnd(4)} · ${String(x.cajero || '—').padEnd(18)} · ${sol(x.venta_total)}`
  for (const x of dIA) console.log(linea(x, 'IA '))
  for (const x of dBEL) console.log(linea(x, 'BEL'))
  for (const x of dOtro) console.log(linea(x, '???'))
}

console.log('\n══════════ RESUMEN ══════════')
console.log(`Días solo en IA        : ${soloIA}`)
console.log(`Días solo en BEL       : ${soloBEL}`)
console.log(`Días en LOS DOS (dup)  : ${enAmbos}   ← aquí está el doble conteo`)
console.log(`   venta desde IA      : ${sol(ventaIAdup)}`)
console.log(`   venta desde BEL     : ${sol(ventaBELdup)}`)
console.log(`   diferencia          : ${sol(Math.abs(ventaIAdup - ventaBELdup))}`)
console.log(`\nSi los días coinciden en venta, son el MISMO mes cargado dos veces`)
console.log(`y hay que quedarse con uno. Si NO coinciden, uno de los dos está mal`)
console.log(`o cubren cosas distintas: hay que abrir los Excel antes de borrar.`)
