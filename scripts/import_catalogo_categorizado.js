// Reemplaza el catálogo de compras por la lista categorizada real (hojas "Sede X").
// Conserva precios del catálogo anterior donde el nombre coincida (aprox).
import { readFileSync } from 'node:fs'
import { supabase } from './lib.js'

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

async function main() {
  // Precios previos por nombre normalizado
  const { data: previos } = await supabase.from('compras_productos').select('nombre, precio_min, precio_max, proveedor, frecuencia')
  const mapaPrecio = {}
  for (const p of previos || []) mapaPrecio[norm(p.nombre)] = p

  const txt = readFileSync(new URL('./data/catalogo_categorizado.txt', import.meta.url), 'utf8')
  const filas = []
  for (const linea of txt.split(/\r?\n/)) {
    if (!linea.trim()) continue
    const [categoria, nombre, unidad] = linea.split('|').map(s => s.trim())
    if (!nombre) continue
    const prev = mapaPrecio[norm(nombre)]
    filas.push({
      nombre, categoria, unidad,
      proveedor: prev?.proveedor || null,
      precio_min: prev?.precio_min ?? null,
      precio_max: prev?.precio_max ?? null,
      frecuencia: prev?.frecuencia || null,
      activo: true,
    })
  }

  // Reemplaza el catálogo completo
  await supabase.from('compras_productos').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  const { error } = await supabase.from('compras_productos').insert(filas)
  if (error) { console.error('ERR:', error.message); process.exit(1) }

  const conPrecio = filas.filter(f => f.precio_min != null).length
  const cats = [...new Set(filas.map(f => f.categoria))]
  console.log(`✓ ${filas.length} productos cargados (${conPrecio} con precio heredado)`)
  console.log(`Categorías: ${cats.join(', ')}`)
}
main().catch(e => { console.error(e); process.exit(1) })
