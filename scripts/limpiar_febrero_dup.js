// =====================================================================
// Arregla el doble conteo de febrero 2026 en Amazonas.
//
// QUÉ PASÓ: el mes se importó desde dos Excel distintos
//   'CAJA FEBRERO 2026-AMAZONAS IA.xlsm'   -> pestañas M / T (mañana/tarde)
//   'CAJA FEBRERO 2026-AMAZONAS BEL.xlsm'  -> pestañas Y / J / B (inicial de quien atendió)
// Como `turno` es texto libre, el unique(sede_id,fecha,turno) no los reconoció
// como el mismo turno y febrero quedó sumando dos veces (~S/ 46.000 de más).
//
// POR QUÉ SE BORRA IA Y NO BEL: se comprobó fila por fila que los 52 turnos de
// IA están todos en BEL con la MISMA venta (0 discrepancias), y que BEL además
// tiene 2 turnos que IA no tiene (15 y 16 de feb). IA es un subconjunto puro:
// borrarlo no pierde nada. Al revés sí se perderían esos 2 turnos.
//
// ADEMÁS: el libro de marzo trae 2 turnos fechados en febrero (02-15 y 02-16).
// No son duplicados: el 15 de MARZO no existe en la base y al 16 de marzo le
// falta justo el turno de mañana. Son de marzo con la fecha mal tipeada.
//
// Hace respaldo a JSON antes de borrar. Correr con --aplicar; sin eso solo simula.
//
//   node limpiar_febrero_dup.js            (simulacro)
//   node limpiar_febrero_dup.js --aplicar  (de verdad)
// =====================================================================
import { writeFileSync } from 'node:fs'
import { supabase } from './lib.js'

const APLICAR = process.argv.includes('--aplicar')
const sol = (v) => 'S/ ' + Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const ARCHIVO_IA = 'CAJA FEBRERO 2026-AMAZONAS IA.xlsm'

const { data: sedes } = await supabase.from('sedes').select('id, nombre')
const amazonas = sedes.find((s) => s.nombre === 'Amazonas')

// ---------------------------------------------------------------------
// 1) Lo que se va a borrar
// ---------------------------------------------------------------------
const { data: aBorrar } = await supabase.from('caja_turno').select('*')
  .eq('sede_id', amazonas.id).eq('origen_archivo', ARCHIVO_IA)
  .gte('fecha', '2026-02-01').lt('fecha', '2026-03-01')

const ids = aBorrar.map((x) => x.id)
console.log(`\n═══ A BORRAR: ${aBorrar.length} turnos de "${ARCHIVO_IA}" ═══`)
console.log(`   venta que dejan de contarse dos veces: ${sol(aBorrar.reduce((a, x) => a + Number(x.venta_total || 0), 0))}`)

// ---------------------------------------------------------------------
// 2) Salvaguarda: no borrar nada que no esté ya en BEL con la misma venta.
// Si esta comprobación falla, el supuesto de "IA es subconjunto de BEL" dejó
// de ser cierto y borrar destruiría datos únicos.
// ---------------------------------------------------------------------
const { data: bel } = await supabase.from('caja_turno').select('*')
  .eq('sede_id', amazonas.id).eq('origen_archivo', 'CAJA FEBRERO 2026-AMAZONAS BEL.xlsm')

const normIA = (t) => ({ m: 'manana', t: 'tarde' }[t] || t)
const normBEL = (t) => ({ y: 'manana', j: 'tarde', b: 'tarde', l: 'tarde', n: 'tarde' }[t] || t)
const mapaBEL = new Map(bel.map((x) => [x.fecha + '|' + normBEL(x.turno), x]))

const huerfanos = []
for (const x of aBorrar) {
  const gemelo = mapaBEL.get(x.fecha + '|' + normIA(x.turno))
  if (!gemelo || Number(gemelo.venta_total || 0) !== Number(x.venta_total || 0)) {
    huerfanos.push({ fecha: x.fecha, turno: x.turno, venta: x.venta_total, gemelo: gemelo?.venta_total ?? 'NO EXISTE' })
  }
}
if (huerfanos.length) {
  console.log('\n⛔ ABORTADO: hay filas en IA que NO tienen gemelo idéntico en BEL.')
  console.log('   Borrarlas perdería datos. Revisar a mano:')
  console.table(huerfanos)
  process.exit(1)
}
console.log(`   ✅ salvaguarda: los ${aBorrar.length} tienen gemelo idéntico en BEL`)

