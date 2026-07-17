// Verifica los permisos de sql/24 (compras/almacén) entrando como cada rol.
//   node verificar_compras_v24.js
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { supabase as admin } from './lib.js'

const anon = readFileSync(new URL('../app/.env', import.meta.url), 'utf8').match(/VITE_SUPABASE_ANON_KEY\s*=\s*(.+)/)?.[1]?.trim()
let fallos = 0
const check = (n, ok, det = '') => { if (!ok) fallos++; console.log(`${ok ? '✅' : '❌'} ${n}${!ok && det ? ` → ${det}` : ''}`) }
const puede = async (q) => { const { data, error } = await q; return !error && (data?.length ?? 0) > 0 }
const bloqueado = async (q) => { const { data, error } = await q; return !!error || (data?.length ?? 0) === 0 }

const { data: sedes } = await admin.from('sedes').select('id,nombre')
const amazonas = sedes.find((s) => s.nombre === 'Amazonas')

const creados = []
async function crear(usuario, rol, sede_id, extra = {}) {
  const email = `zzz_${usuario}@cholao.local`, clave = 'prueba' + Math.random().toString(36).slice(2, 8)
  for (const u of (await admin.auth.admin.listUsers()).data.users.filter((u) => u.email === email)) await admin.auth.admin.deleteUser(u.id)
  const { data } = await admin.auth.admin.createUser({ email, password: clave, email_confirm: true })
  await admin.from('perfiles').insert({ id: data.user.id, usuario, nombre: usuario.toUpperCase(), rol, sede_id, activo: true, ...extra })
  creados.push(data.user.id)
  const c = createClient(process.env.SUPABASE_URL, anon, { auth: { persistSession: false } })
  await c.auth.signInWithPassword({ email, password: clave })
  return c
}

try {
  console.log('\n═══ JUAN (cajera + puede_compras) ═══')
  const juan = await crear('juan_prueba', 'cajera', amazonas.id, { puede_compras: true })
  check('Juan ve el catálogo de productos', await puede(juan.from('productos').select('*').limit(1)))
  check('Juan puede AÑADIR un producto', !(await juan.from('productos').insert({ nombre: 'ZZZ PRUEBA JUAN', unidad: 'kg' })).error)
  check('Juan edita proveedores (telefono)', !(await juan.from('proveedores').update({ telefono: '999' }).eq('nombre', 'PLAZA VEA')).error)
  // OJO: compras.total es columna GENERADA (cantidad × precio), no se inserta.
  check('Juan registra una compra', !(await juan.from('compras').insert({ fecha: '2026-07-17', nombre_libre: 'PRUEBA', cantidad: 1, precio_unitario: 5 })).error)
  check('Juan crea un pedido', !(await juan.from('pedidos').insert({ fecha: '2026-07-17', estado: 'pendiente' })).error)
  check('Juan mueve stock del almacén', !(await juan.from('almacen_movimientos').insert({ tipo: 'ingreso', cantidad: 1, fecha: '2026-07-17' })).error)
  check('Juan ve el consolidado de listas', !(await juan.from('vista_consolidado_listas').select('*').limit(1)).error)
  check('Juan NO ve gastos (no es su área)', await bloqueado(juan.from('gastos').select('*').limit(1)))

  console.log('\n═══ COCINA — solo elige del catálogo, no lo edita ═══')
  const cocina = await crear('cocina_c', 'cocina', amazonas.id)
  check('cocina VE el catálogo (para su lista)', await puede(cocina.from('productos').select('*').limit(1)))
  check('cocina NO puede editar el catálogo', !!(await cocina.from('productos').insert({ nombre: 'HACK COCINA', unidad: 'kg' })).error)
  check('cocina NO ve las compras', await bloqueado(cocina.from('compras').select('*').limit(1)))

  console.log('\n═══ GERENTE — ve, no edita compras ═══')
  const ger = await crear('ger_c', 'gerente', null)
  check('gerente VE las compras', await puede(ger.from('compras').select('*').limit(1)))
  check('gerente NO edita el catálogo', !!(await ger.from('productos').insert({ nombre: 'HACK GER', unidad: 'kg' })).error)

  // limpia datos de prueba
  await admin.from('productos').delete().in('nombre', ['ZZZ PRUEBA JUAN', 'HACK COCINA', 'HACK GER'])
  await admin.from('compras').delete().eq('nombre_libre', 'PRUEBA').eq('fecha', '2026-07-17')
  await admin.from('almacen_movimientos').delete().eq('fecha', '2026-07-17')
  await admin.from('pedidos').delete().eq('fecha', '2026-07-17')
  await admin.from('proveedores').update({ telefono: null }).eq('nombre', 'PLAZA VEA')
} finally {
  for (const id of creados) await admin.auth.admin.deleteUser(id)
  console.log('\n🧹 Usuarios de prueba borrados')
}
console.log(fallos ? `\n⛔ ${fallos} fallo(s)` : '\n🎉 Compras/almacén: los permisos funcionan')
process.exit(fallos ? 1 : 0)
