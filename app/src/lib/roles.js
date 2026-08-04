// Roles del sistema. El rol define qué módulos ve cada persona.
//
// OJO: esto es la conveniencia, NO la seguridad. Esconder un módulo del menú
// no protege el dato: quien tenga sesión puede pedirlo por la API igual. Lo que
// de verdad protege son las policies de sql/21 y sql/23. Si aquí abres un módulo
// para un rol, revisa que allá tenga permiso, o verá la pantalla vacía.
export const ROLES = {
  superadmin: 'Superusuario',   // tú: control total, configuración, usuarios
  admin: 'Administrador',       // ve todo, EDITA y valida cajas, registra gastos. Sin config.
  gerente: 'Gerencia',          // ve todo (solo mira) + sube sus propios gastos
  compras: 'Compras',           // compras del día y su caja
  cajera: 'Cajero',             // registra su caja
  cocina: 'Cocina',             // solo su sede, para armar su lista
  // Históricos (ya no se asignan, se dejan para no romper datos viejos):
  encargado: 'Encargado sede',
  almacen: 'Almacén',
}

// Los que se pueden elegir al crear un usuario (los históricos quedan fuera).
export const ROLES_ASIGNABLES = ['superadmin', 'admin', 'gerente', 'compras', 'cajera', 'cocina']

// Los módulos y su ruta, en un solo lugar.
export const MODULOS = [
  { key: 'dashboard', to: '/', label: 'Panel', icon: '📊' },
  { key: 'registro', to: '/registrar-caja', label: 'Registrar Caja', icon: '✍️' },
  { key: 'cuadre', to: '/cuadre', label: 'Caja Diaria', icon: '🧮' },
  { key: 'gastos', to: '/gastos', label: 'Gastos', icon: '📉' },
  { key: 'compras', to: '/compras', label: 'Compras', icon: '🛒' },
  { key: 'lista', to: '/lista', label: 'Mi Lista', icon: '📝' },
  { key: 'ventas', to: '/ventas', label: 'Ventas', icon: '💵' },
  { key: 'productos', to: '/productos', label: 'Productos', icon: '🍧' },
  { key: 'config', to: '/config', label: 'Configuración', icon: '⚙️' },
  { key: 'sedes', to: '/sedes', label: 'Sedes', icon: '🏪' },
  { key: 'personas', to: '/personas', label: 'Personas', icon: '👥' },
  { key: 'asistencia', to: '/asistencia', label: 'Asistencia', icon: '🕒' },
  { key: 'horarios', to: '/horarios', label: 'Horarios', icon: '📅' },
  { key: 'recetario', to: '/recetario', label: 'Recetario', icon: '📖' },
]

// Cómo se agrupa el menú de la izquierda. La idea es que cada quien encuentre
// rápido lo suyo: primero lo que se usa TODOS LOS DÍAS, después lo que se revisa,
// y al final lo que casi nunca se toca.
// Un grupo sin módulos visibles para ese rol no se pinta. Y si a alguien le tocan
// pocos módulos (la cajera ve uno), el menú va plano: agrupar tres cosas estorba.
export const GRUPOS = [
  { key: 'dia', label: 'Día a día', icon: '🗓️', modulos: ['registro', 'lista', 'compras', 'gastos', 'asistencia', 'horarios'] },
  { key: 'control', label: 'Revisión', icon: '📈', modulos: ['dashboard', 'cuadre', 'ventas', 'productos', 'recetario'] },
  { key: 'ajustes', label: 'Ajustes', icon: '🔧', modulos: ['sedes', 'personas', 'config'] },
]

