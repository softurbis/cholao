// =====================================================================
// Verifica que los permisos por rol de sql/21 funcionan DE VERDAD.
//
// No se conforma con mirar si las tablas existen: crea una cajera de prueba,
// entra con su usuario y su clave como entraría ella, y comprueba qué puede
// leer y qué no. Es la única forma de saber si el RLS quedó bien — una policy
// mal escrita no da error, simplemente deja pasar.
//
// Al terminar borra la cajera de prueba, pase o falle.
//
//   node verificar_permisos.js
// =====================================================================
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { supabase as admin } from './lib.js'   // service_role: ignora el RLS

// La llave pública es la que usa el navegador. Con ella entra la cajera de
// prueba, así que se la somete al MISMO RLS que a una cajera real.
function llavePublica() {
  const env = readFileSync(new URL('../app/.env', import.meta.url), 'utf8')
  return env.match(/VITE_SUPABASE_ANON_KEY\s*=\s*(.+)/)?.[1]?.trim()
}

const USUARIO = 'zzz_prueba_permisos'
const EMAIL = USUARIO + '@cholao.local'
const CLAVE = 'prueba_' + Math.random().toString(36).slice(2, 10)

let fallos = 0
const check = (nombre, ok, detalle = '') => {
  if (!ok) fallos++
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle && !ok ? `\n     → ${detalle}` : ''}`)
}

// ---------------------------------------------------------------------
// 1) ¿Están los objetos de 19, 20 y 21?
// ---------------------------------------------------------------------
console.log('\n═══ 1. Los SQL están corridos ═══')
const objetos = [
  ['19', 'caja_stock_mov.sede_destino_id', () => admin.from('caja_stock_mov').select('sede_destino_id,aceptado').limit(1)],
  ['19', 'vista_traslados', () => admin.from('vista_traslados').select('*').limit(1)],
  ['20', 'caja_turno.validado', () => admin.from('caja_turno').select('validado').limit(1)],
  ['20', 'vista_por_validar', () => admin.from('vista_por_validar').select('*').limit(1)],
  ['21', 'perfiles.usuario', () => admin.from('perfiles').select('usuario').limit(1)],
  ['21', 'vista_personal', () => admin.from('vista_personal').select('nombres').limit(1)],
]
for (const [sql, nombre, fn] of objetos) {
  const { error } = await fn()
  check(`sql/${sql}  ${nombre}`, !error, error?.message)
}

if (fallos) {
  console.log(`\n⛔ Falta correr SQL. Aplica sql/19, 20 y 21 antes de seguir.`)
  process.exit(1)
}

// La vista no debe exponer el sueldo pase lo que pase.
const { data: vp } = await admin.from('vista_personal').select('*').limit(1)
check('vista_personal NO trae sueldo_base', !Object.keys(vp?.[0] || {}).includes('sueldo_base'),
  'la vista está exponiendo el sueldo: revisa sql/21 punto 3')

// ---------------------------------------------------------------------
// 2) Una cajera de prueba, en Amazonas
// ---------------------------------------------------------------------
console.log('\n═══ 2. Creando cajera de prueba ═══')
const { data: sedes } = await admin.from('sedes').select('id, nombre').order('nombre')
const amazonas = sedes.find((s) => s.nombre === 'Amazonas')
const otra = sedes.find((s) => s.id !== amazonas.id)

// Por si quedó viva de una corrida anterior que se cortó a medias
const { data: previos } = await admin.auth.admin.listUsers()
for (const u of previos.users.filter((u) => u.email === EMAIL)) {
  await admin.auth.admin.deleteUser(u.id)
}

const { data: creado, error: eCrear } = await admin.auth.admin.createUser({
  email: EMAIL, password: CLAVE, email_confirm: true,
})
if (eCrear) { console.log('❌ No pude crear el usuario de prueba:', eCrear.message); process.exit(1) }

await admin.from('perfiles').insert({
  id: creado.user.id, usuario: USUARIO, nombre: 'PRUEBA — borrar',
  rol: 'cajera', sede_id: amazonas.id, activo: true,
})
console.log(`   cajera de prueba en ${amazonas.nombre} (se borra al final)`)

async function limpiar() {
  await admin.auth.admin.deleteUser(creado.user.id)
  console.log('\n🧹 Cajera de prueba borrada')
}

try {
  // -------------------------------------------------------------------
  // 3) Entrar como ella y ver qué alcanza
  // -------------------------------------------------------------------
  console.log('\n═══ 3. Qué ve la cajera ═══')
  const cajera = createClient(process.env.SUPABASE_URL, llavePublica(), { auth: { persistSession: false } })
  const { error: eLogin } = await cajera.auth.signInWithPassword({ email: EMAIL, password: CLAVE })
  check('la cajera puede entrar', !eLogin, eLogin?.message)
  if (eLogin) { await limpiar(); process.exit(1) }

  // Lo que NO debe ver. Con RLS, prohibido = 0 filas (no da error).
  console.log('\n— El dinero NO se ve —')
  const prohibido = [
    ['gastos de gerencia', 'gastos'],
    ['ventas', 'ventas'],
    ['personas (sueldos)', 'personas'],
    ['fondo de compras de Juan', 'fondo_compras_dia'],
    ['obligaciones', 'obligaciones'],
    ['compras', 'compras'],
  ]
  for (const [nombre, tabla] of prohibido) {
    const { data, error } = await cajera.from(tabla).select('*').limit(1)
    const bloqueado = !!error || (data || []).length === 0
    check(`no ve ${nombre}`, bloqueado, `¡LEYÓ ${data?.length} fila(s) de ${tabla}!`)
  }

  // Lo que SÍ necesita para trabajar.
  console.log('\n— Su trabajo SÍ se puede hacer —')
  const permitido = [
    ['sedes', 'sedes'],
    ['tipos de gasto', 'tipos_gasto'],
    ['productos con stock', 'productos_stock'],
    ['nombres del personal (sin sueldo)', 'vista_personal'],
  ]
  for (const [nombre, tabla] of permitido) {
    const { data, error } = await cajera.from(tabla).select('*').limit(1)
    check(`ve ${nombre}`, !error && (data || []).length > 0,
      error?.message || 'devolvió 0 filas: la policy la está dejando fuera')
  }

  // Su caja sí, la de la otra sede no.
  console.log('\n— Cada sede ve su caja —')
  const { data: mi } = await cajera.from('caja_turno').select('id').eq('sede_id', amazonas.id).limit(1)
  check(`ve la caja de ${amazonas.nombre} (la suya)`, (mi || []).length > 0)
  const { data: ajena } = await cajera.from('caja_turno').select('id').eq('sede_id', otra.id).limit(1)
  check(`NO ve la caja de ${otra.nombre}`, (ajena || []).length === 0,
    'está viendo la caja de otra sede')

  // El sueldo, ni por la vista ni de refilón.
  const { data: conSueldo, error: eSueldo } = await cajera.from('vista_personal').select('sueldo_base').limit(1)
  check('no puede pedir el sueldo ni nombrando la columna', !!eSueldo || !conSueldo?.[0]?.sueldo_base)

  // -------------------------------------------------------------------
  // 4) Desactivada = fuera, aunque siga logueada
  // -------------------------------------------------------------------
  console.log('\n═══ 4. Al desactivarla deja de ver TODO ═══')
  await admin.from('perfiles').update({ activo: false }).eq('id', creado.user.id)
  const { data: trasBaja } = await cajera.from('sedes').select('*').limit(1)
  check('desactivada no ve ni las sedes', (trasBaja || []).length === 0,
    'sigue viendo datos: mi_rol() no está filtrando por activo')
  await admin.from('perfiles').update({ activo: true }).eq('id', creado.user.id)
} finally {
  await limpiar()
}

console.log(fallos
  ? `\n⛔ ${fallos} comprobación(es) fallaron — los permisos NO están bien`
  : '\n🎉 Todo correcto: los permisos por rol funcionan')
process.exit(fallos ? 1 : 0)
