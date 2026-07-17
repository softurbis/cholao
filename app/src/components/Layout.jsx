import { NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { canAccess, ROLES, MODULOS } from '../lib/roles'

// Perfiles de prueba para el "Ver como" (solo lo usa el superusuario).
const VER_COMO = [
  { label: 'Administrador', rol: 'admin' },
  { label: 'Gerencia', rol: 'gerente' },
  { label: 'Cajero', rol: 'cajera' },
  { label: 'Cajero + Gastos (Fernanda)', rol: 'cajera', puede_gastos: true },
  { label: 'Cajero + Compras (Juan)', rol: 'cajera', puede_compras: true },
  { label: 'Cocina', rol: 'cocina' },
]

export default function Layout({ children }) {
  const { perfil, signOut, esSuperReal, verComo, setVerComo } = useAuth()
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

  // Al cambiar de rol de prueba, ir a su pantalla de inicio para no quedar en una
  // ruta que ese rol no puede ver.
  function cambiarVista(preset) {
    setVerComo(preset)
    navigate('/')
  }

  return (
    <div className="layout">
      <button className="menu-btn" onClick={() => setOpen(!open)}>☰</button>
      <aside className={`sidebar ${open ? 'abierto' : ''}`}>
        <div className="brand">🍧 El Cholao</div>
        <div className="brand-tag">Fresco &amp; Delicioso</div>

        {esSuperReal && (
          <div className="ver-como no-print">
            <label>👁 Ver como</label>
            <select value={verComo?.label || ''} onChange={(e) => {
              const p = VER_COMO.find((x) => x.label === e.target.value)
              cambiarVista(p || null)
            }}>
              <option value="">Yo (Superusuario)</option>
              {VER_COMO.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
          </div>
        )}

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
      <main className="contenido">
        {esSuperReal && verComo && (
          <div className="ver-como-aviso no-print">
            👁 Estás viendo las ventanas de <strong>{verComo.label}</strong> (los datos siguen siendo los tuyos).
            <button className="btn-mini" onClick={() => cambiarVista(null)}>Volver a mí</button>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
