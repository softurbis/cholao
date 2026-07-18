import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// "Mi Lista" — lo que cada sede necesita que compren.
//   Cocina: arma su lista con botones +/− (fácil en celular), le pone un
//     comentario y la ENVÍA a Juan. Al enviar, queda bloqueada hasta que Juan
//     la libere.
//   Compras (Juan) / admin / super: ven las listas enviadas de todas las sedes,
//     su comentario, y pueden liberarlas para corregir.
const hoy = () => new Date().toISOString().slice(0, 10)

export default function Lista() {
  const { perfil } = useAuth()
  const esCocina = perfil?.rol === 'cocina'

  const [listas, setListas] = useState([])
  const [items, setItems] = useState([])
  const [sedes, setSedes] = useState([])
  const [productos, setProductos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState('')

  async function cargar() {
    setCargando(true)
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

  // La lista "viva" de una sede: la que no está atendida (abierta o enviada).
  const listaViva = (sedeId) => listas.find((l) => l.sede_id === sedeId && l.estado !== 'atendida' && l.estado !== 'cerrada')

  async function crearLista(sedeId) {
    const { data, error } = await supabase.from('compras_listas').insert({
      sede_id: sedeId, fecha: hoy(), estado: 'abierta', creado_por: perfil.id,
    }).select().single()
    if (error) { setMsg(error.message); return null }
    setListas((p) => [data, ...p]); return data
  }

  // +/− optimista: actualiza local y dispara la base sin bloquear.
  async function setCantidad(lista, prod, cant) {
    const it = items.find((x) => x.lista_id === lista.id && x.producto_id === prod.id)
    if (cant <= 0) {
      if (it) { setItems((p) => p.filter((x) => x.id !== it.id)); await supabase.from('compras_lista_items').delete().eq('id', it.id) }
      return
    }
    if (it) {
      setItems((p) => p.map((x) => x.id === it.id ? { ...x, cantidad: cant } : x))
      await supabase.from('compras_lista_items').update({ cantidad: cant }).eq('id', it.id)
    } else {
      const fila = { lista_id: lista.id, producto_id: prod.id, nombre_libre: prod.nombre, unidad: prod.unidad, cantidad: cant, comprado: false }
      const { data } = await supabase.from('compras_lista_items').insert(fila).select().single()
      if (data) setItems((p) => [...p, data])
    }
  }
  async function setComentario(lista, texto) {
    setListas((p) => p.map((x) => x.id === lista.id ? { ...x, comentario: texto } : x))
    await supabase.from('compras_listas').update({ comentario: texto }).eq('id', lista.id)
  }
  async function enviar(lista) {
    if (itemsDe(lista.id).length === 0) { setMsg('Agrega al menos un producto antes de enviar.'); return }
    await supabase.from('compras_listas').update({ estado: 'enviada' }).eq('id', lista.id)
    setListas((p) => p.map((x) => x.id === lista.id ? { ...x, estado: 'enviada' } : x))
    setMsg('')
  }
  async function cambiarEstado(lista, estado) {
    await supabase.from('compras_listas').update({ estado }).eq('id', lista.id)
    setListas((p) => p.map((x) => x.id === lista.id ? { ...x, estado } : x))
  }

  if (cargando) return <div className="pagina"><h1>📝 Mi Lista</h1><p className="nota">Cargando…</p></div>

  // =================== VISTA COCINA ===================
  if (esCocina) {
    if (!perfil.sede_id) {
      return <div className="pagina"><h1>📝 Mi Lista</h1>
        <div className="bloque-vacio"><p>Tu usuario no tiene una sede asignada. Pídele al administrador que te la ponga.</p></div></div>
    }
    const lista = listaViva(perfil.sede_id)
    return (
      <div className="pagina">
        <h1>📝 Mi Lista — {nombreSede(perfil.sede_id)}</h1>
        {msg && <div className="alerta">{msg}</div>}
        {lista && lista.estado === 'enviada'
          ? <ListaEnviada lista={lista} items={itemsDe(lista.id)} />
          : <EditorCocina
              lista={lista} items={lista ? itemsDe(lista.id) : []} productos={productos}
              onCrear={() => crearLista(perfil.sede_id)} onSet={setCantidad}
              onComentario={setComentario} onEnviar={enviar}
            />}
      </div>
    )
  }

  // =================== VISTA JUAN / ADMIN / SUPER ===================
  const enviadas = listas.filter((l) => l.estado === 'enviada')
  const abiertas = listas.filter((l) => l.estado === 'abierta')
  return (
    <div className="pagina">
      <h1>📝 Listas de las sedes</h1>
      <p className="pagina-sub">Lo que enviaron las sedes. Libéralas si hay que corregir. El consolidado sumado está en Compras → Pedidos.</p>
      {msg && <div className="alerta">{msg}</div>}

      <h2 className="sub-titulo">✅ Enviadas ({enviadas.length})</h2>
      {enviadas.length === 0 && <p className="nota">Ninguna sede ha enviado su lista todavía.</p>}
      {enviadas.map((l) => (
        <ListaSede key={l.id} lista={l} items={itemsDe(l.id)} nombreSede={nombreSede}
          acciones={<>
            <button className="btn-mini" onClick={() => cambiarEstado(l, 'abierta')}>🔓 Liberar (para corregir)</button>
            <button className="btn-mini btn-ok" onClick={() => cambiarEstado(l, 'atendida')}>✓ Marcar atendida</button>
          </>} />
      ))}

      {abiertas.length > 0 && <>
        <h2 className="sub-titulo" style={{ marginTop: 20 }}>✏️ En preparación ({abiertas.length})</h2>
        <p className="nota">Estas sedes todavía están armando su lista (aún no la envían).</p>
        {abiertas.map((l) => (
          <ListaSede key={l.id} lista={l} items={itemsDe(l.id)} nombreSede={nombreSede} />
        ))}
      </>}
    </div>
  )
}

// ---------------------------------------------------------------------
// Editor de cocina: todos los productos con +/− grandes, buscador y comentario.
function EditorCocina({ lista, items, productos, onCrear, onSet, onComentario, onEnviar }) {
  const [busca, setBusca] = useState('')
  const cantDe = (pid) => items.find((x) => x.producto_id === pid)?.cantidad || 0
  const fil = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const arr = q ? productos.filter((p) => p.nombre.toLowerCase().includes(q)) : productos
    // Los que ya tienen cantidad, primero.
    return [...arr].sort((a, b) => (cantDe(b.id) > 0) - (cantDe(a.id) > 0) || a.nombre.localeCompare(b.nombre))
  }, [productos, busca, items])
  const enLista = items.length

  async function tocar(prod, delta) {
    let l = lista
    if (!l) { l = await onCrear(); if (!l) return }
    onSet(l, prod, cantDe(prod.id) + delta)
  }

  return (
    <div>
      <p className="pagina-sub">Marca con ➕ lo que hace falta. Esta lista es tu guía: cuando esté lista, envíala a Juan.</p>

      <textarea className="lista-comentario" placeholder="Comentario para Juan (opcional): ej. 'la fresa que sea grande', 'urgente el hielo'…"
        defaultValue={lista?.comentario || ''} onBlur={(e) => lista && onComentario(lista, e.target.value)} />

      <div className="form-inline">
        <input placeholder="🔎 Buscar producto…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 220, fontSize: 16 }} />
        <span className="nota" style={{ alignSelf: 'center' }}>{enLista} en la lista</span>
      </div>

      <div className="lista-grid">
        {fil.map((p) => {
          const c = cantDe(p.id)
          return (
            <div key={p.id} className={`lista-item ${c > 0 ? 'activo' : ''}`}>
              <div className="li-nombre"><strong>{p.nombre}</strong> <span className="nota">{p.unidad}</span></div>
              <div className="li-controles">
                <button className="li-btn" onClick={() => tocar(p, -1)} disabled={c === 0}>−</button>
                <span className="li-cant">{c || ''}</span>
                <button className="li-btn li-mas" onClick={() => tocar(p, +1)}>+</button>
              </div>
            </div>
          )
        })}
        {fil.length === 0 && <p className="nota">No hay productos que coincidan. Los agrega Juan en Compras → Catálogo.</p>}
      </div>

      <div className="lista-enviar-barra">
        <button className="btn-guardar" disabled={enLista === 0} onClick={() => onEnviar(lista)}>
          📨 Enviar lista a Juan ({enLista})
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Lo que ve la cocina cuando ya envió: bloqueada.
function ListaEnviada({ lista, items }) {
  return (
    <div>
      <div className="aviso-ok" style={{ marginBottom: 12 }}>
        ✅ Lista <b>enviada a Juan</b>. Quedó bloqueada. Si necesitas cambiar algo, pídele a Juan que la libere.
      </div>
      {lista.comentario && <p className="nota">💬 {lista.comentario}</p>}
      <table className="tabla">
        <thead><tr><th>Producto</th><th>Cantidad</th></tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}><td><strong>{it.nombre_libre}</strong></td><td>{it.cantidad} {it.unidad || ''}</td></tr>
          ))}
          {items.length === 0 && <tr><td colSpan="2" className="nota">Lista vacía.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------
// Una lista de sede vista por Juan/admin.
function ListaSede({ lista, items, nombreSede, acciones }) {
  const pend = items.filter((x) => !x.comprado).length
  return (
    <div className="panel-detalle">
      <h3>{nombreSede(lista.sede_id)} <span className="nota">· {lista.fecha} · {items.length} productos</span></h3>
      {lista.comentario && <p className="nota">💬 {lista.comentario}</p>}
      {items.length === 0 ? <p className="nota">Sin productos.</p> : (
        <table className="tabla">
          <thead><tr><th>Producto</th><th>Cantidad</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}><td><strong>{it.nombre_libre}</strong></td><td>{it.cantidad} {it.unidad || ''}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {acciones && <div className="acciones" style={{ marginTop: 8 }}>{acciones}</div>}
    </div>
  )
}
