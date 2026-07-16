import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const soles = (n) => n == null ? '—' : 'S/ ' + Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Cuadre() {
  const [turnos, setTurnos] = useState([])
  const [sedes, setSedes] = useState([])
  const [fSede, setFSede] = useState('')
  const [fMes, setFMes] = useState('')
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(null)   // turno_id expandido
  const [detalle, setDetalle] = useState({})     // { turno_id: {gastos, descuentos, stock} }

  useEffect(() => {
    (async () => {
      const [{ data: t }, { data: s }] = await Promise.all([
        supabase.from('caja_turno').select('*, sede:sedes(nombre)').order('fecha', { ascending: false }).limit(2000),
        supabase.from('sedes').select('id, nombre').order('nombre'),
      ])
      setTurnos(t || []); setSedes(s || []); setCargando(false)
    })()
  }, [])

  const meses = useMemo(() => [...new Set(turnos.map((x) => (x.fecha || '').slice(0, 7)))].filter(Boolean).sort().reverse(), [turnos])
  const filtrados = useMemo(() => turnos.filter((x) =>
    (!fSede || x.sede_id === fSede) && (!fMes || (x.fecha || '').startsWith(fMes))), [turnos, fSede, fMes])

  const tot = useMemo(() => filtrados.reduce((a, x) => ({
    venta: a.venta + Number(x.venta_total || 0),
    gastos: a.gastos + Number(x.gastos_tienda || 0),
    def: a.def + Number(x.deficit_sobra || 0),
  }), { venta: 0, gastos: 0, def: 0 }), [filtrados])

  async function toggle(t) {
    if (abierto === t.id) { setAbierto(null); return }
    setAbierto(t.id)
    if (!detalle[t.id]) {
      const [{ data: g }, { data: d }, { data: st }] = await Promise.all([
        supabase.from('caja_gastos').select('*').eq('turno_id', t.id),
        supabase.from('caja_descuentos').select('*').eq('turno_id', t.id),
        supabase.from('caja_stock').select('*').eq('turno_id', t.id),
      ])
      setDetalle((prev) => ({ ...prev, [t.id]: { gastos: g || [], descuentos: d || [], stock: st || [] } }))
    }
  }

  return (
    <div className="pagina">
      <h1>🧮 Caja Diaria</h1>
      <p className="pagina-sub">Cuadre por turno: venta, medios de pago, gastos, descuentos al personal y stock.</p>

      <div className="tarjetas" style={{ marginBottom: 16 }}>
        <div className="tarjeta"><span className="t-label">Venta contada</span><span className="t-valor">{soles(tot.venta)}</span></div>
        <div className="tarjeta"><span className="t-label">Gastos tienda</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(tot.gastos)}</span></div>
        <div className="tarjeta"><span className="t-label">Déficit/Sobra neto</span><span className="t-valor" style={{ fontSize: 20, color: tot.def < 0 ? 'var(--rojo)' : '#1a7f37' }}>{soles(tot.def)}</span></div>
        <div className="tarjeta"><span className="t-label">Turnos</span><span className="t-valor">{filtrados.length}</span></div>
      </div>

      <div className="form-inline">
        <select value={fSede} onChange={(e) => setFSede(e.target.value)}>
          <option value="">Todas las sedes</option>
          {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={fMes} onChange={(e) => setFMes(e.target.value)}>
          <option value="">Todos los meses</option>
          {meses.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {cargando ? <p className="nota">Cargando…</p> : (
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Turno</th><th>Sede</th><th>Cajero</th><th>Venta</th><th>Sistema</th><th>Déf/Sobra</th><th></th></tr></thead>
          <tbody>
            {filtrados.map((t) => (
              <FragmentRow key={t.id} t={t} abierto={abierto === t.id} onToggle={() => toggle(t)} det={detalle[t.id]} />
            ))}
            {filtrados.length === 0 && <tr><td colSpan="8" className="nota">Sin turnos para el filtro.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  )
}

function FragmentRow({ t, abierto, onToggle, det }) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        <td style={{ whiteSpace: 'nowrap' }}>{t.fecha}</td>
        <td>{t.turno}</td>
        <td>{t.sede?.nombre || '—'}</td>
        <td>{t.cajero || '—'}</td>
        <td>{soles(t.venta_total)}</td>
        <td>{soles(t.venta_sistema)}</td>
        <td style={{ color: Number(t.deficit_sobra) < 0 ? 'var(--rojo)' : '#1a7f37' }}>{soles(t.deficit_sobra)}</td>
        <td>{abierto ? '▲' : '▼'}</td>
      </tr>
      {abierto && (
        <tr><td colSpan="8" style={{ background: '#fafafa' }}>
          <div style={{ display: 'grid', gap: 14, padding: '6px 4px 12px' }}>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13.5 }}>
              <span><strong>Tarjeta</strong> {soles(t.tarjeta)}</span>
              <span><strong>Plin</strong> {soles(t.plin)}</span>
              <span><strong>Yape QR</strong> {soles(t.yape_qr)}</span>
              <span><strong>Yape Fotos</strong> {soles(t.yape_fotos)}</span>
              <span><strong>Yape Total</strong> {soles(t.yape_total)}</span>
              <span><strong>Efectivo</strong> {soles(t.efectivo)}</span>
              <span><strong>Meta</strong> {soles(t.meta_turno)}</span>
              {t.rendimiento && <span>· {t.rendimiento}</span>}
              {t.clima && <span>· {t.clima}</span>}
            </div>
            {!det ? <span className="nota">Cargando detalle…</span> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <MiniTabla titulo={`Gastos tienda (${det.gastos.length})`} filas={det.gastos.map(g => [g.descripcion, soles(g.monto), g.detalle])} />
                <MiniTabla titulo={`Descuentos personal (${det.descuentos.length})`} filas={det.descuentos.map(d => [d.persona, soles(d.monto), d.tipo])} />
                <MiniTabla titulo={`Stock (${det.stock.length})`} filas={det.stock.map(s => [s.producto, `vend ${s.vendido ?? '—'}`, `cierre ${s.cierre ?? '—'}`])} />
              </div>
            )}
          </div>
        </td></tr>
      )}
    </>
  )
}

function MiniTabla({ titulo, filas }) {
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{titulo}</div>
      {filas.length === 0 ? <span className="nota">—</span> : (
        <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
          <tbody>{filas.map((f, i) => (
            <tr key={i}><td style={{ padding: '2px 6px' }}>{f[0]}</td><td style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}>{f[1]}</td><td style={{ padding: '2px 6px', color: '#888' }}>{f[2]}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}
