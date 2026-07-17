import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { canAccess, rutaInicial } from '../lib/roles'

export default function ProtectedRoute({ children, module }) {
  const { session, perfil, loading } = useAuth()
  const donde = useLocation()

  if (loading) return <div className="centro-cargando">Cargando…</div>
  if (!session) return <Navigate to="/login" replace />

  // Sesión sí, perfil no. Antes esto era `module && perfil && !canAccess(...)`:
  // con perfil null la condición era falsa y la validación se saltaba ENTERA,
  // así que un usuario sin fila en `perfiles` entraba a cualquier pantalla.
  // Ahora sin perfil no se pasa. La base opina lo mismo (mi_rol() devuelve NULL
  // y el RLS no le da nada), así que además vería todo vacío.
  if (!perfil || !perfil.activo) {
    return (
      <div className="centro-cargando">
        <div className="bloque-vacio">
          <p><strong>Tu usuario no tiene acceso al sistema.</strong></p>
          <p className="nota">
            {perfil && !perfil.activo
              ? 'Tu acceso está desactivado. Habla con administración.'
              : 'Tu cuenta existe pero todavía no tiene rol asignado. Pídele al administrador que te lo dé.'}
          </p>
        </div>
      </div>
    )
  }

  if (module && !canAccess(perfil.rol, module)) {
    const inicio = rutaInicial(perfil.rol)
    // Sin esta guarda hay bucle infinito: si tu ruta de inicio fuera justo la
    // que no puedes ver, te redirigirías a ti mismo para siempre.
    if (donde.pathname === inicio) {
      return (
        <div className="pagina">
          <div className="bloque-vacio">
            <p><strong>No tienes acceso a esta pantalla.</strong></p>
            <p className="nota">Habla con administración si crees que es un error.</p>
          </div>
        </div>
      )
    }
    return <Navigate to={inicio} replace />
  }

  return children
}
