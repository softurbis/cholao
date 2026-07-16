import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { textoDePdf } from '../lib/leerPdf'
import { parseArqueo } from '../lib/parseArqueo'
import { climaDe } from '../lib/clima'

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const soles = (v) => 'S/ ' + Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n = (v) => Number(v) || 0

export default function RegistrarCaja() {
  const { perfil } = useAuth()
  const [turno, setTurno] = useState(null)          // turno abierto (fila de caja_turno)
  const [sedes, setSedes] = useState([])
  const [personas, setPersonas] = useState([])
  const [tiposGasto, setTiposGasto] = useState([])
  const [prodCat, setProdCat] = useState([])
  const [metas, setMetas] = useState([])
  const [msg, setMsg] = useState(null)              // {tipo:'ok'|'err', texto}
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)

  // datos del turno abierto
  const [gastos, setGastos] = useState([])
  const [descs, setDescs] = useState([])
  const [stock, setStock] = useState([])

  // apertura
  const [ap, setAp] = useState({ sede_id: '', fecha: fmt(new Date()), turno: 'manana', cajero: '', base_inicial: '' })
  const [stockIni, setStockIni] = useState([])

  // cierre
  const [ci, setCi] = useState({ clima: '', observaciones: '', efectivo_contado: '' })
  const [arqueo, setArqueo] = useState(null)
  const [pdfFile, setPdfFile] = useState(null)
  const [climaAuto, setClimaAuto] = useState(null)
  const [fase, setFase] = useState('turno')         // turno | cierre

  const aviso = (tipo, texto) => { setMsg({ tipo, texto }); setTimeout(() => setMsg(null), 5000) }

  async function cargarTodo() {
    const [{ data: s }, { data: p }, { data: tg }, { data: pc }, { data: m }] = await Promise.all([
      supabase.from('sedes').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('personas').select('nombres').eq('activo', true).order('nombres'),
      supabase.from('tipos_gasto').select('*').eq('activo', true).order('veces', { ascending: false }),
      supabase.from('productos_stock').select('*').eq('activo', true).order('orden'),
      supabase.from('caja_metas').select('*'),
    ])
    setSedes(s || []); setPersonas(p || []); setTiposGasto(tg || []); setProdCat(pc || []); setMetas(m || [])
    const sedeDef = perfil?.sede?.id || s?.[0]?.id || ''
    setAp((a) => ({ ...a, sede_id: a.sede_id || sedeDef, cajero: a.cajero || perfil?.nombre || '' }))

    // ¿hay un turno abierto?
    const { data: ab } = await supabase.from('caja_turno').select('*, sede:sedes(nombre)')
      .eq('estado', 'abierto').order('abierto_en', { ascending: false }).limit(1)
    if (ab?.[0]) { setTurno(ab[0]); await cargarHijos(ab[0].id) } else setTurno(null)
    setCargando(false)
  }
  async function cargarHijos(tid) {
    const [{ data: g }, { data: d }, { data: st }] = await Promise.all([
      supabase.from('caja_gastos').select('*').eq('turno_id', tid),
      supabase.from('caja_descuentos').select('*').eq('turno_id', tid),
      supabase.from('caja_stock').select('*').eq('turno_id', tid),
    ])
    setGastos(g || []); setDescs(d || []); setStock(st || [])
  }
  useEffect(() => { cargarTodo() }, [perfil])

  // stock inicial según catálogo de la sede elegida
  useEffect(() => {
    const lista = prodCat.filter((p) => !p.sede_id || p.sede_id === ap.sede_id)
    setStockIni(lista.map((p) => ({ producto: p.nombre, inicio: '' })))
  }, [prodCat, ap.sede_id])

  const meta = useMemo(() => {
    if (!turno) return null
    const dia = DIAS[new Date(turno.fecha + 'T12:00').getDay()]
    return metas.find((m) => m.sede_id === turno.sede_id && m.dia_semana === dia && m.turno === turno.turno)?.meta
  }, [metas, turno])

  const totGastos = gastos.reduce((a, x) => a + n(x.monto), 0)
  const totDescs = descs.reduce((a, x) => a + n(x.monto), 0)

  // ---------- FASE 1: APERTURA ----------
  async function abrirCaja() {
    if (!ap.sede_id || !ap.cajero) { aviso('err', 'Falta sede o cajero'); return }
    setOcupado(true)
    const { data, error } = await supabase.from('caja_turno').upsert({
      sede_id: ap.sede_id, fecha: ap.fecha, turno: ap.turno, cajero: ap.cajero,
      base_inicial: n(ap.base_inicial), estado: 'abierto', abierto_en: new Date().toISOString(),
      abierto_por: perfil?.id || null, origen_archivo: 'registro-app',
    }, { onConflict: 'sede_id,fecha,turno' }).select().single()
    if (error) { aviso('err', error.message); setOcupado(false); return }
    const st = stockIni.filter((x) => x.inicio !== '').map((x) => ({ turno_id: data.id, producto: x.producto, inicio: n(x.inicio) }))
    await supabase.from('caja_stock').delete().eq('turno_id', data.id)
    if (st.length) await supabase.from('caja_stock').insert(st)
    setTurno(data); await cargarHijos(data.id); setOcupado(false)
    aviso('ok', '✅ Caja abierta. Ya puedes registrar gastos y adelantos.')
  }

  // ---------- FASE 2: MOVIMIENTOS ----------
  async function addGasto(g) {
    const { data, error } = await supabase.from('caja_gastos')
      .insert({ turno_id: turno.id, descripcion: g.descripcion, monto: n(g.monto), detalle: g.detalle }).select().single()
    if (error) { aviso('err', error.message); return }
    setGastos((p) => [...p, data])
    // sube frecuencia del tipo de gasto (para que aparezca primero la próxima vez)
    const t = tiposGasto.find((t) => t.nombre === g.descripcion.toUpperCase())
    if (t) await supabase.from('tipos_gasto').update({ veces: (t.veces || 0) + 1 }).eq('id', t.id)
    else { const { data: nt } = await supabase.from('tipos_gasto').insert({ nombre: g.descripcion.toUpperCase(), detalle: g.detalle, veces: 1 }).select().single(); if (nt) setTiposGasto((p) => [...p, nt]) }
  }
  async function addDesc(d) {
    const { data, error } = await supabase.from('caja_descuentos')
      .insert({ turno_id: turno.id, persona: d.persona, monto: n(d.monto), tipo: d.tipo }).select().single()
    if (error) { aviso('err', error.message); return }
    setDescs((p) => [...p, data])
  }
  async function delFila(tabla, id, setter) {
    await supabase.from(tabla).delete().eq('id', id)
    setter((p) => p.filter((x) => x.id !== id))
  }

  // ---------- FASE 3: CIERRE ----------
  async function subirArqueo(file) {
    setPdfFile(file); setOcupado(true)
    try {
      const texto = await textoDePdf(file)
      const d = parseArqueo(texto)
      if (!d.ok) { aviso('err', d.error); setOcupado(false); return }
      setArqueo(d)
      if (!ci.efectivo_contado) setCi((c) => ({ ...c, efectivo_contado: d.efectivo_en_cierre ?? '' }))
      aviso('ok', `📄 Arqueo leído: venta del sistema ${soles(d.venta_sistema)}`)
    } catch (e) { aviso('err', 'No pude leer el PDF: ' + e.message) }
    setOcupado(false)
  }

  async function verClima() {
    const c = await climaDe(turno.fecha)
    if (c) { setClimaAuto(c); setCi((x) => ({ ...x, clima: x.clima || c.clima })) }
    else aviso('err', 'No pude consultar el clima')
  }
  useEffect(() => { if (fase === 'cierre' && turno && !climaAuto) verClima() }, [fase, turno])

  const rendimiento = useMemo(() => {
    if (!arqueo?.venta_sistema || !meta) return null
    const p = (arqueo.venta_sistema / meta) * 100
    return p >= 100 ? 'Buen turno' : p >= 70 ? 'Turno regular' : 'Turno bajo'
  }, [arqueo, meta])

  // el faltante del POS debería explicarse con los gastos + adelantos del turno
  const faltantePos = Math.abs(n(arqueo?.diferencia_pos))
  const explicado = totGastos + totDescs
  const descuadre = faltantePos - explicado

  async function cerrarTurno() {
    if (!arqueo) { aviso('err', 'Sube el PDF de arqueo del POS para cerrar'); return }
    setOcupado(true)
    let voucher_url = null
    if (pdfFile) {
      const ruta = `${turno.fecha}/${turno.sede_id}-${turno.turno}-${Date.now()}.pdf`
      const { error: eUp } = await supabase.storage.from('arqueos').upload(ruta, pdfFile, { contentType: 'application/pdf', upsert: true })
      if (!eUp) voucher_url = ruta
    }
    const ventaTotal = n(arqueo.venta_sistema)
    const { error } = await supabase.from('caja_turno').update({
      estado: 'cerrado', cerrado_en: new Date().toISOString(),
      tarjeta: n(arqueo.sis_tarjeta), plin: n(arqueo.sis_plin),
      yape_total: n(arqueo.sis_yape), yape_qr: n(arqueo.sis_yape),
      efectivo: n(ci.efectivo_contado || arqueo.efectivo_en_cierre),
      gastos_tienda: totGastos, venta_sistema: ventaTotal, venta_total: ventaTotal,
      deficit_sobra: -descuadre, meta_turno: meta ?? null,
      rendimiento, clima: ci.clima || null, clima_auto: climaAuto?.clima || null,
      observaciones: ci.observaciones || null, voucher_url,
    }).eq('id', turno.id)
    if (error) { aviso('err', error.message); setOcupado(false); return }
    // stock: cierre + vendido
    for (const s of stock) {
      const vendido = n(s.inicio) + n(s.adicion) - n(s.salida) - n(s.cierre)
      await supabase.from('caja_stock').update({ cierre: n(s.cierre), vendido, adicion: n(s.adicion), salida: n(s.salida) }).eq('id', s.id)
    }
    setOcupado(false)
    aviso('ok', '✅ Turno cerrado correctamente')
    setTimeout(() => { setTurno(null); setArqueo(null); setPdfFile(null); setFase('turno'); setCi({ clima: '', observaciones: '', efectivo_contado: '' }); cargarTodo() }, 1200)
  }

  if (cargando) return <div className="pagina"><h1>Caja</h1><p className="nota">Cargando…</p></div>

  return (
    <div className="pagina">
      <div className="pasos">
        <div className={`paso ${!turno ? 'activo' : 'ok'}`}><b>1</b> Apertura</div>
        <div className={`paso ${turno && fase === 'turno' ? 'activo' : turno ? 'ok' : ''}`}><b>2</b> Turno</div>
        <div className={`paso ${turno && fase === 'cierre' ? 'activo' : ''}`}><b>3</b> Cierre</div>
      </div>

      {msg && <div className={msg.tipo === 'ok' ? 'aviso-ok' : 'alerta'}>{msg.texto}</div>}

      {/* ---------------- FASE 1 ---------------- */}
      {!turno && (<>
        <h1>Apertura de caja</h1>
        <p className="pagina-sub">Abre el turno con tu nombre, la base de caja y el stock inicial.</p>
        <div className="filtros">
          <label className="campo"><span>Sede</span><select value={ap.sede_id} onChange={(e) => setAp({ ...ap, sede_id: e.target.value })}>{sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
          <label className="campo"><span>Fecha</span><input type="date" value={ap.fecha} onChange={(e) => setAp({ ...ap, fecha: e.target.value })} /></label>
          <label className="campo"><span>Turno</span><select value={ap.turno} onChange={(e) => setAp({ ...ap, turno: e.target.value })}><option value="manana">Mañana (1er turno)</option><option value="tarde">Tarde (2do turno)</option></select></label>
          <label className="campo"><span>Cajero</span><input value={ap.cajero} onChange={(e) => setAp({ ...ap, cajero: e.target.value })} /></label>
          <label className="campo"><span>Base de caja (S/)</span><input type="number" value={ap.base_inicial} onChange={(e) => setAp({ ...ap, base_inicial: e.target.value })} /></label>
        </div>

        <div className="seccion">
          <h2 className="sub-titulo">📦 Stock inicial</h2>
          <table className="tabla">
            <thead><tr><th>Producto</th><th style={{ width: 140 }}>Cantidad inicial</th></tr></thead>
            <tbody>
              {stockIni.map((s, i) => (
                <tr key={s.producto}>
                  <td><strong>{s.producto}</strong></td>
                  <td><input type="number" className="in-num" value={s.inicio} onChange={(e) => setStockIni(stockIni.map((r, j) => j === i ? { ...r, inicio: e.target.value } : r))} /></td>
                </tr>
              ))}
              {stockIni.length === 0 && <tr><td colSpan="2" className="nota">Sin productos. Agrégalos en Configuración.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 18 }}><button className="btn-guardar" onClick={abrirCaja} disabled={ocupado}>{ocupado ? 'Abriendo…' : '🔓 Abrir caja'}</button></div>
      </>)}

      {/* ---------------- FASE 2 ---------------- */}
      {turno && fase === 'turno' && (<>
        <h1>Turno abierto <span className="titulo-tag">{turno.sede?.nombre}</span></h1>
        <p className="pagina-sub">
          {turno.cajero} · {turno.fecha} · {turno.turno === 'manana' ? 'Mañana' : 'Tarde'} · Base {soles(turno.base_inicial)}
          {meta ? ` · Meta ${soles(meta)}` : ''}
        </p>
        <div className="dos-cols">
          <MovBloque titulo="🛒 Gastos de tienda" total={totGastos} onAdd={addGasto} tipos={tiposGasto} modo="gasto"
            filas={gastos.map((g) => ({ id: g.id, a: g.descripcion, b: g.monto, c: g.detalle }))}
            onDel={(id) => delFila('caja_gastos', id, setGastos)} />
          <MovBloque titulo="👥 Adelantos / descuentos" total={totDescs} onAdd={addDesc} personas={personas} modo="desc"
            filas={descs.map((d) => ({ id: d.id, a: d.persona, b: d.monto, c: d.tipo }))}
            onDel={(id) => delFila('caja_descuentos', id, setDescs)} />
        </div>
        <div style={{ marginTop: 18 }}><button className="btn-guardar" onClick={() => setFase('cierre')}>➡️ Ir al cierre</button></div>
      </>)}

      {/* ---------------- FASE 3 ---------------- */}
      {turno && fase === 'cierre' && (<>
        <h1>Cierre de turno</h1>
        <p className="pagina-sub">{turno.cajero} · {turno.fecha} · {turno.turno === 'manana' ? 'Mañana' : 'Tarde'}</p>

        <div className="seccion" style={{ marginBottom: 16 }}>
          <h2 className="sub-titulo">📄 Arqueo del POS (PDF)</h2>
          <p className="nota">Sube el PDF de arqueo. De ahí se jala la venta del sistema y el desglose — no tipeas nada.</p>
          <input type="file" accept="application/pdf" onChange={(e) => e.target.files[0] && subirArqueo(e.target.files[0])} />
          {arqueo && (
            <div className="arqueo-box">
              <div><span className="t-label">Venta del sistema</span><b>{soles(arqueo.venta_sistema)}</b></div>
              <div><span className="t-label">Efectivo</span>{soles(arqueo.sis_efectivo)} <small>({arqueo.sis_efectivo_op} op)</small></div>
              <div><span className="t-label">Tarjeta</span>{soles(arqueo.sis_tarjeta)} <small>({arqueo.sis_tarjeta_op})</small></div>
              <div><span className="t-label">Yape</span>{soles(arqueo.sis_yape)} <small>({arqueo.sis_yape_op})</small></div>
              <div><span className="t-label">Faltante POS</span><b className="def-neg">{soles(faltantePos)}</b></div>
              <div><span className="t-label">Cajero POS</span><small>{arqueo.cajero}</small></div>
            </div>
          )}
        </div>

        <div className="dos-cols">
          <div className="seccion">
            <h2 className="sub-titulo">⚖️ Cuadre</h2>
            <div className="totales" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8, borderTop: 0, marginTop: 0, paddingTop: 0 }}>
              <div>Faltante que reporta el POS: <b>{soles(faltantePos)}</b></div>
              <div>Explicado por gastos ({soles(totGastos)}) + adelantos ({soles(totDescs)}): <b>{soles(explicado)}</b></div>
              <div className={Math.abs(descuadre) < 0.5 ? 'def-pos' : 'def-neg'} style={{ fontSize: 17 }}>
                {Math.abs(descuadre) < 0.5 ? '✅ Cuadra' : (descuadre > 0 ? `⚠️ Descuadre (falta explicar) ${soles(descuadre)}` : `⚠️ Sobra ${soles(-descuadre)}`)}
              </div>
              {meta && arqueo && <div style={{ marginTop: 6 }}>Meta {soles(meta)} → <b>{rendimiento}</b> ({((arqueo.venta_sistema / meta) * 100).toFixed(0)}%)</div>}
            </div>
            <label className="campo" style={{ marginTop: 12 }}><span>Efectivo contado</span><input type="number" value={ci.efectivo_contado} onChange={(e) => setCi({ ...ci, efectivo_contado: e.target.value })} /></label>
            <label className="campo" style={{ marginTop: 10 }}><span>Clima {climaAuto && <em style={{ color: 'var(--gris)', textTransform: 'none' }}>— hoy: {climaAuto.clima}, {climaAuto.temp_max}°C, {climaAuto.lluvia_mm}mm</em>}</span>
              <select value={ci.clima} onChange={(e) => setCi({ ...ci, clima: e.target.value })}>
                <option value="">Elige…</option><option>Soleado</option><option>Nublado</option><option>Lluvioso</option>
              </select>
            </label>
            {climaAuto && ci.clima && ci.clima !== climaAuto.clima && <p className="nota" style={{ color: 'var(--rojo)' }}>⚠️ El clima real fue "{climaAuto.clima}"</p>}
            <label className="campo" style={{ marginTop: 10 }}><span>Observaciones</span><input value={ci.observaciones} onChange={(e) => setCi({ ...ci, observaciones: e.target.value })} /></label>
          </div>

          <div className="seccion">
            <h2 className="sub-titulo">📦 Stock final</h2>
            <table className="tabla">
              <thead><tr><th>Producto</th><th>Inicio</th><th>Cierre</th><th>Vendido</th></tr></thead>
              <tbody>
                {stock.map((s, i) => (
                  <tr key={s.id}>
                    <td><strong>{s.producto}</strong></td>
                    <td>{s.inicio}</td>
                    <td><input type="number" className="in-num" value={s.cierre ?? ''} onChange={(e) => setStock(stock.map((r, j) => j === i ? { ...r, cierre: e.target.value } : r))} /></td>
                    <td><b>{n(s.inicio) + n(s.adicion) - n(s.salida) - n(s.cierre)}</b></td>
                  </tr>
                ))}
                {stock.length === 0 && <tr><td colSpan="4" className="nota">Sin stock registrado en la apertura.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <button className="btn-mini" onClick={() => setFase('turno')}>⬅️ Volver</button>
          <button className="btn-guardar" onClick={cerrarTurno} disabled={ocupado || !arqueo}>{ocupado ? 'Cerrando…' : '🔒 Cerrar turno'}</button>
          <button className="btn-mini" onClick={() => window.print()}>🖨️ PDF / Captura</button>
        </div>
      </>)}
    </div>
  )
}

