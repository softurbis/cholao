// =====================================================================
// Pasa a MAYÚSCULA los nombres y catálogos guardados.
//
// Qué toca (solo nombres/etiquetas, NUNCA notas, correos ni comentarios):
//   personas         → nombres, apellidos, cargo
//   perfiles         → nombre (el que se ve en el menú y firma el turno)
//   caja_turno       → cajero
//   productos_stock  → nombre
//   proveedores      → nombre   (ya estaban, pero por si acaso)
//   tipos_gasto      → nombre   (ídem)
//
// OJO: poner el `cajero` en mayúscula NO junta los nombres repetidos.
// "Yamile Paredes", "YAM" y "YAMILE" seguirán siendo tres nombres distintos,
// solo que en mayúscula. Unificarlos es otra tarea aparte.
//
// Hace respaldo a JSON antes de tocar nada. Simula por defecto.
//   node migrar_mayusculas.js             (simulacro)
//   node migrar_mayusculas.js --aplicar
// =====================================================================
import { writeFileSync } from 'node:fs'
import { supabase } from './lib.js'

const APLICAR = process.argv.includes('--aplicar')

const OBJETIVO = [
  ['personas', ['nombres', 'apellidos', 'cargo']],
  ['perfiles', ['nombre']],
  ['caja_turno', ['cajero']],
  ['productos_stock', ['nombre']],
  ['proveedores', ['nombre']],
  ['tipos_gasto', ['nombre']],
]

// MAYÚSCULA + espacios colapsados. No trim agresivo de contenido: solo
// normaliza el espaciado (un "YAM  PAREDES" con doble espacio queda con uno).
const arriba = (v) => String(v).toUpperCase().replace(/\s+/g, ' ').trim()

async function traerTodo(tabla, cols) {
  let rows = [], d = 0
  while (true) {
    const { data, error } = await supabase.from(tabla).select('id,' + cols.join(',')).range(d, d + 999)
    if (error) throw new Error(tabla + ': ' + error.message)
    if (!data?.length) break
    rows.push(...data); d += 1000
    if (data.length < 1000) break
  }
  return rows
}

const respaldo = { cuando: new Date().toISOString(), tablas: {} }
let totalCambios = 0

for (const [tabla, cols] of OBJETIVO) {
  const rows = await traerTodo(tabla, cols)
  const cambios = []
  for (const r of rows) {
    const patch = {}
    for (const c of cols) {
      const v = r[c]
      if (v == null || v === '') continue
      const nuevo = arriba(v)
      if (nuevo !== v) patch[c] = nuevo
    }
    if (Object.keys(patch).length) cambios.push({ id: r.id, antes: r, patch })
  }
  respaldo.tablas[tabla] = cambios.map((c) => ({ id: c.id, antes: c.antes }))
  totalCambios += cambios.length

  console.log(`\n═══ ${tabla} — ${cambios.length} fila(s) a cambiar ═══`)
  for (const c of cambios.slice(0, 8)) {
    const detalle = Object.entries(c.patch).map(([k, v]) => `${k}: "${c.antes[k]}" → "${v}"`).join(' · ')
    console.log(`   ${detalle}`)
  }
  if (cambios.length > 8) console.log(`   … y ${cambios.length - 8} más`)

  if (APLICAR) {
    for (const c of cambios) {
      const { error } = await supabase.from(tabla).update(c.patch).eq('id', c.id)
      if (error) console.log(`   ✗ ${tabla} ${c.id}: ${error.message}`)
    }
  }
}

if (APLICAR) {
  const ruta = new URL('./data/respaldo_mayusculas.json', import.meta.url)
  writeFileSync(ruta, JSON.stringify(respaldo, null, 1))
  console.log(`\n💾 Respaldo (lo que había antes): scripts/data/respaldo_mayusculas.json`)
  console.log(`✅ Aplicado: ${totalCambios} filas pasadas a mayúscula`)
} else {
  console.log(`\n🔎 SIMULACRO — no se tocó nada. Total a cambiar: ${totalCambios} filas.`)
  console.log(`   Corre con --aplicar para hacerlo (hace respaldo antes).`)
}