// Qué módulos ve cada rol. El orden importa: el primero es donde aterriza al
// entrar (ver rutaInicial).
export const ROLE_ACCESS = {
  // 'asistencia' y 'horarios' las ve TODO EL MUNDO: cada quien marca la suya y ve
  // su horario. Gerencia y administración además ven quién marcó y programan.
  // 'recetario' NO va para el personal de tienda, ni siquiera cocina: son las
  // recetas del negocio y el usuario lo pidió así. Lo protege la policy
  // `recetas_ver` de sql/35 (ve_todo), no solo esconderlo del menú.
  superadmin: ['dashboard', 'registro', 'cuadre', 'gastos', 'compras', 'lista', 'asistencia', 'horarios', 'ventas', 'productos', 'recetario', 'config', 'sedes', 'personas'],
  admin:      ['dashboard', 'registro', 'cuadre', 'gastos', 'compras', 'lista', 'asistencia', 'horarios', 'ventas', 'productos', 'recetario'],
  // Gerencia entra a 'lista' SOLO para mirar lo que pidieron las sedes: Lista.jsx
  // da el editor únicamente al rol 'cocina', al resto la vista de lectura.
  // En recetario también solo mira: escribir es de administración (puedeEditar).
  gerente:    ['dashboard', 'registro', 'cuadre', 'gastos', 'compras', 'lista', 'asistencia', 'horarios', 'ventas', 'productos', 'recetario'],
  compras:    ['compras', 'asistencia', 'horarios'],
  cajera:     ['registro', 'asistencia', 'horarios'],
  cocina:     ['lista', 'asistencia', 'horarios'],
  // históricos
  encargado:  ['dashboard', 'registro', 'cuadre', 'asistencia', 'horarios'],
  almacen:    ['compras', 'asistencia', 'horarios'],
}

// Sin rol no se accede a nada. El `|| []` es el fail-closed: un rol no mapeado
// no ve nada, en vez de verlo todo.
// Los permisos especiales abren un módulo aunque el rol no lo tenga:
//   puedeGastos → Gastos · puedeCompras → Compras
export function canAccess(rol, key, opts = {}) {
  if (!rol) return false
  if (key === 'gastos' && opts.puedeGastos) return true
  if (key === 'compras' && opts.puedeCompras) return true
  return (ROLE_ACCESS[rol] || []).includes(key)
}

// Dónde aterriza cada quien al entrar. La cajera/cocina/compras NO tienen Panel,
// así que mandarlos a "/" los dejaría rebotando. Cada rol tiene su destino.
export function rutaInicial(rol, opts = {}) {
  const lista = [...(ROLE_ACCESS[rol] || [])]
  if (opts.puedeGastos && !lista.includes('gastos')) lista.push('gastos')
  if (opts.puedeCompras && !lista.includes('compras')) lista.push('compras')
  const primero = lista[0]
  return MODULOS.find((m) => m.key === primero)?.to || '/login'
}

// ---- Capacidades transversales (no son módulos, son "qué puede hacer") ----

// EDITAR / validar cajas / corregir: superusuario y administrador. Gerencia NO
// (solo mira). Un solo sitio para preguntarlo — antes cada pantalla lo resolvía
// a mano y alguna lo hacía al revés (dando acceso cuando el perfil no cargaba).
export function puedeEditar(perfil) {
  return !!perfil?.activo && ['superadmin', 'admin'].includes(perfil.rol)
}

// VE TODO lo financiero (dashboard, gastos, ventas…): los que editan + gerencia.
export function veTodo(perfil) {
  return !!perfil?.activo && ['superadmin', 'admin', 'gerente'].includes(perfil.rol)
}

// Registra gastos de tienda y adelantos: los que ven todo + el permiso especial.
export function puedeGastos(perfil) {
  return veTodo(perfil) || (!!perfil?.activo && !!perfil?.puede_gastos)
}

// Opera compras/almacén: super, admin, el rol histórico 'compras', o el permiso
// especial (una cajera que además registra compras).
export function puedeCompras(perfil) {
  return puedeEditar(perfil) || (!!perfil?.activo && (perfil.rol === 'compras' || !!perfil?.puede_compras))
}

// Solo el superusuario toca configuración, sedes y usuarios.
export function esSuper(perfil) {
  return !!perfil?.activo && perfil.rol === 'superadmin'
}

// Quién trabaja EN una sede fija. Cocina también (arma la lista de SU sede).
// Gerencia/admin ven todo; compras es transversal.
export const ROLES_CON_SEDE = ['cajera', 'cocina', 'encargado']
export function necesitaSede(rol) {
  return ROLES_CON_SEDE.includes(rol)
}

// El personal de tienda no tiene correo: entra con "marcelo" y por dentro es
// marcelo@cholao.local. Quien ya tenía correo (el superadmin) entra con él.
export const DOMINIO_INTERNO = '@cholao.local'
export function aEmail(usuario) {
  const u = (usuario || '').trim().toLowerCase()
  return u.includes('@') ? u : u + DOMINIO_INTERNO
}