// Bloque de movimientos con búsqueda rápida (gastos o descuentos)
function MovBloque({ titulo, total, filas, onAdd, onDel, tipos = [], personas = [], modo }) {
  const [q, setQ] = useState('')
  const [monto, setMonto] = useState('')
  const [extra, setExtra] = useState(modo === 'gasto' ? 'LOCAL' : 'ADELANTO')
  const opciones = modo === 'gasto' ? tipos.map((t) => t.nombre) : personas.map((p) => p.nombres)
  const sug = q ? opciones.filter((o) => o.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : opciones.slice(0, 6)

  function agregar() {
    if (!q.trim() || !Number(monto)) return
    onAdd(modo === 'gasto' ? { descripcion: q.trim(), monto, detalle: extra } : { persona: q.trim(), monto, tipo: extra })
    setQ(''); setMonto('')
  }
  return (
    <div className="seccion">
      <h2 className="sub-titulo">{titulo} <span style={{ float: 'right', color: 'var(--rojo)' }}>{soles(total)}</span></h2>
      <div className="fila-mini">
        <input placeholder={modo === 'gasto' ? 'Buscar o escribir gasto…' : 'Buscar persona…'} value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="number" placeholder="S/" value={monto} onChange={(e) => setMonto(e.target.value)} style={{ maxWidth: 80 }} onKeyDown={(e) => e.key === 'Enter' && agregar()} />
        <select value={extra} onChange={(e) => setExtra(e.target.value)} style={{ maxWidth: 110 }}>
          {(modo === 'gasto' ? ['LOCAL', 'DELIVERY'] : ['ADELANTO', 'CONSUMO', 'PRESTAMO', 'DESCUENTO']).map((o) => <option key={o}>{o}</option>)}
        </select>
        <button className="btn-mini" onClick={agregar}>+</button>
      </div>
      {q && sug.length > 0 && (
        <div className="sugerencias">
          {sug.map((s) => <button key={s} className="sug" onClick={() => setQ(s)}>{s}</button>)}
        </div>
      )}
      <table className="tabla" style={{ marginTop: 10 }}>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <td>{f.a}</td><td style={{ whiteSpace: 'nowrap' }}>{soles(f.b)}</td>
              <td className="nota">{f.c}</td>
              <td><button className="btn-mini btn-peligro" onClick={() => onDel(f.id)}>✕</button></td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td className="nota">Nada registrado aún.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
