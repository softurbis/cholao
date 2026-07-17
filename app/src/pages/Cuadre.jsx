import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useAuth } from '../context/AuthContext'
import { puedeEditar } from '../lib/roles'

const soles = (n) => n == null ? '—' : 'S/ ' + Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Cuadre() {
  const { perfil } = useAuth()
  // Validar y borrar cajas es EDITAR: superusuario y administrador. Gerencia solo mira.
  const esAdmin = puedeEditar(perfil)
  const [turnos, setTurnos] = useState([])
  const [sedes, setSedes] = useState([])
  const [gastosCaja, setGastosCaja] = useState([])   // gastos de tienda (con fecha/sede del turno)
  const [descCaja, setDescCaja] = useState([])       // adelantos/descuentos al personal
  const [fSede, setFSede] = useState('')
  const [fMes, setFMes] = useState('')
  const [cargando, setCargando] = useState(true)
  const [verRankings, setVerRankings] = useState(false)
  const [soloPend, setSoloPend] = useState(false)
  const [abierto, setAbierto] = useState(null)   // turno_id expandido
  const [detalle, setDetalle] = useState({})     // { turno_id: {gastos, descuentos, stock} }

  useEffect(() => {
    (async () => {
      const [{ data: t }, { data: s }, g, d] = await Promise.all([
        supabase.from('caja_turno').select('*, sede:sedes(nombre)').order('fecha', { ascending: false }).limit(2000),
        supabase.from('sedes').select('id, nombre').order('nombre'),
        fetchAll('caja_gastos', 'descripcion, monto, detalle, turno:caja_turno(fecha, sede_id)', 'id'),
        fetchAll('caja_descuentos', 'persona, monto, tipo, turno:caja_turno(fecha, sede_id)', 'id'),
      ])
      setTurnos(t || []); setSedes(s || []); setGastosCaja(g); setDescCaja(d); setCargando(false)
    })()
  }, [])

  const meses = useMemo(() => [...new Set(turnos.map((x) => (x.fecha || '').slice(0, 7)))].filter(Boolean).sort().reverse(), [turnos])
  const filtrados = useMemo(() => turnos.filter((x) =>
    (!fSede || x.sede_id === fSede) && (!fMes || (x.fecha || '').startsWith(fMes))
    && (!soloPend || (!x.validado && x.origen_archivo === 'registro-app'))), [turnos, fSede, fMes, soloPend])
  const porValidar = useMemo(() => turnos.filter((x) => !x.validado && x.origen_archivo === 'registro-app').length, [turnos])

  const tot = useMemo(() => filtrados.reduce((a, x) => ({
    venta: a.venta + Number(x.venta_total || 0),
    gastos: a.gastos + Number(x.gastos_tienda || 0),
    def: a.def + Number(x.deficit_sobra || 0),
  }), { venta: 0, gastos: 0, def: 0 }), [filtrados])

  // Gastos de caja (tienda) y adelantos, con los mismos filtros de sede/mes
  const pasaFiltro = (x) => x.turno
    && (!fSede || x.turno.sede_id === fSede)
    && (!fMes || (x.turno.fecha || '').startsWith(fMes))
  const gastosF = useMemo(() => gastosCaja.filter(pasaFiltro), [gastosCaja, fSede, fMes])
  const descF = useMemo(() => descCaja.filter(pasaFiltro), [descCaja, fSede, fMes])
  const totGastosCaja = gastosF.reduce((a, x) => a + Number(x.monto || 0), 0)
  const totDesc = descF.reduce((a, x) => a + Number(x.monto || 0), 0)
  const rankGastos = useMemo(() => {
    const m = {}; for (const x of gastosF) { const k = (x.descripcion || '—').toUpperCase().trim(); m[k] = (m[k] || 0) + Number(x.monto || 0) }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [gastosF])
  const rankDesc = useMemo(() => {
    const m = {}; for (const x of descF) { const k = (x.persona || '—').toUpperCase().trim(); m[k] = (m[k] || 0) + Number(x.monto || 0) }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [descF])

  // Elimina un turno completo (para limpiar pruebas). Solo superadmin/gerente.
  async function eliminarTurno(t, e) {
    e.stopPropagation()
    if (!confirm(`¿Eliminar el turno del ${t.fecha} (${t.turno}) de ${t.sede?.nombre}?\nSe borra todo: gastos, adelantos, stock y archivos.`)) return
    const { data: adj } = await supabase.from('caja_adjuntos').select('archivo').eq('turno_id', t.id)
    if (adj?.length) await supabase.storage.from('arqueos').remove(adj.map((a) => a.archivo))
    const { error } = await supabase.from('caja_turno').delete().eq('id', t.id)
    if (error) { alert('Error: ' + error.message); return }
    setTurnos((p) => p.filter((x) => x.id !== t.id))
  }

  async function toggle(t) {
    if (abierto === t.id) { setAbierto(null); return }
    setAbierto(t.id)
    if (!detalle[t.id]) {
      const [{ data: g }, { data: d }, { data: st }, { data: adj }] = await Promise.all([
        supabase.from('caja_gastos').select('*').eq('turno_id', t.id),
        supabase.from('caja_descuentos').select('*').eq('turno_id', t.id),
        supabase.from('caja_stock').select('*').eq('turno_id', t.id),
        supabase.from('caja_adjuntos').select('*').eq('turno_id', t.id),
      ])
      // links temporales para poder abrir los archivos (el bucket es privado)
      const archivos = []
      for (const a of adj || []) {
        const { data: s } = await supabase.storage.from('arqueos').createSignedUrl(a.archivo, 3600)
        archivos.push({ ...a, url: s?.signedUrl })
      }
      setDetalle((prev) => ({ ...prev, [t.id]: { gastos: g || [], descuentos: d || [], stock: st || [], archivos } }))
    }
  }

  // El admin revisa los comprobantes y da el OK
  async function validar(t, e) {
    e.stopPropagation()
    const nota = prompt(`Dar OK al turno del ${t.fecha} (${t.turno}) de ${t.sede?.nombre}.\n\nObservación (opcional):`)
    if (nota === null) return
    const { error } = await supabase.from('caja_turno').update({
      validado: true, validado_por: perfil?.id || null,
      validado_en: new Date().toISOString(), nota_validacion: nota || null,
    }).eq('id', t.id)
    if (error) { alert('Error: ' + error.message); return }
    setTurnos((p) => p.map((x) => x.id === t.id ? { ...x, validado: true, validado_en: new Date().toISOString() } : x))
  }
  async function quitarValidacion(t, e) {
    e.stopPropagation()
    if (!confirm('¿Quitar el OK de este turno?')) return
    await supabase.from('caja_turno').update({ validado: false, validado_por: null, validado_en: null }).eq('id', t.id)
    setTurnos((p) => p.map((x) => x.id === t.id ? { ...x, validado: false, validado_en: null } : x))
  }

  return (
    <div className="pagina">
      <h1>🧮 Caja Diaria</h1>
      <p className="pagina-sub">Cuadre por turno: venta, medios de pago, gastos, descuentos al personal y stock.</p>

      <div className="tarjetas" style={{ marginBottom: 16 }}>
        <div className="tarjeta"><span className="t-label">Venta contada</span><span className="t-valor">{soles(tot.venta)}</span></div>
        <div className="tarjeta"><span className="t-label">💸 Gastos de caja (tienda)</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(totGastosCaja)}</span></div>
        <div className="tarjeta"><span className="t-label">👥 Adelantos/desc. personal</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(totDesc)}</span></div>
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
        <button className="btn-mini" style={verRankings ? { background: 'var(--rojo)', color: '#fff', borderColor: 'var(--rojo)' } : {}}
          onClick={() => setVerRankings(!verRankings)}>📊 Ver rankings</button>
        {esAdmin && porValidar > 0 && (
          <button className="btn-mini" style={soloPend ? { background: '#e0a800', color: '#fff', borderColor: '#e0a800' } : { borderColor: '#e0a800', color: '#8a6d00' }}
            onClick={() => setSoloPend(!soloPend)}>⏳ Por validar ({porValidar})</button>
        )}
      </div>

      {verRankings && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>💸 Gastos de caja por concepto</h2>
            <table className="tabla"><tbody>
              {rankGastos.slice(0, 15).map(([n, v], i) => (
                <tr key={n}><td style={{ width: 22, color: '#999' }}>{i + 1}</td><td>{n}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{soles(v)}</td>
                  <td style={{ width: '28%' }}><div style={{ height: 7, background: 'var(--rojo)', borderRadius: 3, width: `${(v / (rankGastos[0]?.[1] || 1)) * 100}%`, minWidth: 2 }} /></td></tr>
              ))}
            </tbody></table>
          </div>
          <div>
            <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>👥 Adelantos/descuentos por persona</h2>
            <table className="tabla"><tbody>
              {rankDesc.slice(0, 15).map(([n, v], i) => (
                <tr key={n}><td style={{ width: 22, color: '#999' }}>{i + 1}</td><td>{n}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{soles(v)}</td>
                  <td style={{ width: '28%' }}><div style={{ height: 7, background: 'var(--azul)', borderRadius: 3, width: `${(v / (rankDesc[0]?.[1] || 1)) * 100}%`, minWidth: 2 }} /></td></tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}

      {cargando ? <p className="nota">Cargando…</p> : (
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Turno</th><th>Sede</th><th>Cajero</th><th>Venta</th><th>Sistema</th><th>Déf/Sobra</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {filtrados.map((t) => (
              <FragmentRow key={t.id} t={t} abierto={abierto === t.id} onToggle={() => toggle(t)} det={detalle[t.id]}
                onEliminar={esAdmin ? (e) => eliminarTurno(t, e) : null}
                onValidar={esAdmin ? (e) => validar(t, e) : null}
                onQuitarOk={esAdmin ? (e) => quitarValidacion(t, e) : null} />
            ))}
            {filtrados.length === 0 && <tr><td colSpan="8" className="nota">Sin turnos para el filtro.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  )
}

function FragmentRow({ t, abierto, onToggle, det, onEliminar, onValidar, onQuitarOk }) {
  const registrado = t.origen_archivo === 'registro-app'   // los del sistema son los que se validan
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
        <td>
          {t.validado
            ? <span className="chip chip-ok" title={t.validado_en ? 'Validado ' + new Date(t.validado_en).toLocaleString('es-PE') : ''}>✓ OK</span>
            : registrado ? <span className="chip chip-pend">⏳ por validar</span> : <span className="nota">—</span>}
          {t.montos_editados && <span className="chip chip-alerta" title="Se editaron montos del PDF">⚠️</span>}
        </td>
        <td style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {abierto ? '▲' : '▼'}
          {onValidar && !t.validado && registrado && <button className="btn-mini btn-ok" title="Dar OK" onClick={onValidar}>✓ OK</button>}
          {onQuitarOk && t.validado && registrado && <button className="btn-mini" title="Quitar OK" onClick={onQuitarOk}>↺</button>}
          {onEliminar && <button className="btn-mini btn-peligro" title="Eliminar turno" onClick={onEliminar}>🗑️</button>}
        </td>
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
            {!det ? <span className="nota">Cargando detalle…</span> : (<>
              {/* Comprobantes para la revisión del admin */}
              {det.archivos?.length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>📎 Comprobantes ({det.archivos.length}) — clic para abrir</div>
                  <div className="comprobantes">
                    {det.archivos.map((a) => (
                      <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="comp" onClick={(e) => e.stopPropagation()}>
                        <span className="comp-ico">{a.mime?.startsWith('image') ? '🖼️' : '📄'}</span>
                        <span>
                          <b>{{ arqueo: 'Arqueo de caja', ventas: 'Productos vendidos', voucher: 'Voucher POS', factura: 'Factura' }[a.tipo] || a.tipo}</b>
                          <small>{a.nombre?.slice(0, 26)}</small>
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {t.montos_editados && (
                <div className="alerta-edit" style={{ margin: 0 }}>
                  <b>⚠️ Montos cambiados respecto al PDF:</b>
                  <ul>{Object.entries(t.montos_editados).map(([k, v]) => (
                    <li key={k}>{k}: PDF <b>{soles(v.pdf)}</b> → puso <b>{soles(v.puesto)}</b></li>
                  ))}</ul>
                </div>
              )}
              {t.validado && t.nota_validacion && <p className="nota">✓ Nota de validación: {t.nota_validacion}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <MiniTabla titulo={`Gastos tienda (${det.gastos.length})`} filas={det.gastos.map(g => [g.descripcion, soles(g.monto), g.detalle])} />
                <MiniTabla titulo={`Descuentos personal (${det.descuentos.length})`} filas={det.descuentos.map(d => [d.persona, soles(d.monto), d.tipo])} />
                <MiniTabla titulo={`Stock (${det.stock.length})`} filas={det.stock.map(s => [s.producto, `vend ${s.vendido ?? '—'}`, `cierre ${s.cierre ?? '—'}`])} />
              </div>
            </>)}
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
