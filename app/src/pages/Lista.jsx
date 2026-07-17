import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// "Mi Lista" — lo que cada sede necesita que compren.
//   Cocina: arma la lista de SU sede (el RLS solo le deja la suya).
//   Compras (Juan) / admin / super: ven las de TODAS las sedes para consolidar
//   y marcar lo ya comprado.
const hoy = () => new Date().toISOString().slice(0, 10)

export default function Lista() {
  const { perfil } = useAuth()
  const esCocina = perfil?.rol === 'cocina'

  const [listas, setListas] = useState([])
  const [items, setItems] = useState([])
  const [sedes, setSedes] = useState([])
  const [productos, setProductos] = useState([])   // catálogo (con unidad)
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState('')

  async function cargar() {
    setCargando(true)
    // El RLS filtra: cocina ve solo su sede; compras/admin/super ven todo.
    const [{ data: l }, { data: it }, { data: s }, { data: p }] = await Promise.all([
      supabase.from('compras_listas').select('*').order('fecha', { ascending: false }),
      supabase.from('compras_lista_items').select('*').order('id'),
      supabase.from('sedes').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('productos').select('id, nombre, unidad').eq('activo', true).order('nombre'),
    ])
    setListas(l || []); setItems(it || []); setSedes(s || []); setProductos(p || [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const nombreSede = (id) => sedes.find((s) => s.id === id)?.nombre || '—'
  const itemsDe = (listaId) => items.filter((x) => x.lista_id === listaId)

  // ------- cocina: su lista abierta de hoy (la crea si no hay) -------
  async function miListaHoy() {
    const abierta = listas.find((l) => l.sede_id === perfil.sede_id && l.estado !== 'cerrada')
    if (abierta) return abierta
    const { data, error } = await supabase.from('compras_listas').insert({
      sede_id: perfil.sede_id, fecha: hoy(), estado: 'abierta', creado_por: perfil.id,
    }).select().single()
    if (error) { setMsg(error.message); return null }
    setListas((p) => [data, ...p])
    return data
  }

  async function agregarItem(listaId, item) {
    const { data, error } = await supabase.from('compras_lista_items').insert({
      lista_id: listaId,
      producto_id: item.producto_id || null,       // liga al catálogo → consolidado exacto
      nombre_libre: (item.nombre || '').trim().toUpperCase(),
      cantidad: item.cantidad ? Number(item.cantidad) : null,
      unidad: (item.unidad || '').trim() || null,
      comprado: false,
    }).select().single()
    if (error) { setMsg(error.message); return }
    setItems((p) => [...p, data])
  }
  async function quitarItem(id) {
    await supabase.from('compras_lista_items').delete().eq('id', id)
    setItems((p) => p.filter((x) => x.id !== id))
  }
  async function toggleComprado(it) {
    await supabase.from('compras_lista_items').update({ comprado: !it.comprado }).eq('id', it.id)
    setItems((p) => p.map((x) => x.id === it.id ? { ...x, comprado: !x.comprado } : x))
  }
  async function cerrarLista(l) {
    const nuevo = l.estado === 'cerrada' ? 'abierta' : 'cerrada'
    await supabase.from('compras_listas').update({ estado: nuevo }).eq('id', l.id)
    setListas((p) => p.map((x) => x.id === l.id ? { ...x, estado: nuevo } : x))
  }

  if (cargando) return <div className="pagina"><h1>📝 Mi Lista</h1><p className="nota">Cargando…</p></div>

  // =================== VISTA COCINA ===================
  if (esCocina) {
    if (!perfil.sede_id) {
      return <div className="pagina"><h1>📝 Mi Lista</h1>
        <div className="bloque-vacio"><p>Tu usuario no tiene una sede asignada. Pídele al administrador que te la ponga.</p></div></div>
    }
    const lista = listas.find((l) => l.sede_id === perfil.sede_id && l.estado !== 'cerrada')
    return (
      <div className="pagina">
        <h1>📝 Mi Lista — {nombreSede(perfil.sede_id)}</h1>
        <p className="pagina-sub">Anota lo que hace falta comprar. Juan lo ve y lo consigue.</p>
        {msg && <div className="alerta">{msg}</div>}
        <EditorLista
          lista={lista} items={lista ? itemsDe(lista.id) : []} productos={productos}
          onCrear={miListaHoy} onAgregar={agregarItem} onQuitar={quitarItem} onToggle={toggleComprado}
        />
      </div>
    )
  }

  // =================== VISTA COMPRAS / ADMIN / SUPER ===================
  const abiertas = listas.filter((l) => l.estado !== 'cerrada')
  return (
    <div className="pagina">
      <h1>📝 Listas de las sedes</h1>
      <p className="pagina-sub">Lo que pidió cada sede. Marca lo que ya conseguiste.</p>
      {msg && <div className="alerta">{msg}</div>}
      {abiertas.length === 0 && <div className="bloque-vacio"><p>Ninguna sede tiene lista pendiente ahora mismo.</p></div>}
      {abiertas.map((l) => {
        const its = itemsDe(l.id)
        const pend = its.filter((x) => !x.comprado).length
        return (
          <div key={l.id} className="panel-detalle">
            <h3>{nombreSede(l.sede_id)} <span className="nota">· {l.fecha} · {pend} por comprar</span></h3>
            {its.length === 0 ? <p className="nota">Sin items.</p> : (
              <table className="tabla">
                <thead><tr><th>¿Comprado?</th><th>Producto</th><th>Cantidad</th></tr></thead>
                <tbody>
                  {its.map((it) => (
                    <tr key={it.id} className={it.comprado ? 'fila-inactiva' : ''}>
                      <td><button className={`chip ${it.comprado ? 'chip-ok' : 'chip-off'}`} onClick={() => toggleComprado(it)}>
                        {it.comprado ? '✓ Sí' : 'No'}</button></td>
                      <td><strong>{it.nombre_libre}</strong></td>
                      <td>{it.cantidad ? `${it.cantidad} ${it.unidad || ''}` : (it.unidad || '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button className="btn-mini" style={{ marginTop: 8 }} onClick={() => cerrarLista(l)}>
              {l.estado === 'cerrada' ? 'Reabrir' : 'Marcar lista como atendida'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------
function EditorLista({ lista, items, productos, onCrear, onAgregar, onQuitar, onToggle }) {
  const [prodId, setProdId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const prod = productos.find((p) => p.id === prodId)

  async function añadir() {
    if (!prod) return
    let l = lista
    if (!l) { l = await onCrear(); if (!l) return }
    // La unidad sale del catálogo, no se escribe: así el consolidado de Juan
    // suma "PAPA (kg)" de todas las sedes sin ambigüedad.
    await onAgregar(l.id, { producto_id: prod.id, nombre: prod.nombre, unidad: prod.unidad, cantidad })
    setProdId(''); setCantidad('')
  }

  return (
    <div className="panel-detalle">
      {productos.length === 0
        ? <p className="nota">El catálogo de productos está vacío. Juan lo arma en Compras → Catálogo; luego eliges de ahí.</p>
        : (
          <div className="form-inline">
            <select value={prodId} onChange={(e) => setProdId(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">Elige un producto…</option>
              {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.unidad})</option>)}
            </select>
            <input type="number" placeholder="Cant." className="in-num" value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && añadir()} style={{ maxWidth: 90 }} />
            {prod && <span className="nota" style={{ alignSelf: 'center' }}>{prod.unidad}</span>}
            <button onClick={añadir} disabled={!prod}>+ Añadir</button>
          </div>
        )}

      {items.length === 0 ? <p className="nota">Todavía no anotaste nada.</p> : (
        <table className="tabla">
          <thead><tr><th></th><th>Producto</th><th>Cantidad</th><th></th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className={it.comprado ? 'fila-inactiva' : ''}>
                <td><button className={`chip ${it.comprado ? 'chip-ok' : 'chip-off'}`} onClick={() => onToggle(it)}
                  title="Marcar como comprado">{it.comprado ? '✓' : '·'}</button></td>
                <td><strong>{it.nombre_libre}</strong></td>
                <td>{it.cantidad ? `${it.cantidad} ${it.unidad || ''}` : (it.unidad || '—')}</td>
                <td><button className="btn-mini btn-peligro" onClick={() => onQuitar(it.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
