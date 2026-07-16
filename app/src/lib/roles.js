// Roles del sistema. El rol define qué módulos ve cada persona.
export const ROLES = {
  superadmin: 'Superadmin',   // tú: control total, configuración
  gerente: 'Gerente',         // ve todo el control, sin config crítica
  encargado: 'Encargado sede', // cuadre + asistencia de su sede, arma lista
  compras: 'Compras',         // Juan: consolida listas de todas las sedes
  almacen: 'Almacén',         // recibe y reparte insumos
  cajera: 'Cajera',           // asistencia + lista de compras rápida (móvil)
}

// Qué rutas puede ver cada rol (base editable a medida que crezca el sistema).
export const ROLE_ACCESS = {
  superadmin: ['dashboard', 'registro', 'cuadre', 'compras', 'asistencia', 'ventas', 'productos', 'gastos', 'config', 'sedes', 'personas'],
  gerente:    ['dashboard', 'registro', 'cuadre', 'compras', 'asistencia', 'ventas', 'productos', 'gastos', 'config'],
  encargado:  ['dashboard', 'registro', 'cuadre', 'compras', 'asistencia'],
  compras:    ['dashboard', 'compras'],
  almacen:    ['compras'],
  cajera:     ['registro', 'compras', 'asistencia'],
}

export function canAccess(rol, key) {
  const list = ROLE_ACCESS[rol] || []
  return list.includes(key)
}
