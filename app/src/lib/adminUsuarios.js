// Puente con la Edge Function que crea los logins.
// Crear logins necesita la llave secreta, que no puede estar en el navegador:
// por eso todo pasa por la función del servidor (supabase/functions/admin-usuarios).
//
// OJO: en Supabase la función se desplegó con el slug `quick-api` (así quedó al
// crearla desde el dashboard). El nombre de la URL es lo que importa, no el
// título. Si algún día la recreas con el nombre `admin-usuarios`, cambia esto.
import { supabase } from './supabase'

const FUNCION = 'quick-api'

// supabase-js NO trae el mensaje del servidor cuando la respuesta es 4xx: deja
// un genérico "Edge Function returned a non-2xx status code" y esconde el
// cuerpo en error.context. Sin esto verías ese texto inútil en vez de
// "El usuario marcelo ya existe".
async function llamar(body) {
  const { data, error } = await supabase.functions.invoke(FUNCION, { body })
  if (error) {
    let msg = error.message
    try {
      const j = await error.context?.json?.()
      if (j?.error) msg = j.error
    } catch { /* la respuesta no era JSON: nos quedamos con el genérico */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export const crearUsuario = (u) => llamar({ accion: 'crear', ...u })
export const resetearClave = (id, clave) => llamar({ accion: 'clave', id, clave })
export const activarUsuario = (id, activo) => llamar({ accion: 'activar', id, activo })
export const eliminarUsuario = (id) => llamar({ accion: 'eliminar', id })

// "MARCELO PÉREZ" -> "marcelo". Es solo una sugerencia editable; si ya existe,
// la función del servidor lo rechaza y se elige otro.
export function sugerirUsuario(nombres = '') {
  return nombres
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // fuera tildes: el usuario va en un correo
    .toLowerCase().trim().split(/\s+/)[0]
    ?.replace(/[^a-z0-9]/g, '') || ''
}

// PIN de 6 dígitos. SEIS, no cuatro: Supabase Auth (GoTrue) rechaza cualquier
// clave de menos de 6 caracteres, y no es una opción del panel — está en su
// código. Un PIN de 4 es sencillamente imposible sin montar otro login.
//
// Lo genera el sistema y NO lo elige la persona: si lo eligieran, la mitad
// pondría 123456 o su año de nacimiento, y ahí el PIN deja de proteger nada.
export function sugerirPin() {
  // Sin ceros a la izquierda: "012345" se ve raro dictado y algún teclado lo come.
  return String(Math.floor(100000 + Math.random() * 900000))
}

export const ES_PIN = /^\d{6}$/
