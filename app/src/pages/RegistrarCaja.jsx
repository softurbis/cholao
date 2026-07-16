import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { textoDePdf } from '../lib/leerPdf'
import { parseArqueo } from '../lib/parseArqueo'
import { parseProductos, cruzarConStock } from '../lib/parseProductos'
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
  const [arqueo, setArqueo] = useState(null)        // valores leídos del PDF (editables)
  const [prodPdf, setProdPdf] = useState(null)      // PDF de productos vendidos
  const [adjuntos, setAdjuntos] = useState([])      // [{tipo, file}] a subir
  const [climaAuto, setClimaAuto] = useState(null)
  const [fase, setFase] = useState('turno')         // turno | cierre

  const setArq = (campo, valor) => setArqueo((a) => ({ ...a, [campo]: valor === '' ? '' : Number(valor) }))

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

  // Cruza el stock con lo que el PDF de productos dice que se vendió
  const stockCruzado = useMemo(
    () => prodPdf ? cruzarConStock(prodPdf.items, stock) : stock.map((s) => ({ ...s, vendido_sistema: null })),
    [prodPdf, stock])

  // Los 3 documentos obligatorios para poder cerrar
  const tieneVoucher = adjuntos.some((a) => a.tipo === 'voucher')
  const faltantes = [!arqueo && 'arqueo', !prodPdf && 'productos vendidos', !tieneVoucher && 'foto del POS'].filter(Boolean)
  const listo = faltantes.length === 0

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

  // Elimina el turno completo (gastos, adelantos, stock y archivos). Útil para pruebas.
  async function eliminarTurno() {
    if (!confirm('¿Eliminar este turno con TODO lo registrado (gastos, adelantos, stock y archivos)?\nNo se puede deshacer.')) return
    setOcupado(true)
    const { data: adj } = await supabase.from('caja_adjuntos').select('archivo').eq('turno_id', turno.id)
    if (adj?.length) await supabase.storage.from('arqueos').remove(adj.map((a) => a.archivo))
    const { error } = await supabase.from('caja_turno').delete().eq('id', turno.id)   // hijos por cascade
    setOcupado(false)
    if (error) { aviso('err', error.message); return }
    aviso('ok', '🗑️ Turno eliminado')
    setTurno(null); setArqueo(null); setProdPdf(null); setAdjuntos([]); setFase('turno')
    setCi({ clima: '', observaciones: '', efectivo_contado: '' })
    cargarTodo()
  }

  // ---------- FASE 3: CIERRE ----------
  // El PDF de arqueo se lee y llena los montos (que quedan editables)
  async function subirArqueo(file) {
    setOcupado(true)
    try {
      const texto = await textoDePdf(file)
      const d = parseArqueo(texto)
      if (!d.ok) { aviso('err', d.error); setOcupado(false); return }
      setArqueo(d)
      setAdjuntos((p) => [...p.filter((x) => x.tipo !== 'arqueo'), { tipo: 'arqueo', file }])
      if (!ci.efectivo_contado) setCi((c) => ({ ...c, efectivo_contado: d.efectivo_en_cierre ?? '' }))
      aviso('ok', `📄 Arqueo leído: venta del sistema ${soles(d.venta_sistema)} (puedes corregir los montos)`)
    } catch (e) { aviso('err', 'No pude leer el PDF: ' + e.message) }
    setOcupado(false)
  }
  function addAdjunto(tipo, file) {
    if (!file) return
    setAdjuntos((p) => [...p.filter((x) => x.tipo !== tipo || tipo === 'factura'), { tipo, file }])
    aviso('ok', `📎 ${file.name} adjuntado`)
  }

  // PDF "PRODUCTOS VENDIDOS": trae lo que el sistema dice que se vendió de cada producto
  async function subirProductos(file) {
    setOcupado(true)
    try {
      const d = parseProductos(await textoDePdf(file))
      if (!d.ok) { aviso('err', d.error); setOcupado(false); return }
      setProdPdf(d)
      setAdjuntos((p) => [...p.filter((x) => x.tipo !== 'ventas'), { tipo: 'ventas', file }])
      aviso('ok', `📄 ${d.items.length} productos leídos (S/ ${d.total}) — comparando con tu stock`)
    } catch (e) { aviso('err', 'No pude leer el PDF: ' + e.message) }
    setOcupado(false)
  }
  const quitarAdjunto = (i) => setAdjuntos((p) => p.filter((_, j) => j !== i))

  // Mensaje de WhatsApp con el resumen del turno
  function enviarWsp() {
    const txt = [
      `*CIERRE DE CAJA — ${turno.sede?.nombre || ''}*`,
      `${turno.fecha} · ${turno.turno === 'manana' ? 'Mañana' : 'Tarde'} · ${turno.cajero}`,
      ``,
      `Venta del sistema: ${soles(arqueo?.venta_sistema)}`,
      `Efectivo: ${soles(arqueo?.sis_efectivo)} | Tarjeta: ${soles(arqueo?.sis_tarjeta)} | Yape: ${soles(arqueo?.sis_yape)}`,
      `Gastos: ${soles(totGastos)} | Adelantos: ${soles(totDescs)}`,
      meta ? `Meta: ${soles(meta)} → ${rendimiento || '—'}` : '',
      `Faltante POS: ${soles(faltantePos)} → ${Math.abs(descuadre) < 0.5 ? '✅ CUADRA' : `⚠️ descuadre ${soles(Math.abs(descuadre))}`}`,
      ci.clima ? `Clima: ${ci.clima}` : '',
      ``,
      `Ver sistema: ${window.location.origin}${window.location.pathname}`,
    ].filter(Boolean).join('\n')
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank')
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
    if (!listo) { aviso('err', 'Faltan documentos obligatorios: ' + faltantes.join(', ')); return }
    setOcupado(true)
    // sube todos los adjuntos (arqueo, 2º reporte, voucher foto, facturas)
    let primeroArqueo = null
    for (const a of adjuntos) {
      const ext = (a.file.name.split('.').pop() || 'bin').toLowerCase()
      const ruta = `${turno.fecha}/${turno.sede_id}-${turno.turno}-${a.tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const { error: eUp } = await supabase.storage.from('arqueos').upload(ruta, a.file, { contentType: a.file.type || undefined, upsert: true })
      if (eUp) { aviso('err', 'No pude subir ' + a.file.name + ': ' + eUp.message); continue }
      await supabase.from('caja_adjuntos').insert({
        turno_id: turno.id, tipo: a.tipo, archivo: ruta, nombre: a.file.name,
        mime: a.file.type || null, subido_por: perfil?.id || null,
      })
      if (a.tipo === 'arqueo' && !primeroArqueo) primeroArqueo = ruta
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
      observaciones: ci.observaciones || null, voucher_url: primeroArqueo,
    }).eq('id', turno.id)
    if (error) { aviso('err', error.message); setOcupado(false); return }
    // stock: cierre + vendido + comparación con el sistema
    for (const s of stockCruzado) {
      const vendido = n(s.inicio) + n(s.adicion) - n(s.salida) - n(s.cierre)
      await supabase.from('caja_stock').update({
        cierre: n(s.cierre), vendido, adicion: n(s.adicion), salida: n(s.salida),
        venta_sistema: s.vendido_sistema ?? null,
        esperado: s.vendido_sistema ?? null,
        coincide: s.vendido_sistema == null ? null : vendido === s.vendido_sistema,
      }).eq('id', s.id)
    }
    setOcupado(false)
    aviso('ok', '✅ Turno cerrado correctamente')
    setTimeout(() => { setTurno(null); setArqueo(null); setAdjuntos([]); setFase('turno'); setCi({ clima: '', observaciones: '', efectivo_contado: '' }); cargarTodo() }, 1200)
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
        <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-guardar" onClick={() => setFase('cierre')}>➡️ Ir al cierre</button>
          <button className="btn-mini btn-peligro" onClick={eliminarTurno} disabled={ocupado}>🗑️ Eliminar turno</button>
        </div>
      </>)}

      {/* ---------------- FASE 3 ---------------- */}
      {turno && fase === 'cierre' && (<>
        <h1>Cierre de turno</h1>
        <p className="pagina-sub">{turno.cajero} · {turno.fecha} · {turno.turno === 'manana' ? 'Mañana' : 'Tarde'}</p>

        {/* --- 3 documentos obligatorios --- */}
        <div className="seccion" style={{ marginBottom: 16 }}>
          <h2 className="sub-titulo">📄 Documentos del turno <span className="nota">— los 3 son obligatorios</span></h2>
          <div className="adj-grid">
            <Slot n="1" label="Arqueo de caja (PDF)" ok={!!arqueo} accept="application/pdf"
              onFile={subirArqueo} hint="Jala la venta del sistema y los pagos" />
            <Slot n="2" label="Productos vendidos (PDF)" ok={!!prodPdf} accept="application/pdf"
              onFile={subirProductos} hint="Jala los productos para comparar tu stock" />
            <Slot n="3" label="Foto del voucher POS" ok={tieneVoucher} accept="image/*" capture
              onFile={(f) => addAdjunto('voucher', f)} hint="Toma la foto con la cámara" />
          </div>
          {!listo && <p className="nota" style={{ color: 'var(--rojo)', marginTop: 10 }}>⚠️ Faltan documentos: {faltantes.join(' · ')}</p>}
        </div>

        {/* --- Montos leídos (editables) --- */}
        {arqueo && (
        <div className="seccion" style={{ marginBottom: 16 }}>
          <h2 className="sub-titulo">💰 Montos leídos del arqueo <span className="nota">— puedes corregirlos</span></h2>
          <>
            <div className="arqueo-box">
              <label><span className="t-label">Venta del sistema</span><input type="number" className="in-arq" value={arqueo.venta_sistema ?? ''} onChange={(e) => setArq('venta_sistema', e.target.value)} /></label>
              <label><span className="t-label">Efectivo <small>({arqueo.sis_efectivo_op} op)</small></span><input type="number" className="in-arq" value={arqueo.sis_efectivo ?? ''} onChange={(e) => setArq('sis_efectivo', e.target.value)} /></label>
              <label><span className="t-label">Tarjeta <small>({arqueo.sis_tarjeta_op})</small></span><input type="number" className="in-arq" value={arqueo.sis_tarjeta ?? ''} onChange={(e) => setArq('sis_tarjeta', e.target.value)} /></label>
              <label><span className="t-label">Yape <small>({arqueo.sis_yape_op})</small></span><input type="number" className="in-arq" value={arqueo.sis_yape ?? ''} onChange={(e) => setArq('sis_yape', e.target.value)} /></label>
              <label><span className="t-label">Faltante POS</span><input type="number" className="in-arq" value={arqueo.diferencia_pos ?? ''} onChange={(e) => setArq('diferencia_pos', e.target.value)} /></label>
              <div><span className="t-label">Cajero POS</span><small>{arqueo.cajero}</small></div>
            </div>
            {Math.abs(n(arqueo.venta_sistema) - (n(arqueo.sis_efectivo) + n(arqueo.sis_tarjeta) + n(arqueo.sis_yape) + n(arqueo.sis_plin))) > 0.5 &&
              <p className="nota" style={{ color: 'var(--rojo)' }}>⚠️ La suma de los medios de pago no cuadra con la venta del sistema.</p>}
          </>
        </div>)}

        {/* --- Adicionales: facturas de gastos --- */}
        <div className="seccion" style={{ marginBottom: 16 }}>
          <h2 className="sub-titulo">📎 Adicionales <span className="nota">— opcional</span></h2>
          <label className="campo"><span>Facturas / boletas de los gastos</span>
            <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => [...e.target.files].forEach((f) => addAdjunto('factura', f))} />
          </label>
          {adjuntos.length > 0 && (
            <div className="sugerencias" style={{ marginTop: 10 }}>
              {adjuntos.map((a, i) => (
                <span key={i} className="chip chip-ok" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  {a.tipo}: {a.file.name.slice(0, 22)}
                  <button className="btn-mini" style={{ padding: '0 5px' }} onClick={() => quitarAdjunto(i)}>✕</button>
                </span>
              ))}
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
            <h2 className="sub-titulo">📦 Stock final {prodPdf && <span className="nota">vs sistema</span>}</h2>
            <table className="tabla">
              <thead><tr><th>Producto</th><th>Inicio</th><th>Cierre</th><th>Vendido</th>{prodPdf && <><th>Sistema</th><th></th></>}</tr></thead>
              <tbody>
                {stockCruzado.map((s, i) => {
                  const vend = n(s.inicio) + n(s.adicion) - n(s.salida) - n(s.cierre)
                  const cuadra = s.vendido_sistema == null ? null : vend === s.vendido_sistema
                  return (
                    <tr key={s.id}>
                      <td><strong>{s.producto}</strong></td>
                      <td>{s.inicio}</td>
                      <td><input type="number" className="in-num" value={s.cierre ?? ''} onChange={(e) => setStock(stock.map((r, j) => j === i ? { ...r, cierre: e.target.value } : r))} /></td>
                      <td><b>{vend}</b></td>
                      {prodPdf && <>
                        <td>{s.vendido_sistema ?? <span className="nota">—</span>}</td>
                        <td>{cuadra === null ? '' : cuadra ? <span className="chip chip-ok">✓</span> : <span className="chip chip-off" style={{ background: '#fff1f1', color: 'var(--rojo)' }}>≠ {vend - s.vendido_sistema}</span>}</td>
                      </>}
                    </tr>
                  )
                })}
                {stock.length === 0 && <tr><td colSpan="6" className="nota">Sin stock registrado en la apertura.</td></tr>}
              </tbody>
            </table>
            {prodPdf && <p className="nota">Solo se comparan los productos que llevas por stock. El PDF trae {prodPdf.items.length} productos vendidos en total.</p>}
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-mini" onClick={() => setFase('turno')}>⬅️ Volver</button>
          <button className="btn-guardar" onClick={cerrarTurno} disabled={ocupado || !listo} title={listo ? '' : 'Faltan: ' + faltantes.join(', ')}>{ocupado ? 'Cerrando…' : '🔒 Cerrar turno'}</button>
          <button className="btn-mini" onClick={() => window.print()}>🖨️ PDF / Captura</button>
          <button className="btn-wsp" onClick={enviarWsp} disabled={!arqueo}>💬 Enviar por WhatsApp</button>
          <button className="btn-mini btn-peligro" onClick={eliminarTurno} disabled={ocupado} style={{ marginLeft: 'auto' }}>🗑️ Eliminar turno</button>
        </div>
      </>)}
    </div>
  )
}

// Recuadro de documento obligatorio: muestra ✓ cuando ya se cargó
function Slot({ n, label, ok, accept, capture, onFile, hint }) {
  return (
    <label className={ok ? 'slot ok' : 'slot'}>
      <div className="slot-cab"><span className="slot-n">{ok ? '✓' : n}</span><b>{label}</b></div>
      <span className="nota">{ok ? 'Listo ✓ — puedes reemplazarlo' : hint}</span>
      <input type="file" accept={accept} {...(capture ? { capture: 'environment' } : {})}
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
    </label>
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
