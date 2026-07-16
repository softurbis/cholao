import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useAuth } from '../context/AuthContext'

const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function Ranking({ titulo, filas, max, color = 'var(--rojo)' }) {
  return (
    <div>
      <h2 className="sub-titulo">{titulo}</h2>
      <table className="tabla">
        <tbody>
          {filas.map(([nombre, monto], i) => (
            <tr key={nombre}>
              <td style={{ width: 24, color: '#9aa0a6' }}>{i + 1}</td>
              <td><strong>{nombre}</strong></td>
              <td style={{ whiteSpace: 'nowrap' }}>{soles(monto)}</td>
              <td style={{ width: '30%' }}><div className="barra" style={{ background: color, width: `${(monto / max) * 100}%` }} /></td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td className="nota">Sin datos.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// Dropdown que incluye el valor actual (aunque no esté en el catálogo) y una opción para crear
function SelectCat({ value, opciones, onChange, onCrear, placeholder }) {
  return (
    <select value={value || ''} onChange={async (e) => {
      if (e.target.value === '__nuevo__') { const nv = await onCrear(); if (nv) onChange(nv) }
      else onChange(e.target.value)
    }}>
      <option value="">{placeholder || '—'}</option>
      {value && !opciones.includes(value) && <option value={value}>{value} (actual)</option>}
      {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value="__nuevo__">➕ Crear nuevo…</option>
    </select>
  )
}

export default function Compras() {
  const { perfil } = useAuth()
  const esAdmin = !perfil || perfil.rol === 'superadmin' || perfil.rol === 'gerente'

  const [compras, setCompras] = useState([])
  const [entregas, setEntregas] = useState([])
  const [fondo, setFondo] = useState([])
  const [sedes, setSedes] = useState([])
  const [cargando, setCargando] = useState(true)

  const hoy = new Date()
  const [desde, setDesde] = useState(fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1)))
  const [hasta, setHasta] = useState(fmt(hoy))
  const [fSede, setFSede] = useState('')
  const [fProv, setFProv] = useState('')
  const [busca, setBusca] = useState('')
  const [vista, setVista] = useState('resumen')
  const [edit, setEdit] = useState(null)          // {tabla, id} en edición
  const [borr, setBorr] = useState({})            // borrador de edición
  const [catProd, setCatProd] = useState([])      // catálogo de productos (compras_productos)
  const [catProv, setCatProv] = useState([])      // catálogo de proveedores

  useEffect(() => {
    (async () => {
      const [c, e, f, { data: s }, { data: cp }, { data: cv }] = await Promise.all([
        fetchAll('compras', 'id, fecha, nombre_libre, cantidad, unidad, precio_unitario, total, proveedor, destino_sede_id, comprobante'),
        fetchAll('entregas', 'id, fecha, producto, cantidad, presentacion, sede_id, total'),
        fetchAll('fondo_compras_dia', '*'),
        supabase.from('sedes').select('id, nombre').order('nombre'),
        supabase.from('compras_productos').select('nombre').order('nombre'),
        supabase.from('proveedores').select('nombre').order('nombre'),
      ])
      setCompras(c); setEntregas(e); setFondo(f); setSedes(s || [])
      setCatProd((cp || []).map((x) => x.nombre)); setCatProv((cv || []).map((x) => x.nombre))
      setCargando(false)
    })()
  }, [])

  async function crearEnCatalogo(tabla, setCat) {
    const nombre = prompt(`Nombre del nuevo ${tabla === 'proveedores' ? 'proveedor' : 'producto'}:`)?.trim()
    if (!nombre) return null
    await supabase.from(tabla).insert({ nombre })
    setCat((prev) => [...prev, nombre].sort((a, b) => a.localeCompare(b)))
    return nombre
  }

  const sedeN = useMemo(() => Object.fromEntries(sedes.map((s) => [s.id, s.nombre])), [sedes])
  const provs = useMemo(() => [...new Set(compras.map((x) => x.proveedor))].filter(Boolean).sort(), [compras])
  const productos = useMemo(() => [...new Set([...compras.map((x) => x.nombre_libre), ...entregas.map((x) => x.producto)])].filter(Boolean).sort(), [compras, entregas])

  const enRango = (fecha) => (!desde || fecha >= desde) && (!hasta || fecha <= hasta)
  const matchProd = (p) => !busca || (p || '').toLowerCase().includes(busca.toLowerCase())

  const fil = useMemo(() => compras.filter((x) => enRango(x.fecha)
    && (!fSede || x.destino_sede_id === fSede) && (!fProv || x.proveedor === fProv) && matchProd(x.nombre_libre)
  ), [compras, desde, hasta, fSede, fProv, busca])
  const tot = fil.reduce((a, x) => a + Number(x.total || 0), 0)

  const rankProv = useMemo(() => {
    const m = {}; for (const x of fil) { const k = x.proveedor || '(sin proveedor)'; m[k] = (m[k] || 0) + Number(x.total || 0) }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [fil])
  const rankProd = useMemo(() => {
    const m = {}; for (const x of fil) { const k = (x.nombre_libre || '—').toUpperCase().trim(); m[k] = (m[k] || 0) + Number(x.total || 0) }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [fil])

  const entF = useMemo(() => entregas.filter((x) => enRango(x.fecha) && (!fSede || x.sede_id === fSede) && matchProd(x.producto)), [entregas, desde, hasta, fSede, busca])
  const entPorSede = useMemo(() => {
    const m = {}; for (const x of entF) { const k = sedeN[x.sede_id] || '—'; m[k] = (m[k] || 0) + Number(x.total || 0) }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [entF, sedeN])

  const fondoF = useMemo(() => fondo.filter((x) => enRango(x.fecha) && (Number(x.gasto_total) || Number(x.dinero_total) || Number(x.efectivo_manana))), [fondo, desde, hasta])
  const fondoTot = fondoF.reduce((a, x) => ({
    rec: a.rec + Number(x.efectivo_manana || 0) + Number(x.efectivo_tarde || 0),
    gas: a.gas + Number(x.gasto_total || 0), adm: a.adm + Number(x.entrega_admin || 0),
  }), { rec: 0, gas: 0, adm: 0 })

  function iniciarEdit(tabla, row) {
    setEdit({ tabla, id: row.id })
    setBorr(tabla === 'compras'
      ? { nombre_libre: row.nombre_libre || '', proveedor: row.proveedor || '', destino_sede_id: row.destino_sede_id || '' }
      : { producto: row.producto || '', sede_id: row.sede_id || '' })
  }
  async function guardar() {
    const campos = { ...borr }
    for (const k of ['destino_sede_id', 'sede_id']) if (k in campos && !campos[k]) campos[k] = null
    if (edit.tabla === 'compras') setCompras((p) => p.map((c) => c.id === edit.id ? { ...c, ...campos } : c))
    else setEntregas((p) => p.map((c) => c.id === edit.id ? { ...c, ...campos } : c))
    await supabase.from(edit.tabla).update(campos).eq('id', edit.id)
    setEdit(null)
  }

  if (cargando) return <div className="pagina"><h1>🛒 Compras</h1><p className="nota">Cargando…</p></div>

  const enEdit = (tabla, id) => edit && edit.tabla === tabla && edit.id === id

  return (
    <div className="pagina">
      <h1>Compras <span className="titulo-tag">Juan</span></h1>
      <p className="pagina-sub">Compras diarias con efectivo de caja, entregas a sedes y cuadre del fondo.</p>

      <datalist id="lista-productos">{productos.map((p) => <option key={p} value={p} />)}</datalist>

      <div className="filtros">
        <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="campo"><span>Sede</span>
          <select value={fSede} onChange={(e) => setFSede(e.target.value)}>
            <option value="">Todas</option>{sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <label className="campo"><span>Proveedor</span>
          <select value={fProv} onChange={(e) => setFProv(e.target.value)}>
            <option value="">Todos</option>{provs.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="campo campo-ancho"><span>🔎 Producto</span>
          <input list="lista-productos" placeholder="ej. papa, vaso, chantilly…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
      </div>

      <div className="tarjetas" style={{ marginBottom: 18 }}>
        <div className="tarjeta"><span className="t-label">Total comprado</span><span className="t-valor">{soles(tot)}</span></div>
        <div className="tarjeta"><span className="t-label">Compras</span><span className="t-valor">{fil.length.toLocaleString('es-PE')}</span></div>
        <div className="tarjeta"><span className="t-label">Proveedor top</span><span className="t-valor" style={{ fontSize: 15 }}>{rankProv[0]?.[0] || '—'}</span></div>
        <div className="tarjeta"><span className="t-label">Producto top</span><span className="t-valor" style={{ fontSize: 15 }}>{rankProd[0]?.[0] || '—'}</span></div>
      </div>

      <div className="tab-bar">
        {[['resumen', 'Rankings'], ['compras', 'Compras'], ['entregas', 'Entregas'], ['fondo', 'Fondo de Juan']].map(([k, l]) => (
          <button key={k} className={vista === k ? 'tab activo' : 'tab'} onClick={() => setVista(k)}>{l}</button>
        ))}
      </div>

      {vista === 'resumen' && (
        <div className="dos-cols">
          <Ranking titulo="Proveedores más comprados" filas={rankProv.slice(0, 15)} max={rankProv[0]?.[1] || 1} />
          <Ranking titulo="Productos más comprados" filas={rankProd.slice(0, 15)} max={rankProd[0]?.[1] || 1} color="var(--azul)" />
        </div>
      )}

      {vista === 'compras' && (<>
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Proveedor</th><th>Monto</th><th>Sede</th><th>Comp.</th>{esAdmin && <th></th>}</tr></thead>
          <tbody>
            {fil.slice(0, 300).map((x) => enEdit('compras', x.id) ? (
              <tr key={x.id} className="fila-edit">
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td><SelectCat value={borr.nombre_libre} opciones={catProd} placeholder="Producto…" onChange={(v) => setBorr({ ...borr, nombre_libre: v })} onCrear={() => crearEnCatalogo('compras_productos', setCatProd)} /></td>
                <td>{x.cantidad}</td>
                <td><SelectCat value={borr.proveedor} opciones={catProv} placeholder="Proveedor…" onChange={(v) => setBorr({ ...borr, proveedor: v })} onCrear={() => crearEnCatalogo('proveedores', setCatProv)} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{soles(x.total)}</td>
                <td><select value={borr.destino_sede_id} onChange={(e) => setBorr({ ...borr, destino_sede_id: e.target.value })}><option value="">Oficina</option>{sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></td>
                <td className="nota">{x.comprobante || '—'}</td>
                <td className="acciones"><button className="btn-mini" onClick={guardar}>✓</button><button className="btn-mini" onClick={() => setEdit(null)}>✕</button></td>
              </tr>
            ) : (
              <tr key={x.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td><strong>{x.nombre_libre}</strong> <span className="nota">{x.unidad || ''}</span></td>
                <td>{x.cantidad}</td>
                <td>{x.proveedor || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{soles(x.total)}</td>
                <td>{sedeN[x.destino_sede_id] || 'Oficina'}</td>
                <td className="nota">{x.comprobante || '—'}</td>
                {esAdmin && <td><button className="btn-mini" title="Editar" onClick={() => iniciarEdit('compras', x)}>✏️</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="lista-prov">{provs.map((p) => <option key={p} value={p} />)}</datalist>
        {fil.length > 300 && <p className="nota">Mostrando 300 de {fil.length} — afina los filtros.</p>}
      </>)}

      {vista === 'entregas' && (<>
        <div className="tarjetas" style={{ marginBottom: 16 }}>
          {entPorSede.map(([n, v]) => (<div className="tarjeta" key={n}><span className="t-label">Entregado a {n}</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(v)}</span></div>))}
        </div>
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Sede</th><th>Total</th>{esAdmin && <th></th>}</tr></thead>
          <tbody>
            {entF.slice(0, 300).map((x) => enEdit('entregas', x.id) ? (
              <tr key={x.id} className="fila-edit">
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td><SelectCat value={borr.producto} opciones={catProd} placeholder="Producto…" onChange={(v) => setBorr({ ...borr, producto: v })} onCrear={() => crearEnCatalogo('compras_productos', setCatProd)} /></td>
                <td>{x.cantidad ?? '—'}</td>
                <td><select value={borr.sede_id} onChange={(e) => setBorr({ ...borr, sede_id: e.target.value })}><option value="">—</option>{sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></td>
                <td>{Number(x.total) ? soles(x.total) : <span className="nota">s/v</span>}</td>
                <td className="acciones"><button className="btn-mini" onClick={guardar}>✓</button><button className="btn-mini" onClick={() => setEdit(null)}>✕</button></td>
              </tr>
            ) : (
              <tr key={x.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td><strong>{x.producto}</strong> <span className="nota">{x.presentacion || ''}</span></td>
                <td>{x.cantidad ?? '—'}</td>
                <td>{sedeN[x.sede_id] || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{Number(x.total) ? soles(x.total) : <span className="nota">sin valorizar</span>}</td>
                {esAdmin && <td><button className="btn-mini" title="Editar" onClick={() => iniciarEdit('entregas', x)}>✏️</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {entF.length > 300 && <p className="nota">Mostrando 300 de {entF.length}.</p>}
      </>)}

      {vista === 'fondo' && (<>
        <div className="tarjetas" style={{ marginBottom: 16 }}>
          <div className="tarjeta"><span className="t-label">Efectivo recibido de cajas</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(fondoTot.rec)}</span></div>
          <div className="tarjeta"><span className="t-label">Gastado en compras</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(fondoTot.gas)}</span></div>
          <div className="tarjeta"><span className="t-label">Entregado a administración</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(fondoTot.adm)}</span></div>
        </div>
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Base</th><th>Efec. mañana</th><th>Efec. tarde</th><th>Gasto</th><th>A admin.</th><th>Vuelto/Saldo</th></tr></thead>
          <tbody>
            {fondoF.slice(0, 120).map((x) => (
              <tr key={x.fecha}>
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td>{soles(x.base_inicial)}</td><td>{soles(x.efectivo_manana)}</td><td>{soles(x.efectivo_tarde)}</td>
                <td style={{ color: 'var(--rojo)' }}>{soles(x.gasto_total)}</td><td>{soles(x.entrega_admin)}</td>
                <td style={{ fontWeight: 700 }}>{soles(x.vuelto_saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>)}
    </div>
  )
}
