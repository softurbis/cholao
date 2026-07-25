import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { canAccess, ROLES, MODULOS, GRUPOS } from '../lib/roles'

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

  // El menú agrupado. Solo se agrupa si hay bastantes módulos: a la cajera, que ve
  // uno, un desplegable le añade un clic para nada.
  const { pathname } = useLocation()
  const grupos = useMemo(() => {
    const gs = GRUPOS
      .map((g) => ({ ...g, items: g.modulos.map((k) => items.find((i) => i.key === k)).filter(Boolean) }))
      .filter((g) => g.items.length > 0)
    // Red de seguridad: un módulo nuevo que nadie puso en un grupo NO puede
    // desaparecer del menú en silencio. Cae aquí y se ve igual.
    const enGrupos = new Set(GRUPOS.flatMap((g) => g.modulos))
    const sueltos = items.filter((i) => !enGrupos.has(i.key))
    return sueltos.length ? [...gs, { key: 'otros', label: 'Otros', icon: '📎', items: sueltos }] : gs
  }, [items])
  const agrupar = items.length > 3
  // Arranca abierto el grupo donde estás parado, para no esconderte lo que usas.
  const [cerrados, setCerrados] = useState(() => {
    const s = {}
    for (const g of GRUPOS) {
      const mods = MODULOS.filter((m) => g.modulos.includes(m.key))
      const aqui = mods.some((m) => m.to === pathname || (m.to !== '/' && pathname.startsWith(m.to)))
      if (!aqui) s[g.key] = true
    }
    return s
  })
  const alternar = (k) => setCerrados((c) => ({ ...c, [k]: !c[k] }))

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
          {!agrupar
            ? items.map((n) => (
              <NavLink
                key={n.key} to={n.to} end={n.to === '/'}
                className={({ isActive }) => (isActive ? 'nav-item activo' : 'nav-item')}
                onClick={() => setOpen(false)}
              >
                <span>{n.icon}</span> {n.label}
              </NavLink>
            ))
            : grupos.map((g) => (
              <div key={g.key} className="nav-grupo">
                <button type="button" className="nav-grupo-cab" onClick={() => alternar(g.key)}
                  aria-expanded={!cerrados[g.key]}>
                  <span className="nav-grupo-ico">{g.icon}</span>
                  <span className="nav-grupo-lbl">{g.label}</span>
                  <span className="nav-grupo-flecha">{cerrados[g.key] ? '▸' : '▾'}</span>
                </button>
                {!cerrados[g.key] && g.items.map((n) => (
                  <NavLink
                    key={n.key} to={n.to} end={n.to === '/'}
                    className={({ isActive }) => (isActive ? 'nav-item activo' : 'nav-item')}
                    onClick={() => setOpen(false)}
                  >
                    <span>{n.icon}</span> {n.label}
                  </NavLink>
                ))}
              </div>
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
