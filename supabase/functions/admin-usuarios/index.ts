// =====================================================================
// Sistema Cholao — admin-usuarios (Edge Function)
//
// Para qué: crear los logins del personal desde la pantalla Personas.
// Crear un usuario exige la llave secreta de Supabase, y esa llave NO puede
// vivir en el navegador (cualquiera la sacaría del código de la página y
// tendría acceso total a la base). Por eso vive acá, del lado del servidor.
//
// Regla de oro de este archivo: NO confiar en nada de lo que llega en el body.
// Quién eres se saca de tu token, y tu rol se consulta contra la base. Si el
// cliente pudiera decir "soy superadmin" en el JSON, esto no serviría de nada.
//
// Desplegar:  npx supabase functions deploy admin-usuarios --project-ref jselojihwryffbukcvdz
//   (o pegar este archivo en el dashboard: Edge Functions → Deploy new function)
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// El personal de tienda no tiene correo. Entran con "marcelo" y por dentro se
// guarda marcelo@cholao.local. Ese buzón no existe ni hace falta que exista:
// los usuarios se crean ya confirmados y nunca se les manda un mail.
const DOMINIO = '@cholao.local'

// Qué es un nombre de usuario válido. Estricto a propósito: esto termina
// convertido en un correo, y sin filtro alguien podría inyectar otra cosa.
const USUARIO_OK = /^[a-z0-9][a-z0-9._-]{2,29}$/

// Quien SÍ tiene correo (gerencia, administración, contadores externos) puede
// entrar con él en vez de con un usuario inventado. Validación deliberadamente
// simple: lo que importa es que sea un correo con forma de correo, no cazar
// todos los casos raros del RFC.
const CORREO_OK = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/

// El personal entra con un PIN de 6 números desde el celular de la tienda.
// SEIS y no cuatro porque GoTrue (el auth de Supabase) rechaza cualquier clave
// de menos de 6 caracteres: está en su código, no es una opción del panel.
// Se validan también los PIN obvios: el rate limit de fábrica no salva a nadie
// de que alguien pruebe 123456 en tres intentos.
const PIN_OK = /^\d{6}$/
const PIN_OBVIO = /^(\d)\1{5}$|^(012345|123456|234567|345678|456789|567890|654321|098765)$/

// El superusuario, admin y gerencia usan correo y clave normal; el personal de
// tienda usa PIN. Por eso la regla del PIN no se aplica a todos.
const ROLES_PIN = ['cajera', 'cocina', 'compras', 'encargado', 'almacen']

// `esCorreo`: quien entra con su correo usa CONTRASEÑA, no PIN, sea cual sea su
// rol. Sin esto, crear con correo a alguien con rol de tienda le exigía 6 dígitos.
function claveInvalida(clave: string, rol: string, esCorreo = false): string | null {
  if (clave.length < 6) return 'La clave debe tener al menos 6 caracteres'
  if (esCorreo || !ROLES_PIN.includes(rol)) return null
  if (!PIN_OK.test(clave)) return 'El PIN debe ser exactamente 6 números'
  if (PIN_OBVIO.test(clave)) return 'Ese PIN es demasiado fácil de adivinar. Usa otro.'
  return null
}

const ROLES = ['superadmin', 'admin', 'gerente', 'compras', 'cajera', 'cocina', 'encargado', 'almacen']

