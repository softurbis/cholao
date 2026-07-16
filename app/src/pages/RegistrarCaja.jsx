import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n = (v) => Number(v) || 0

export default function RegistrarCaja() {
  const { perfil } = useAuth()
  const [sedes, setSedes] = useState([])
  const [personas, setPersonas] = useState([])
  const [prodCat, setProdCat] = useState([])
  const [metas, setMetas] = useState([])
  const [msg, setMsg] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [cab, setCab] = useState({
    sede_id: '', fecha: fmt(new Date()), turno: 'manana',
    cajero: perfil?.nombre || '', clima: 'Soleado', rendimiento: 'Buen turno', venta_sistema: '',
    tarjeta: '', plin: '', yape_qr: '', yape_fotos: '', efectivo: '', observaciones: '',
  })
  const [gastos, setGastos] = useState([{ descripcion: '', monto: '', detalle: 'LOCAL' }])
  const [descs, setDescs] = useState([{ persona: '', monto: '', tipo: 'ADELANTO' }])
  const [stock, setStock] = useState([])

  useEffect(() => {
    (async () => {
      const [{ data: s }, { data: p }, { data: pc }, { data: m }] = await Promise.all([
        supabase.from('sedes').select('id, nombre').eq('activo', true).order('nombre'),
        supabase.from('personas').select('nombres').eq('activo', true).order('nombres'),
        supabase.from('productos_stock').select('*').eq('activo', true).order('orden'),
        supabase.from('caja_metas').select('*'),
      ])
      setSedes(s || []); setPersonas(p || []); setProdCat(pc || []); setMetas(m || [])
      setCab((c) => ({ ...c, sede_id: perfil?.sede?.id || s?.[0]?.id || '' }))
    })()
  }, [perfil])

  // inicializa stock según catálogo de la sede
  useEffect(() => {
    const lista = prodCat.filter((p) => !p.sede_id || p.sede_id === cab.sede_id)
    setStock(lista.map((p) => ({ producto: p.nombre, inicio: '', adicion: '', salida: '', cierre: '' })))
  }, [prodCat, cab.sede_id])

  const yapeTotal = n(cab.yape_qr) + n(cab.yape_fotos)
  const gastosTotal = gastos.reduce((a, g) => a + n(g.monto), 0)
  const descTotal = descs.reduce((a, d) => a + n(d.monto), 0)
  const ventaTotal = n(cab.tarjeta) + n(cab.plin) + yapeTotal + n(cab.efectivo) + gastosTotal
  const deficit = ventaTotal - n(cab.venta_sistema)
  const meta = useMemo(() => {
    const dia = DIAS[new Date(cab.fecha + 'T12:00').getDay()]
    return metas.find((m) => m.sede_id === cab.sede_id && m.dia_semana === dia && m.turno === cab.turno)?.meta
  }, [metas, cab.sede_id, cab.fecha, cab.turno])

  const upd = (campo) => (e) => setCab({ ...cab, [campo]: e.target.value })
  const setRow = (arr, setArr, i, campo, val) => setArr(arr.map((r, j) => j === i ? { ...r, [campo]: val } : r))

  async function crearProducto() {
    const nombre = prompt('Nombre del nuevo producto de stock:')
    if (!nombre) return
    const { data, error } = await supabase.from('productos_stock')
      .insert({ nombre: nombre.trim(), orden: prodCat.length + 1 }).select().single()
    if (!error) { setProdCat([...prodCat, data]); setMsg(`Producto "${nombre}" creado ✓`) }
  }

  async function guardar() {
    if (!cab.sede_id) { setMsg('Elige una sede'); return }
    setGuardando(true); setMsg('')
    const { data, error } = await supabase.from('caja_turno').upsert({
      sede_id: cab.sede_id, fecha: cab.fecha, turno: cab.turno, cajero: cab.cajero || null,
      clima: cab.clima, rendimiento: cab.rendimiento, observaciones: cab.observaciones || null,
      tarjeta: n(cab.tarjeta), plin: n(cab.plin), yape_qr: n(cab.yape_qr), yape_fotos: n(cab.yape_fotos),
      yape_total: yapeTotal, efectivo: n(cab.efectivo), gastos_tienda: gastosTotal,
      venta_total: ventaTotal, venta_sistema: n(cab.venta_sistema), deficit_sobra: deficit,
      meta_turno: meta ?? null, origen_archivo: 'registro-app',
    }, { onConflict: 'sede_id,fecha,turno' }).select('id').single()
    if (error) { setMsg('Error: ' + error.message); setGuardando(false); return }
    const tid = data.id
    await Promise.all([
      supabase.from('caja_gastos').delete().eq('turno_id', tid),
      supabase.from('caja_descuentos').delete().eq('turno_id', tid),
      supabase.from('caja_stock').delete().eq('turno_id', tid),
    ])
    const g = gastos.filter((x) => x.descripcion && n(x.monto)).map((x) => ({ turno_id: tid, descripcion: x.descripcion, monto: n(x.monto), detalle: x.detalle }))
    const d = descs.filter((x) => x.persona && n(x.monto)).map((x) => ({ turno_id: tid, persona: x.persona, monto: n(x.monto), tipo: x.tipo }))
    const st = stock.filter((x) => x.inicio !== '' || x.cierre !== '').map((x) => ({
      turno_id: tid, producto: x.producto, inicio: n(x.inicio), adicion: n(x.adicion), salida: n(x.salida),
      cierre: n(x.cierre), vendido: n(x.inicio) + n(x.adicion) - n(x.salida) - n(x.cierre),
    }))
    if (g.length) await supabase.from('caja_gastos').insert(g)
    if (d.length) await supabase.from('caja_descuentos').insert(d)
    if (st.length) await supabase.from('caja_stock').insert(st)
    setGuardando(false); setMsg('✅ Turno registrado y guardado')
  }

  return (
    <div className="pagina">
      <h1>🧮 Registrar Caja Diaria</h1>
      <p className="pagina-sub">Cierre del turno: cuadre de pagos, gastos, descuentos y control de stock.</p>
      {msg && <div className={msg.startsWith('Error') ? 'alerta' : 'aviso-ok'}>{msg}</div>}

      {/* Cabecera */}
      <div className="filtros">
        <label className="campo"><span>Sede</span><select value={cab.sede_id} onChange={upd('sede_id')}>{sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
        <label className="campo"><span>Fecha</span><input type="date" value={cab.fecha} onChange={upd('fecha')} /></label>
        <label className="campo"><span>Turno</span><select value={cab.turno} onChange={upd('turno')}><option value="manana">Mañana</option><option value="tarde">Tarde</option></select></label>
        <label className="campo"><span>Cajero</span><input value={cab.cajero} onChange={upd('cajero')} placeholder="Responsable" /></label>
        <label className="campo"><span>Clima</span><select value={cab.clima} onChange={upd('clima')}><option>Soleado</option><option>Nublado</option><option>Lluvioso</option></select></label>
        <label className="campo"><span>Rendimiento</span><select value={cab.rendimiento} onChange={upd('rendimiento')}><option>Buen turno</option><option>Turno regular</option><option>Turno bajo</option></select></label>
      </div>

      <div className="dos-cols">
        {/* Cuadre de pagos */}
        <div className="seccion">
          <h2 className="sub-titulo">💰 Cuadre de pagos</h2>
          <div className="grid-pagos">
            <label><span>Tarjeta</span><input type="number" value={cab.tarjeta} onChange={upd('tarjeta')} /></label>
            <label><span>Plin</span><input type="number" value={cab.plin} onChange={upd('plin')} /></label>
            <label><span>Yape QR</span><input type="number" value={cab.yape_qr} onChange={upd('yape_qr')} /></label>
            <label><span>Yape Fotos</span><input type="number" value={cab.yape_fotos} onChange={upd('yape_fotos')} /></label>
            <label><span>Efectivo</span><input type="number" value={cab.efectivo} onChange={upd('efectivo')} /></label>
            <label><span>Venta del sistema</span><input type="number" value={cab.venta_sistema} onChange={upd('venta_sistema')} /></label>
          </div>
          <div className="totales">
            <div>Yape total: <b>{soles(yapeTotal)}</b></div>
            <div>Gastos: <b>{soles(gastosTotal)}</b></div>
            <div>Venta total: <b>{soles(ventaTotal)}</b></div>
            <div>Meta: <b>{meta != null ? soles(meta) : '—'}</b></div>
            <div className={deficit < 0 ? 'def-neg' : 'def-pos'}>
              {deficit < 0 ? 'Déficit' : 'Sobra'}: <b>{soles(Math.abs(deficit))}</b>
            </div>
          </div>
        </div>

        {/* Gastos + descuentos */}
        <div className="seccion">
          <h2 className="sub-titulo">🛒 Gastos de tienda</h2>
          {gastos.map((g, i) => (
            <div className="fila-mini" key={i}>
              <input placeholder="Descripción" value={g.descripcion} onChange={(e) => setRow(gastos, setGastos, i, 'descripcion', e.target.value)} />
              <input type="number" placeholder="S/" value={g.monto} onChange={(e) => setRow(gastos, setGastos, i, 'monto', e.target.value)} style={{ maxWidth: 80 }} />
              <select value={g.detalle} onChange={(e) => setRow(gastos, setGastos, i, 'detalle', e.target.value)} style={{ maxWidth: 100 }}><option>LOCAL</option><option>DELIVERY</option></select>
              <button className="btn-mini" onClick={() => setGastos(gastos.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="btn-mini" onClick={() => setGastos([...gastos, { descripcion: '', monto: '', detalle: 'LOCAL' }])}>+ gasto</button>

          <h2 className="sub-titulo" style={{ marginTop: 16 }}>👥 Adelantos / descuentos al personal</h2>
          {descs.map((d, i) => (
            <div className="fila-mini" key={i}>
              <input list="lista-personas" placeholder="Persona" value={d.persona} onChange={(e) => setRow(descs, setDescs, i, 'persona', e.target.value)} />
              <input type="number" placeholder="S/" value={d.monto} onChange={(e) => setRow(descs, setDescs, i, 'monto', e.target.value)} style={{ maxWidth: 80 }} />
              <select value={d.tipo} onChange={(e) => setRow(descs, setDescs, i, 'tipo', e.target.value)} style={{ maxWidth: 110 }}><option>ADELANTO</option><option>CONSUMO</option><option>PRESTAMO</option><option>DESCUENTO</option></select>
              <button className="btn-mini" onClick={() => setDescs(descs.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="btn-mini" onClick={() => setDescs([...descs, { persona: '', monto: '', tipo: 'ADELANTO' }])}>+ descuento</button>
          <datalist id="lista-personas">{personas.map((p) => <option key={p.nombres} value={p.nombres} />)}</datalist>
        </div>
      </div>

      {/* Control de stock */}
      <div className="seccion" style={{ marginTop: 20 }}>
        <h2 className="sub-titulo">📦 Control de stock <button className="btn-mini" onClick={crearProducto}>+ nuevo producto</button></h2>
        <table className="tabla">
          <thead><tr><th>Producto</th><th>Inicio</th><th>Adic. (+)</th><th>Salida (−)</th><th>Cierre</th><th>Vendido</th></tr></thead>
          <tbody>
            {stock.map((s, i) => (
              <tr key={s.producto}>
                <td><strong>{s.producto}</strong></td>
                <td><input type="number" value={s.inicio} onChange={(e) => setRow(stock, setStock, i, 'inicio', e.target.value)} className="in-num" /></td>
                <td><input type="number" value={s.adicion} onChange={(e) => setRow(stock, setStock, i, 'adicion', e.target.value)} className="in-num" /></td>
                <td><input type="number" value={s.salida} onChange={(e) => setRow(stock, setStock, i, 'salida', e.target.value)} className="in-num" /></td>
                <td><input type="number" value={s.cierre} onChange={(e) => setRow(stock, setStock, i, 'cierre', e.target.value)} className="in-num" /></td>
                <td><strong>{n(s.inicio) + n(s.adicion) - n(s.salida) - n(s.cierre)}</strong></td>
              </tr>
            ))}
            {stock.length === 0 && <tr><td colSpan="6" className="nota">No hay productos de stock. Créalos con "+ nuevo producto".</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20 }}>
        <button className="btn-guardar" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : '💾 Guardar turno'}</button>
      </div>
    </div>
  )
}
