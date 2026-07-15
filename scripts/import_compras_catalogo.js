// Carga el catálogo de productos de compras (de "Proyectado de Comprar").
//   node import_compras_catalogo.js         -> inserta
//   node import_compras_catalogo.js --dry   -> solo muestra lo parseado
import { readFileSync } from 'node:fs'
import { supabase, money } from './lib.js'

const DRY = process.argv.includes('--dry')

const raw = readFileSync(new URL('./data/catalogo_raw.txt', import.meta.url), 'utf8')
// Quita el encabezado hasta "Tot " (justo antes del primer producto)
let s = raw.slice(raw.indexOf('Tot ') + 4)
// Separa registros: cada registro termina en su Tot (S/ val) seguido del nombre del siguiente
s = s.replace(/( S\/\s*(?:[\d.]+|-))\s+(?=[A-Za-zÁÉÍÓÚñÑ#])/g, '$1\n')

const productos = []
for (const linea of s.split('\n')) {
  if (!linea.trim()) continue
  const f = linea.split(',')
  const nombre = (f[0] || '').trim()
  if (!nombre) continue
  productos.push({
    nombre,
    frecuencia: (f[1] || '').trim() || null,
    proveedor: (f[2] || '').trim() || null,
    precio_min: money(f[3]),
    precio_max: money(f[4]),
    unidad: (f[5] || '').trim() || null,
    activo: money(f[3]) != null,   // sin precio = producto inactivo/por definir
  })
}

console.log(`Parseados: ${productos.length} productos (${productos.filter(p => p.activo).length} con precio)`)
if (DRY) {
  console.table(productos.slice(0, 8))
  console.log('...'); process.exit(0)
}

async function main() {
  const nombres = productos.map(p => p.nombre)
  await supabase.from('compras_productos').delete().in('nombre', nombres)
  const { error } = await supabase.from('compras_productos').insert(productos)
  if (error) { console.error('ERR:', error.message); process.exit(1) }
  const { count } = await supabase.from('compras_productos').select('*', { count: 'exact', head: true })
  console.log(`✓ Catálogo cargado. Total en DB: ${count}`)
}
main().catch(e => { console.error(e); process.exit(1) })
