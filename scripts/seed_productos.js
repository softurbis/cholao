// Siembra el catálogo `productos` con los productos MÁS FRECUENTES que aparecen
// en las compras y entregas históricas. Así Juan no arranca de cero: tiene un
// catálogo real que solo tiene que limpiar y ponerle la unidad correcta.
//
// No mete TODOS los nombres (serían cientos de variantes con typos): solo los
// más usados, deduplicados y en mayúscula.
//
//   node seed_productos.js            (muestra qué sembraría)
//   node seed_productos.js --aplicar
import { supabase } from './lib.js'

const APLICAR = process.argv.includes('--aplicar')
const TOPE = 80   // cuántos productos sembrar

const norm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim()

// Adivina la unidad por el nombre. Juan la corrige después; esto es solo default.
function unidadDe(nombre) {
  const n = nombre.toLowerCase()
  if (/(leche|agua|aceite|jugo|gaseosa|litro|yogurt|crema de leche)/.test(n)) return 'litro'
  if (/(caja|cajas)/.test(n)) return 'caja'
  if (/(paquete|bolsa|saco|atado|unidad|docena|lata|tarro|frasco|botella)/.test(n)) return 'unidad'
  return 'kg'   // negocio de fruta: la mayoría va en kg
}

// junta nombres de compras + entregas y cuenta frecuencia
async function traer(tabla, col) {
  let out = [], d = 0
  while (true) {
    const { data } = await supabase.from(tabla).select(col).range(d, d + 999)
    if (!data?.length) break
    out.push(...data.map((x) => x[col])); d += 1000
    if (data.length < 1000) break
  }
  return out
}

const nombres = [
  ...await traer('compras', 'nombre_libre'),
  ...await traer('entregas', 'producto'),
]
const freq = {}
for (const raw of nombres) {
  const n = norm(raw)
  if (!n || n.length < 2 || n === '?') continue
  freq[n] = (freq[n] || 0) + 1
}
const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, TOPE)

console.log(`Distintos: ${Object.keys(freq).length} · sembrando los ${top.length} más usados:\n`)
for (const [n, c] of top.slice(0, 25)) console.log(`  ${String(c).padStart(4)}×  ${n.padEnd(28)} → ${unidadDe(n)}`)
if (top.length > 25) console.log(`  … y ${top.length - 25} más`)

if (!APLICAR) { console.log('\n🔎 SIMULACRO. Corre con --aplicar.'); process.exit(0) }

// ¿ya hay catálogo? no duplicar
const { data: yaHay } = await supabase.from('productos').select('nombre')
const existentes = new Set((yaHay || []).map((x) => norm(x.nombre)))

const filas = top.map(([n]) => ({ nombre: n, unidad: unidadDe(n), activo: true }))
  .filter((f) => !existentes.has(f.nombre))

let ok = 0
for (const f of filas) {
  const { error } = await supabase.from('productos').insert(f)
  if (error && !/duplicate|unique/i.test(error.message)) console.log('✗', f.nombre, error.message)
  else ok++
}
console.log(`\n✅ Sembrados ${ok} productos${filas.length < top.length ? ` (${top.length - filas.length} ya estaban)` : ''}.`)
console.log('   Juan los revisa en Compras → Catálogo y corrige nombres/unidades.')