// Trabajan en un local fijo: cajera, cocina (arma la lista de SU sede) y el
// encargado histórico. Gerencia/admin ven todo, y compras y almacén son
// transversales. Debe coincidir con ROLES_CON_SEDE en app/src/lib/roles.js.
const ROLES_CON_SEDE = ['cajera', 'cocina', 'encargado']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Solo POST' }, 405)

  const URL = Deno.env.get('SUPABASE_URL')!
  const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(URL, SECRET, { auth: { persistSession: false } })

  // ---- Quién llama (del token, no del body) ----
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Falta el token de sesión' }, 401)

  const { data: quien, error: eTok } = await admin.auth.getUser(token)
  if (eTok || !quien?.user) return json({ error: 'Sesión inválida' }, 401)

  // ---- Y si es superadmin (contra la base) ----
  // Se usa el cliente admin a propósito: salta el RLS, así que esta consulta
  // funciona igual sin importar cómo queden las policies de perfiles.
  const { data: perfil } = await admin
    .from('perfiles').select('rol, activo').eq('id', quien.user.id).single()

  if (!perfil?.activo || perfil.rol !== 'superadmin') {
    return json({ error: 'Solo el superadmin puede administrar usuarios' }, 403)
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }
  const accion = String(body.accion ?? '')

  // =====================================================================
  // crear — alta de un login para una persona
  // =====================================================================
  if (accion === 'crear') {
    // Con correo se entra con el correo tal cual; sin él, se arma
    // usuario@cholao.local como siempre.
    const correo = String(body.correo ?? '').trim().toLowerCase()
    const esCorreo = correo.length > 0
    const usuario = esCorreo ? correo : String(body.usuario ?? '').trim().toLowerCase()
    const clave = String(body.clave ?? '')
    const nombre = String(body.nombre ?? '').trim()
    const rol = String(body.rol ?? '')
    const sede_id = body.sede_id ? String(body.sede_id) : null
    const persona_id = body.persona_id ? String(body.persona_id) : null
    const puede_gastos = body.puede_gastos === true    // permiso extra: registra gastos
    const puede_compras = body.puede_compras === true  // permiso extra: registra compras

    if (esCorreo) {
      if (!CORREO_OK.test(correo)) return json({ error: 'Ese correo no tiene forma de correo válido.' }, 400)
      if (correo.endsWith(DOMINIO)) {
        return json({ error: `${DOMINIO} es el dominio interno: para eso usa un usuario simple, no un correo.` }, 400)
      }
    } else if (!USUARIO_OK.test(usuario)) {
      return json({ error: 'Usuario inválido: entre 3 y 30 caracteres, solo minúsculas, números, punto, guion o guion bajo, y debe empezar con letra o número.' }, 400)
    }
    if (!nombre) return json({ error: 'Falta el nombre' }, 400)
    if (!ROLES.includes(rol)) return json({ error: 'Rol inválido' }, 400)
    const malaClave = claveInvalida(clave, rol, esCorreo)
    if (malaClave) return json({ error: malaClave }, 400)

    // El encargado y la cajera trabajan EN una sede. Sin sede, el RLS no les
    // daría acceso a nada y parecería que la app está rota.
    if (ROLES_CON_SEDE.includes(rol) && !sede_id) {
      return json({ error: 'Ese rol trabaja en una sede: elige cuál.' }, 400)
    }

    const email = esCorreo ? correo : usuario + DOMINIO

    const { data: creado, error: eCrear } = await admin.auth.admin.createUser({
      email,
      password: clave,
      email_confirm: true,   // sin esto no podrían entrar: nadie va a confirmar un buzón que no existe
      user_metadata: { usuario, nombre },
    })
    if (eCrear) {
      const dup = /already|exists|registered/i.test(eCrear.message)
      return json({ error: dup ? `${esCorreo ? 'El correo' : 'El usuario'} "${usuario}" ya existe` : eCrear.message }, 400)
    }

    const { error: ePerfil } = await admin.from('perfiles').insert({
      id: creado.user.id, usuario, nombre, rol, sede_id, persona_id, activo: true, puede_gastos, puede_compras,
    })
    if (ePerfil) {
      // Sin perfil, el login existe pero no tiene rol: entraría a una app vacía
      // y quedaría un usuario fantasma imposible de ver desde Personas.
      // Mejor deshacer y que el alta falle limpia.
      await admin.auth.admin.deleteUser(creado.user.id)
      return json({ error: 'No se pudo crear el perfil: ' + ePerfil.message }, 400)
    }

    return json({ ok: true, id: creado.user.id, usuario, email })
  }

  // =====================================================================
  // clave — resetear la clave de alguien que la olvidó
  // (no hay "recuperar por correo": esos buzones no existen)
  // =====================================================================
  if (accion === 'clave') {
    const id = String(body.id ?? '')
    const clave = String(body.clave ?? '')
    if (!id) return json({ error: 'Falta el usuario' }, 400)

    // El rol se lee de la BASE, no del body: así el que usa PIN no puede
    // saltarse la regla del PIN diciendo que es "gerente" en el JSON.
    const { data: suPerfil } = await admin.from('perfiles').select('rol').eq('id', id).single()
    const malaClave = claveInvalida(clave, suPerfil?.rol ?? '')
    if (malaClave) return json({ error: malaClave }, 400)

    const { error } = await admin.auth.admin.updateUserById(id, { password: clave })
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  // =====================================================================
  // activar — dar de baja a quien se fue, sin borrar su historial
  // Se desactiva el perfil (el RLS deja de darle acceso a todo) Y se bloquea
  // el login. Solo lo primero dejaría que siga entrando a una app en blanco.
  // =====================================================================
  if (accion === 'activar') {
    const id = String(body.id ?? '')
    const activo = body.activo === true
    if (!id) return json({ error: 'Falta el usuario' }, 400)
    if (id === quien.user.id && !activo) {
      return json({ error: 'No puedes desactivarte a ti mismo' }, 400)
    }

    const { error } = await admin.from('perfiles').update({ activo }).eq('id', id)
    if (error) return json({ error: error.message }, 400)

    const { error: eBan } = await admin.auth.admin.updateUserById(id, {
      ban_duration: activo ? 'none' : '876000h',   // ~100 años
    })
    if (eBan) return json({ error: eBan.message }, 400)
    return json({ ok: true })
  }

  // =====================================================================
  // eliminar — borra el login de verdad
  // El historial NO se pierde: caja_turno, gastos y adjuntos guardan el uuid,
  // y personas es otra tabla. Aun así, para alguien que se fue conviene
  // desactivar en vez de borrar, para que su nombre siga apareciendo.
  // =====================================================================
  if (accion === 'eliminar') {
    const id = String(body.id ?? '')
    if (!id) return json({ error: 'Falta el usuario' }, 400)
    if (id === quien.user.id) return json({ error: 'No puedes eliminarte a ti mismo' }, 400)

    const { error } = await admin.auth.admin.deleteUser(id)   // perfiles cae por cascade
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  return json({ error: 'Acción desconocida: ' + accion }, 400)
})
