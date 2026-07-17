// Verifica los permisos de sql/23 ENTRANDO como cada rol nuevo.
// Crea usuarios de prueba, entra con la llave pública (mismo RLS que ellos),
// comprueba qué pueden y qué no, y los borra. Un RLS mal escrito no da error,
// solo deja pasar: por eso se prueba entrando.
//   node verificar_roles_v23.js
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { supabase as admin } from './lib.js'

const anon = readFileSync(new URL('../app/.env', import.meta.url), 'utf8').match(/VITE_SUPABASE_ANON_KEY\s*=\s*(.+)/)?.[1]?.trim()
const cliente = () => createClient(process.env.SUPABASE_URL, anon, { auth: { persistSession: false } })

let fallos = 0
const check = (n, ok, det = '') => { if (!ok) fallos++; console.log(`${ok ? '✅' : '❌'} ${n}${!ok && det ? ` → ${det}` : ''}`) }
const puede = async (q) => { const { data, error } = await q; return !error && (data?.length ?? 0) > 0 }
const bloqueado = async (q) => { const { data, error } = await q; return !!error || (data?.length ?? 0) === 0 }

const { data: sedes } = await admin.from('sedes').select('id,nombre')
const amazonas = sedes.find((s) => s.nombre === 'Amazonas')
const miraflores = sedes.find((s) => s.nombre === 'Miraflores')

const creados = []
async function crear(usuario, rol, sede_id, extra = {}) {
  const email = `zzz_${usuario}@cholao.local`, clave = 'prueba' + Math.random().toString(36).slice(2, 8)
  const prev = (await admin.auth.admin.listUsers()).data.users.filter((u) => u.email === email)
  for (const u of prev) await admin.auth.admin.deleteUser(u.id)
  const { data } = await admin.auth.admin.createUser({ email, password: clave, email_confirm: true })
  await admin.from('perfiles').insert({ id: data.user.id, usuario, nombre: usuario.toUpperCase(), rol, sede_id, activo: true, ...extra })
  creados.push(data.user.id)
  const c = cliente()
  await c.auth.signInWithPassword({ email, password: clave })
  return c
}
async function limpiar() { for (const id of creados) await admin.auth.admin.deleteUser(id) }

try {
  console.log('\n═══ COCINA (Amazonas) — solo su lista, solo su sede ═══')
  const cocina = await crear('cocina_prueba', 'cocina', amazonas.id)
  // crea una lista de su sede
  const { error: eLista } = await cocina.from('compras_listas').insert({ sede_id: amazonas.id, fecha: '2026-07-17', estado: 'abierta' })
  check('cocina crea lista de SU sede', !eLista, eLista?.message)
  const { error: eOtra } = await cocina.from('compras_listas').insert({ sede_id: miraflores.id, fecha: '2026-07-17', estado: 'abierta' })
  check('cocina NO puede crear lista de OTRA sede', !!eOtra, 'la creó (RLS abierto)')
  check('cocina NO ve gastos', await bloqueado(cocina.from('gastos').select('*').limit(1)))
  check('cocina NO ve ventas', await bloqueado(cocina.from('ventas').select('*').limit(1)))
  check('cocina NO ve pagos_tienda', await bloqueado(cocina.from('pagos_tienda').select('*').limit(1)))
  check('cocina SÍ ve productos (para su lista)', await puede(cocina.from('productos_stock').select('*').limit(1)))

  console.log('\n═══ GERENTE — ve todo, NO edita ═══')
  const gerente = await crear('gerente_prueba', 'gerente', null)
  check('gerente VE gastos', await puede(gerente.from('gastos').select('*').limit(1)))
  check('gerente VE ventas', await puede(gerente.from('ventas').select('*').limit(1)))
  const { data: unGasto } = await admin.from('gastos').select('id').limit(1)
  const { error: eEdit } = await gerente.from('gastos').update({ nota: 'HACK' }).eq('id', unGasto[0].id)
  const { data: check1 } = await admin.from('gastos').select('nota').eq('id', unGasto[0].id).single()
  check('gerente NO puede EDITAR gastos', check1.nota !== 'HACK', 'logró editar')
  check('gerente puede REGISTRAR su gasto', !(await gerente.from('gastos').insert({ fecha: '2026-07-17', concepto: 'PRUEBA GERENTE', monto: 1, categoria: 'operativo' })).error)

  console.log('\n═══ ADMIN — ve y EDITA ═══')
  const adminU = await crear('admin_prueba', 'admin', null)
  check('admin VE gastos', await puede(adminU.from('gastos').select('*').limit(1)))
  const { error: eAdminEdit } = await adminU.from('gastos').update({ nota: 'OK-ADMIN' }).eq('id', unGasto[0].id)
  check('admin SÍ puede editar gastos', !eAdminEdit, eAdminEdit?.message)
  await admin.from('gastos').update({ nota: null }).eq('id', unGasto[0].id)  // deshacer

  console.log('\n═══ FERNANDA (cajera + puede_gastos) — panel Pagos ═══')
  const fer = await crear('fernanda_prueba', 'cajera', amazonas.id, { puede_gastos: true })
  check('Fernanda registra en pagos_tienda', !(await fer.from('pagos_tienda').insert({ fecha: '2026-07-17', tipo: 'gasto', concepto: 'LUZ', monto: 50 })).error)
  check('Fernanda ve pagos_tienda', await puede(fer.from('pagos_tienda').select('*').limit(1)))
  check('Fernanda ve el personal (vista_personal, sin sueldo)', await puede(fer.from('vista_personal').select('*').limit(1)))
  check('Fernanda NO ve el ledger de gastos', await bloqueado(fer.from('gastos').select('*').limit(1)))
  check('Fernanda NO ve ventas', await bloqueado(fer.from('ventas').select('*').limit(1)))

  // limpia los datos de prueba que se insertaron
  await admin.from('compras_listas').delete().eq('fecha', '2026-07-17')
  await admin.from('pagos_tienda').delete().eq('fecha', '2026-07-17')
  await admin.from('gastos').delete().eq('concepto', 'PRUEBA GERENTE')
} finally {
  await limpiar()
  console.log('\n🧹 Usuarios de prueba borrados')
}

console.log(fallos ? `\n⛔ ${fallos} fallo(s)` : '\n🎉 Todos los permisos funcionan como deben')
process.exit(fallos ? 1 : 0)
