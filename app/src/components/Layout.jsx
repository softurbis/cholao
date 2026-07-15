import { NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { canAccess, ROLES } from '../lib/roles'

const NAV = [
  { key: 'dashboard', to: '/', label: 'Panel', icon: '📊' },
  { key: 'cuadre', to: '/cuadre', label: 'Cuadre diario', icon: '🧮' },
  { key: 'compras', to: '/compras', label: 'Compras', icon: '🛒' },
  { key: 'asistencia', to: '/asistencia', label: 'Asistencia · Planilla', icon: '🕒' },
  { key: 'ventas', to: '/ventas', label: 'Ventas', icon: '💵' },
  { key: 'gastos', to: '/gastos', label: 'Gastos', icon: '📉' },
  { key: 'sedes', to: '/sedes', label: 'Sedes', icon: '🏪' },
  { key: 'personas', to: '/personas', label: 'Personas', icon: '👥' },
]

export default function Layout({ children }) {
  const { perfil, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rol = perfil?.rol || 'superadmin'

  const items = NAV.filter((n) => n.key === 'dashboard' || canAccess(rol, n.key))

  async function salir() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="layout">
      <button className="menu-btn" onClick={() => setOpen(!open)}>☰</button>
      <aside className={`sidebar ${open ? 'abierto' : ''}`}>
        <div className="brand">🍧 El Cholao</div>
        <div className="brand-tag">Fresco &amp; Delicioso</div>
        <nav>
          {items.map((n) => (
            <NavLink
              key={n.key}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-item activo' : 'nav-item')}
              onClick={() => setOpen(false)}
            >
              <span>{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-pie">
          <div className="usuario">
            <strong>{perfil?.nombre || 'Usuario'}</strong>
            <small>{ROLES[rol] || rol}{perfil?.sede ? ` · ${perfil.sede.nombre}` : ''}</small>
          </div>
          <button className="btn-salir" onClick={salir}>Salir</button>
        </div>
      </aside>
      <main className="contenido">{children}</main>
    </div>
  )
}
