// Roles del sistema. El rol define qué módulos ve cada persona.
//
// OJO: esto es la conveniencia, NO la seguridad. Esconder un módulo del menú
// no protege el dato: quien tenga sesión puede pedirlo por la API igual. Lo que
// de verdad protege son las policies de sql/21_usuarios_permisos.sql. Si aquí
// abres un módulo para un rol, revisa que allá tenga permiso, o verá la
// pantalla vacía y parecerá que la app está rota.
export const ROLES = {
  superadmin: 'Superadmin',   // tú: control total, configuración
  gerente: 'Gerente',         // ve todo el control, sin config crítica
  encargado: 'Encargado sede', // cuadre + asistencia de su sede, arma lista
  compras: 'Compras',         // Juan: consolida listas de todas las sedes
  almacen: 'Almacén',         // recibe y reparte insumos
  cajera: 'Cajera',           // asistencia + lista de compras rápida (móvil)
}

// Los módulos y su ruta, en un solo lugar. Antes el menú vivía en Layout y las
// rutas en App: cualquier cambio había que hacerlo en dos sitios y era fácil
// dejarlos desalineados.
export const MODULOS = [
  { key: 'dashboard', to: '/', label: 'Panel', icon: '📊' },
  { key: 'registro', to: '/registrar-caja', label: 'Registrar Caja', icon: '✍️' },
  { key: 'cuadre', to: '/cuadre', label: 'Caja Diaria', icon: '🧮' },
  { key: 'config', to: '/config', label: 'Configuración', icon: '⚙️' },
  { key: 'compras', to: '/compras', label: 'Compras', icon: '🛒' },
  { key: 'asistencia', to: '/asistencia', label: 'Asistencia · Planilla', icon: '🕒' },
  { key: 'ventas', to: '/ventas', label: 'Ventas', icon: '💵' },
  { key: 'productos', to: '/productos', label: 'Productos', icon: '🍧' },
  { key: 'gastos', to: '/gastos', label: 'Gastos', icon: '📉' },
  { key: 'sedes', to: '/sedes', label: 'Sedes', icon: '🏪' },
  { key: 'personas', to: '/personas', label: 'Personas', icon: '👥' },
]

// Qué módulos ve cada rol. El orden importa: el primero es donde aterriza al
// entrar (ver rutaInicial).
export const ROLE_ACCESS = {
  superadmin: ['dashboard', 'registro', 'cuadre', 'compras', 'asistencia', 'ventas', 'productos', 'gastos', 'config', 'sedes', 'personas'],
  gerente:    ['dashboard', 'registro', 'cuadre', 'compras', 'asistencia', 'ventas', 'productos', 'gastos', 'config'],
  encargado:  ['dashboard', 'registro', 'cuadre', 'compras', 'asistencia'],
  compras:    ['dashboard', 'compras'],
  almacen:    ['compras'],
  cajera:     ['registro', 'compras', 'asistencia'],
}

// Sin rol no se accede a nada. Este `|| []` es el fail-closed: si algún día
// llega un rol que no está en la tabla (typo, rol nuevo en el enum sin mapear),
// no ve nada en vez de verlo todo.
export function canAccess(rol, key) {
  if (!rol) return false
  return (ROLE_ACCESS[rol] || []).includes(key)
}

// Quién trabaja EN una sede y quién anda entre todas.
// Solo el encargado y la cajera están atados a un local. Gerencia ve todo, y
// Juan (compras) y almacén son transversales por definición: Juan compra para
// las dos sedes y almacén reparte a las dos. Atarlos a una sede obligaría a
// inventarles un local y les escondería la mitad de su trabajo.
export const ROLES_CON_SEDE = ['encargado', 'cajera']

export function necesitaSede(rol) {
  return ROLES_CON_SEDE.includes(rol)
}

// ¿Es gerencia? Un solo sitio donde preguntarlo, porque cada pantalla lo venía
// resolviendo a mano y alguna lo hacía al revés: `!perfil || rol === 'superadmin'`
// daba TRUE cuando el perfil no cargaba, o sea que un usuario sin rol veía los
// botones de validar y borrar turnos. Sin perfil o inactivo: no es gerencia.
export function esGerencia(perfil) {
  return !!perfil?.activo && (perfil.rol === 'superadmin' || perfil.rol === 'gerente')
}

// Dónde aterriza cada quien al entrar. La cajera y almacén NO tienen Panel, así
// que mandarlos a "/" los dejaría rebotando: "/" pide 'dashboard', no lo tienen,
// se les redirige a "/"… y vuelta a empezar. Por eso cada rol tiene su destino.
export function rutaInicial(rol) {
  const primero = (ROLE_ACCESS[rol] || [])[0]
  return MODULOS.find((m) => m.key === primero)?.to || '/login'
}

// El personal de tienda no tiene correo: entra con "marcelo" y por dentro es
// marcelo@cholao.local (ver supabase/functions/admin-usuarios). Quien ya tenía
// un correo de verdad (el superadmin) sigue entrando con él.
export const DOMINIO_INTERNO = '@cholao.local'

export function aEmail(usuario) {
  const u = (usuario || '').trim().toLowerCase()
  return u.includes('@') ? u : u + DOMINIO_INTERNO
}
