import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { canAccess } from '../lib/roles'

export default function ProtectedRoute({ children, module }) {
  const { session, perfil, loading } = useAuth()

  if (loading) return <div className="centro-cargando">Cargando…</div>
  if (!session) return <Navigate to="/login" replace />

  // module opcional: si se pasa, valida acceso por rol.
  if (module && perfil && !canAccess(perfil.rol, module)) {
    return <Navigate to="/" replace />
  }
  return children
}
