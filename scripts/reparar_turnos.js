// =====================================================================
// Repara los turnos que quedaron con la etiqueta cruda del Excel.
//
// QUÉ PASÓ: import_caja_viejo.js volcaba el sufijo del nombre de la pestaña
// directo a `caja_turno.turno`, sin traducirlo. Como la columna es texto libre,
// nadie se enteró. Resultado: 289 turnos etiquetados 'y', 'n', 'm', 't', 'j',
// 'l', 'b', 'll'. NO son basura — tienen venta, cajero, gastos y adelantos.
//
// LAS DOS CONVENCIONES (los Excel no usaban la misma):
//   · El libro de MARZO rotula por TURNO:   m = Mañana, t = Tarde
//   · Los demás rotulan por QUIEN ATENDÍA:  y = Yamile, n = Natzumy,
//     j = Juan, l = Laura, b = Bella
//
// POR QUÉ LA REGLA ES CONFIABLE: se comprueba sola por dos caminos que no
// dependen uno del otro.
//   1. Quién atendía: 'y' es YAMILE en 116 de 117 filas, 'j' es JUAN, etc.
//   2. Cuánto se vendió: las etiquetas de mañana promedian ~S/ 430 y las de
//      tarde ~S/ 1.400 — 3x de diferencia, consistente en todas.
// Y hay una prueba directa: en febrero el mismo mes vino en dos libros, uno
// rotulado m/t y otro con iniciales, y casaron turno por turno con la misma
// venta exacta.
//
// NO borra nada: corrige `turno`, guarda la etiqueta original en `turno_origen`
// y enlaza `turno_id`. Correr sql/22 antes.
//
//   node reparar_turnos.js             (simulacro)
//   node reparar_turnos.js --aplicar
// =====================================================================
import { supabase } from './lib.js'

const APLICAR = process.argv.includes('--aplicar')

// El libro de marzo es el único que rotula por turno. Cualquier otro libro que
// aparezca con 'm'/'t' hay que mirarlo a mano antes de meterlo aquí.
const POR_TURNO = { m: 'manana', t: 'tarde' }
const ARCHIVOS_POR_TURNO = [/MARZO-AMAZONAS/i]

// El resto rotula por la inicial de quien atendía. Yamile hacía las mañanas;
// el resto, las tardes. 'm' aquí NO es mañana: es MAFER (1 sola fila en enero).
const POR_INICIAL = { y: 'manana', n: 'tarde', j: 'tarde', l: 'tarde', b: 'tarde', ll: 'tarde', m: 'tarde' }

const RAROS = ['y', 'n', 'm', 't', 'j', 'l', 'b', 'll', '(2)']

const { data: sedes } = await supabase.from('sedes').select('id, nombre')
const nom = Object.fromEntries(sedes.map((s) => [s.id, s.nombre]))

// sede_turnos viene de sql/22. Para simular no hace falta (el mapeo de etiquetas
// no depende de la config); para aplicar sí, porque hay que enlazar turno_id.
const { data: turnosCfg } = await supabase.from('sede_turnos').select('id, sede_id, codigo')
if (!turnosCfg?.length && APLICAR) {
  console.log('⛔ No hay sede_turnos: corre sql/22_turnos_horarios.sql antes de aplicar.')
  process.exit(1)
}
const idTurno = (sedeId, codigo) => (turnosCfg || []).find((t) => t.sede_id === sedeId && t.codigo === codigo)?.id

let todos = [], desde = 0
while (true) {
  const { data } = await supabase.from('caja_turno').select('*').range(desde, desde + 999)
  if (!data?.length) break
  todos.push(...data); desde += 1000
  if (data.length < 1000) break
}

const aReparar = todos.filter((x) => RAROS.includes(x.turno))
console.log(`\nTurnos con etiqueta cruda: ${aReparar.length}`)

// ---------------------------------------------------------------------
// Decidir el turno real de cada fila
// ---------------------------------------------------------------------
const plan = [], sinRegla = []
for (const x of aReparar) {
  const porTurno = ARCHIVOS_POR_TURNO.some((r) => r.test(x.origen_archivo || ''))
  const destino = porTurno ? POR_TURNO[x.turno] : POR_INICIAL[x.turno]
  if (!destino) { sinRegla.push(x); continue }
  plan.push({ fila: x, destino })
}

