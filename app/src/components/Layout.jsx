import { NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { canAccess, ROLES, MODULOS } from '../lib/roles'

export default function Layout({ children }) {
  const { perfil, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  // Sin perfil, sin rol. Antes decía `perfil?.rol || 'superadmin'`: si el perfil
  // no cargaba, la app te trataba como superadmin y te pintaba el menú entero.
  const rol = perfil?.rol || null

  // El Panel ya no es la excepción. Antes iba `n.key === 'dashboard' || …`, que
  // se lo mostraba a todos — incluida la cajera, que no debe ver el flujo.
  const items = MODULOS.filter((n) => canAccess(rol, n.key, { puedeGastos: perfil?.puede_gastos, puedeCompras: perfil?.puede_compras }))

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
            <small>{ROLES[rol] || rol || 'Sin rol'}{perfil?.sede ? ` · ${perfil.sede.nombre}` : ''}</small>
          </div>
          <button className="btn-salir" onClick={salir}>Salir</button>
        </div>
      </aside>
      <main className="contenido">{children}</main>
    </div>
  )
}
