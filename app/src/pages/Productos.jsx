import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n) => Number(n || 0).toLocaleString('es-PE')

export default function Productos() {
  const [rows, setRows] = useState([])
  const [sedes, setSedes] = useState([])
  const [fSede, setFSede] = useState('')
  const [fCat, setFCat] = useState('')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    (async () => {
      const [{ data: r }, { data: s }] = await Promise.all([
        supabase.from('ventas_productos').select('*').limit(20000),
        supabase.from('sedes').select('id, nombre').order('nombre'),
      ])
      setRows(r || []); setSedes(s || []); setCargando(false)
    })()
  }, [])

  const cats = useMemo(() => [...new Set(rows.map((x) => x.categoria))].filter(Boolean).sort(), [rows])
  const fil = useMemo(() => rows.filter((x) =>
    (!fSede || x.sede_id === fSede) && (!fCat || x.categoria === fCat)), [rows, fSede, fCat])

  // Ranking por producto (suma presentaciones/filas)
  const ranking = useMemo(() => {
    const m = {}
    for (const x of fil) {
      const k = x.producto || '—'
      m[k] ??= { producto: k, categoria: x.categoria, cant: 0, monto: 0, salon: 0, mostrador: 0, delivery: 0 }
      m[k].cant += Number(x.cant_total || 0); m[k].monto += Number(x.total || 0)
      m[k].salon += Number(x.cant_salon || 0); m[k].mostrador += Number(x.cant_mostrador || 0); m[k].delivery += Number(x.cant_delivery || 0)
    }
    return Object.values(m).sort((a, b) => b.monto - a.monto)
  }, [fil])

  const porCat = useMemo(() => {
    const m = {}; for (const x of fil) m[x.categoria] = (m[x.categoria] || 0) + Number(x.total || 0)
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [fil])

  const totMonto = fil.reduce((a, x) => a + Number(x.total || 0), 0)
  const totCant = fil.reduce((a, x) => a + Number(x.cant_total || 0), 0)
  const maxMonto = Math.max(1, ...ranking.map((r) => r.monto))

  if (cargando) return <div className="pagina"><h1>🍧 Productos</h1><p className="nota">Cargando…</p></div>

  return (
    <div className="pagina">
      <h1>🍧 Productos más vendidos</h1>
      <p className="pagina-sub">Ranking, venta por categoría y por canal. (Con lo cargado; se llena al subir más exportados.)</p>

      <div className="tarjetas" style={{ marginBottom: 16 }}>
        <div className="tarjeta"><span className="t-label">Venta en productos</span><span className="t-valor">{soles(totMonto)}</span></div>
        <div className="tarjeta"><span className="t-label">Unidades vendidas</span><span className="t-valor">{num(totCant)}</span></div>
        <div className="tarjeta"><span className="t-label">Productos distintos</span><span className="t-valor">{ranking.length}</span></div>
        <div className="tarjeta"><span className="t-label">Top producto</span><span className="t-valor" style={{ fontSize: 17 }}>{ranking[0]?.producto || '—'}</span></div>
      </div>

      <div className="form-inline">
        <select value={fSede} onChange={(e) => setFSede(e.target.value)}>
          <option value="">Todas las sedes</option>
          {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {porCat.length > 0 && (
        <div className="tarjetas" style={{ marginBottom: 18 }}>
          {porCat.slice(0, 8).map(([c, v]) => (
            <div className="tarjeta" key={c}><span className="t-label">{c}</span><span className="t-valor" style={{ fontSize: 18 }}>{soles(v)}</span></div>
          ))}
        </div>
      )}

      <table className="tabla">
        <thead><tr><th>#</th><th>Producto</th><th>Categoría</th><th>Unid.</th><th>Monto</th><th>Salón / Most. / Deliv.</th><th style={{ width: '22%' }}></th></tr></thead>
        <tbody>
          {ranking.map((r, i) => (
            <tr key={r.producto}>
              <td>{i + 1}</td>
              <td><strong>{r.producto}</strong></td>
              <td>{r.categoria}</td>
              <td>{num(r.cant)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{soles(r.monto)}</td>
              <td style={{ fontSize: 12.5, color: '#666' }}>{num(r.salon)} / {num(r.mostrador)} / {num(r.delivery)}</td>
              <td><div style={{ height: 8, background: 'var(--rojo)', borderRadius: 3, width: `${(r.monto / maxMonto) * 100}%`, minWidth: 2 }} /></td>
            </tr>
          ))}
          {ranking.length === 0 && <tr><td colSpan="7" className="nota">Sin datos de productos para el filtro.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