// ---------------------------------------------------------------------
// Colisiones: si al reparar dos filas del mismo día caen en el mismo turno,
// el unique(sede_id,fecha,turno) revienta. Hay que verlas ANTES, no que salte
// el error a mitad del update.
// ---------------------------------------------------------------------
const ocupado = new Map()   // sede|fecha|turno -> fila que ya lo tiene
for (const x of todos) {
  if (RAROS.includes(x.turno)) continue
  ocupado.set(`${x.sede_id}|${x.fecha}|${x.turno}`, x)
}
const colisiones = [], limpios = []
for (const p of plan) {
  const k = `${p.fila.sede_id}|${p.fila.fecha}|${p.destino}`
  const choque = ocupado.get(k)
  if (choque) colisiones.push({ ...p, choque })
  else { ocupado.set(k, p.fila); limpios.push(p) }
}

const sol = (v) => 'S/ ' + Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })

console.log(`\n═══ SE REPARAN: ${limpios.length} ═══`)
const resumen = {}
for (const p of limpios) {
  const k = `${p.fila.turno} → ${p.destino}`
  resumen[k] = (resumen[k] || 0) + 1
}
console.table(resumen)

if (sinRegla.length) {
  console.log(`\n═══ SIN REGLA: ${sinRegla.length} (se quedan como están, hay que mirarlas) ═══`)
  for (const x of sinRegla) {
    console.log(`   ${nom[x.sede_id]} ${x.fecha} "${x.turno}" · ${x.cajero || '—'} · ${sol(x.venta_total)} · ${x.origen_archivo}`)
  }
}

if (colisiones.length) {
  console.log(`\n═══ ⚠️  COLISIÓN: ${colisiones.length} (ese día YA tiene ese turno) ═══`)
  console.log('   No se tocan: hay que decidir cuál vale mirando el Excel.\n')
  for (const c of colisiones) {
    console.log(`   ${nom[c.fila.sede_id]} ${c.fila.fecha}`)
    console.log(`      quiere ser ${c.destino}: "${c.fila.turno}" · ${c.fila.cajero || '—'} · ${sol(c.fila.venta_total)} · ${c.fila.origen_archivo}`)
    console.log(`      pero ya está : "${c.choque.turno}" · ${c.choque.cajero || '—'} · ${sol(c.choque.venta_total)} · ${c.choque.origen_archivo}`)
  }
}

if (!APLICAR) {
  console.log('\n🔎 SIMULACRO — no se tocó nada. Corre con --aplicar.')
  process.exit(0)
}

// ---------------------------------------------------------------------
// Aplicar
// ---------------------------------------------------------------------
let ok = 0, fallos = 0
for (const p of limpios) {
  const { error } = await supabase.from('caja_turno').update({
    turno: p.destino,
    turno_origen: p.fila.turno,        // la evidencia de lo que decía la pestaña
    turno_id: idTurno(p.fila.sede_id, p.destino) || null,
  }).eq('id', p.fila.id)
  if (error) { console.log(`✗ ${p.fila.fecha} ${p.fila.turno}: ${error.message}`); fallos++ }
  else ok++
}
console.log(`\n✅ Reparados: ${ok}${fallos ? ` · ✗ fallos: ${fallos}` : ''}`)

// Los que ya estaban bien pero sin turno_id (por si sql/22 corrió antes de una carga)
const pendientes = todos.filter((x) => !RAROS.includes(x.turno) && !x.turno_id)
let enlazados = 0
for (const x of pendientes) {
  const id = idTurno(x.sede_id, x.turno)
  if (!id) continue
  const { error } = await supabase.from('caja_turno').update({ turno_id: id }).eq('id', x.id)
  if (!error) enlazados++
}
if (enlazados) console.log(`🔗 Enlazados a su turno: ${enlazados} más`)

// ---------------------------------------------------------------------
// Cómo quedó
// ---------------------------------------------------------------------
const { data: fin } = await supabase.from('caja_turno').select('sede_id, turno, turno_id').limit(2000)
const m = {}
for (const x of fin) { const k = nom[x.sede_id]; m[k] = m[k] || {}; m[k][x.turno] = (m[k][x.turno] || 0) + 1 }
console.log('\n═══ TURNOS POR SEDE ═══')
console.table(m)
console.log(`Sin turno_id (quedan por resolver): ${fin.filter((x) => !x.turno_id).length}`)
