import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'

const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic']
const labelYm = (ym) => ym ? `${MES[+ym.slice(5, 7)]} ${ym.slice(0, 4)}` : ''

function Ranking({ titulo, filas, max }) {
  return (
    <div>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>{titulo}</h2>
      <table className="tabla">
        <tbody>
          {filas.map(([nombre, monto, extra], i) => (
            <tr key={nombre}>
              <td style={{ width: 24, color: '#999' }}>{i + 1}</td>
              <td><strong>{nombre}</strong>{extra ? <span className="nota" style={{ marginLeft: 6 }}>{extra}</span> : null}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{soles(monto)}</td>
              <td style={{ width: '30%' }}><div style={{ height: 8, background: 'var(--rojo)', borderRadius: 3, width: `${(monto / max) * 100}%`, minWidth: 2 }} /></td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td className="nota">Sin datos.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export default function Compras() {
  const [compras, setCompras] = useState([])
  const [entregas, setEntregas] = useState([])
  const [fondo, setFondo] = useState([])
  const [sedes, setSedes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [fSede, setFSede] = useState('')
  const [fProv, setFProv] = useState('')
  const [busca, setBusca] = useState('')
  const [vista, setVista] = useState('resumen')  // resumen | detalle | entregas | fondo

  useEffect(() => {
    (async () => {
      const [c, e, f, { data: s }] = await Promise.all([
        fetchAll('compras', 'fecha, nombre_libre, cantidad, unidad, precio_unitario, total, proveedor, destino_sede_id, comprobante'),
        fetchAll('entregas', 'fecha, producto, cantidad, presentacion, sede_id, total'),
        fetchAll('fondo_compras_dia', '*'),
        supabase.from('sedes').select('id, nombre').order('nombre'),
      ])
      setCompras(c); setEntregas(e); setFondo(f); setSedes(s || []); setCargando(false)
    })()
  }, [])

  const sedeN = useMemo(() => Object.fromEntries(sedes.map((s) => [s.id, s.nombre])), [sedes])
  const meses = useMemo(() => [...new Set(compras.map((x) => (x.fecha || '').slice(0, 7)))].filter(Boolean).sort(), [compras])
  const provs = useMemo(() => [...new Set(compras.map((x) => x.proveedor))].filter(Boolean).sort(), [compras])

  const enRango = (fecha) => {
    const ym = (fecha || '').slice(0, 7)
    return (!desde || ym >= desde) && (!hasta || ym <= hasta)
  }
  const fil = useMemo(() => compras.filter((x) => enRango(x.fecha)
    && (!fSede || x.destino_sede_id === fSede)
    && (!fProv || x.proveedor === fProv)
    && (!busca || (x.nombre_libre || '').toLowerCase().includes(busca.toLowerCase()))
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

  const entF = useMemo(() => entregas.filter((x) => enRango(x.fecha) && (!fSede || x.sede_id === fSede)), [entregas, desde, hasta, fSede])
  const entPorSede = useMemo(() => {
    const m = {}; for (const x of entF) { const k = sedeN[x.sede_id] || '—'; m[k] = (m[k] || 0) + Number(x.total || 0) }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [entF, sedeN])

  const fondoF = useMemo(() => fondo.filter((x) => enRango(x.fecha) && (Number(x.gasto_total) || Number(x.dinero_total) || Number(x.efectivo_manana))), [fondo, desde, hasta])
  const fondoTot = fondoF.reduce((a, x) => ({
    rec: a.rec + Number(x.efectivo_manana || 0) + Number(x.efectivo_tarde || 0),
    gas: a.gas + Number(x.gasto_total || 0),
    adm: a.adm + Number(x.entrega_admin || 0),
  }), { rec: 0, gas: 0, adm: 0 })

  if (cargando) return <div className="pagina"><h1>🛒 Compras</h1><p className="nota">Cargando…</p></div>

  return (
    <div className="pagina">
      <h1>🛒 Compras (Juan)</h1>
      <p className="pagina-sub">Compras diarias con efectivo de caja, entregas a sedes y cuadre del fondo.</p>

      <div className="form-inline">
        <select value={desde} onChange={(e) => setDesde(e.target.value)}>
          <option value="">Desde (inicio)</option>
          {meses.map((m) => <option key={m} value={m}>{labelYm(m)}</option>)}
        </select>
        <select value={hasta} onChange={(e) => setHasta(e.target.value)}>
          <option value="">Hasta (hoy)</option>
          {meses.map((m) => <option key={m} value={m}>{labelYm(m)}</option>)}
        </select>
        <select value={fSede} onChange={(e) => setFSede(e.target.value)}>
          <option value="">Todas las sedes destino</option>
          {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={fProv} onChange={(e) => setFProv(e.target.value)}>
          <option value="">Todos los proveedores</option>
          {provs.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input placeholder="Buscar producto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <div className="tarjetas" style={{ marginBottom: 16 }}>
        <div className="tarjeta"><span className="t-label">Total comprado</span><span className="t-valor">{soles(tot)}</span></div>
        <div className="tarjeta"><span className="t-label">Compras</span><span className="t-valor">{fil.length.toLocaleString('es-PE')}</span></div>
        <div className="tarjeta"><span className="t-label">Proveedor top</span><span className="t-valor" style={{ fontSize: 16 }}>{rankProv[0]?.[0] || '—'}</span></div>
        <div className="tarjeta"><span className="t-label">Producto top</span><span className="t-valor" style={{ fontSize: 16 }}>{rankProd[0]?.[0] || '—'}</span></div>
      </div>

      <div className="form-inline" style={{ gap: 6 }}>
        {[['resumen', '📊 Rankings'], ['detalle', '📋 Detalle'], ['entregas', '📤 Entregas'], ['fondo', '💰 Fondo Juan']].map(([k, l]) => (
          <button key={k} className="btn-mini" style={vista === k ? { background: 'var(--rojo)', color: '#fff', borderColor: 'var(--rojo)' } : {}} onClick={() => setVista(k)}>{l}</button>
        ))}
      </div>

      {vista === 'resumen' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          <Ranking titulo="🏪 Proveedores más comprados" filas={rankProv.slice(0, 15)} max={rankProv[0]?.[1] || 1} />
          <Ranking titulo="🥭 Productos más comprados" filas={rankProd.slice(0, 15)} max={rankProd[0]?.[1] || 1} />
        </div>
      )}

      {vista === 'detalle' && (
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Proveedor</th><th>Monto</th><th>Sede</th><th>Comprob.</th></tr></thead>
          <tbody>
            {fil.slice(0, 200).map((x, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td><strong>{x.nombre_libre}</strong> <span className="nota">{x.cantidad} {x.unidad || ''}</span></td>
                <td>{x.cantidad}</td>
                <td>{x.proveedor || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{soles(x.total)}</td>
                <td>{sedeN[x.destino_sede_id] || 'Oficina'}</td>
                <td className="nota">{x.comprobante || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {vista === 'detalle' && fil.length > 200 && <p className="nota">Mostrando 200 de {fil.length} — afina los filtros.</p>}

      {vista === 'entregas' && (
        <>
          <div className="tarjetas" style={{ marginBottom: 16 }}>
            {entPorSede.map(([n, v]) => (
              <div className="tarjeta" key={n}><span className="t-label">Entregado a {n}</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(v)}</span></div>
            ))}
          </div>
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Sede</th><th>Total</th></tr></thead>
            <tbody>
              {entF.slice(0, 200).map((x, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                  <td><strong>{x.producto}</strong> <span className="nota">{x.presentacion || ''}</span></td>
                  <td>{x.cantidad ?? '—'}</td>
                  <td>{sedeN[x.sede_id] || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{Number(x.total) ? soles(x.total) : <span className="nota">sin valorizar</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entF.length > 200 && <p className="nota">Mostrando 200 de {entF.length}.</p>}
        </>
      )}

      {vista === 'fondo' && (
        <>
          <div className="tarjetas" style={{ marginBottom: 16 }}>
            <div className="tarjeta"><span className="t-label">Efectivo recibido de cajas</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(fondoTot.rec)}</span></div>
            <div className="tarjeta"><span className="t-label">Gastado en compras</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(fondoTot.gas)}</span></div>
            <div className="tarjeta"><span className="t-label">Entregado a administración</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(fondoTot.adm)}</span></div>
          </div>
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Base</th><th>Efec. mañana</th><th>Efec. tarde</th><th>Gasto</th><th>A admin.</th><th>Vuelto/Saldo</th></tr></thead>
            <tbody>
              {fondoF.slice(0, 100).map((x) => (
                <tr key={x.fecha}>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                  <td>{soles(x.base_inicial)}</td>
                  <td>{soles(x.efectivo_manana)}</td>
                  <td>{soles(x.efectivo_tarde)}</td>
                  <td style={{ color: 'var(--rojo)' }}>{soles(x.gasto_total)}</td>
                  <td>{soles(x.entrega_admin)}</td>
                  <td style={{ fontWeight: 700 }}>{soles(x.vuelto_saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