// ---------------------------------------------------------------------
// 3) Respaldo (las filas y todo lo que cuelga de ellas)
// ---------------------------------------------------------------------
const [{ data: gastos }, { data: descuentos }, { data: stock }, { data: adjuntos }] = await Promise.all([
  supabase.from('caja_gastos').select('*').in('turno_id', ids),
  supabase.from('caja_descuentos').select('*').in('turno_id', ids),
  supabase.from('caja_stock').select('*').in('turno_id', ids),
  supabase.from('caja_adjuntos').select('*').in('turno_id', ids),
])
console.log(`   cuelgan: ${gastos.length} gastos · ${descuentos.length} adelantos · ${stock.length} stock · ${adjuntos.length} adjuntos`)

const respaldo = {
  motivo: 'Doble conteo febrero 2026 Amazonas: se borra el archivo IA por ser subconjunto exacto de BEL',
  cuando: new Date().toISOString(),
  turnos: aBorrar, gastos, descuentos, stock, adjuntos,
}
const ruta = new URL('./data/respaldo_febrero_IA.json', import.meta.url)
writeFileSync(ruta, JSON.stringify(respaldo, null, 1))
console.log(`   💾 respaldo: scripts/data/respaldo_febrero_IA.json`)

// ---------------------------------------------------------------------
// 4) Las 2 fechas mal tipeadas del libro de marzo
// ---------------------------------------------------------------------
const { data: arrastre } = await supabase.from('caja_turno').select('*')
  .eq('sede_id', amazonas.id).eq('origen_archivo', 'CAJA MARZO-AMAZONAS 202631.xlsm')
  .gte('fecha', '2026-02-01').lt('fecha', '2026-03-01')

console.log(`\n═══ A RE-FECHAR: ${arrastre.length} turnos del libro de MARZO fechados en febrero ═══`)
const correcciones = []
for (const x of arrastre) {
  const nueva = x.fecha.replace('2026-02-', '2026-03-')
  // No re-fechar a ciegas: si el destino ya tiene ese turno, es otra cosa.
  const { data: choque } = await supabase.from('caja_turno').select('id, turno')
    .eq('sede_id', amazonas.id).eq('fecha', nueva).eq('turno', x.turno)
  if (choque?.length) {
    console.log(`   ⚠️  ${x.fecha} (${x.turno}) -> ${nueva}: YA EXISTE ese turno. Se deja como está.`)
    continue
  }
  console.log(`   ${x.fecha} (${x.turno}) · ${x.cajero} · ${sol(x.venta_total)}  ->  ${nueva}`)
  correcciones.push({ id: x.id, fecha: nueva })
}

// ---------------------------------------------------------------------
// 5) Aplicar
// ---------------------------------------------------------------------
if (!APLICAR) {
  console.log('\n🔎 SIMULACRO — no se tocó nada. Corre con --aplicar para hacerlo de verdad.')
  process.exit(0)
}

const { error: eDel } = await supabase.from('caja_turno').delete().in('id', ids)  // hijos por cascade
if (eDel) { console.log('❌ Error al borrar:', eDel.message); process.exit(1) }
console.log(`\n✅ Borrados ${ids.length} turnos duplicados (y sus gastos/adelantos por cascade)`)

for (const c of correcciones) {
  const { error } = await supabase.from('caja_turno').update({ fecha: c.fecha }).eq('id', c.id)
  if (error) console.log(`❌ No pude re-fechar ${c.id}: ${error.message}`)
}
console.log(`✅ Re-fechados ${correcciones.length} turnos al mes que les toca`)

// ---------------------------------------------------------------------
// 6) Cómo quedó
// ---------------------------------------------------------------------
const { data: feb } = await supabase.from('caja_turno').select('venta_total, origen_archivo')
  .eq('sede_id', amazonas.id).gte('fecha', '2026-02-01').lt('fecha', '2026-03-01')
const { data: mar } = await supabase.from('caja_turno').select('venta_total')
  .eq('sede_id', amazonas.id).gte('fecha', '2026-03-01').lt('fecha', '2026-04-01')

console.log('\n═══ CÓMO QUEDÓ ═══')
console.log(`Febrero: ${feb.length} turnos · ${sol(feb.reduce((a, x) => a + Number(x.venta_total || 0), 0))}`)
console.log(`Marzo  : ${mar.length} turnos · ${sol(mar.reduce((a, x) => a + Number(x.venta_total || 0), 0))}`)
console.log(`Archivos que quedan en febrero: ${[...new Set(feb.map((x) => x.origen_archivo))].join(' · ')}`)
