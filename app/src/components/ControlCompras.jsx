import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Panel de control de administración. NO frena la operación: se compra y todo fluye;
// aquí se revisa después. Todo va EN SOLES porque los tres riesgos del negocio
// son de dinero (comprar de más, que no cuadre, que falte producto).
//
// Responde las cuatro preguntas de control, en orden de importancia:
//   1. ¿La plata cuadra?      → contra el efectivo CONTADO, no contra la aritmética.
//   2. ¿Hay comprobantes?     → cuánto se gastó sin respaldo.
//   3. ¿Los precios son sanos?→ lo comprado hoy vs. lo que se venía pagando.
//   4. ¿Se cubrió lo pedido?  → qué pidieron las sedes y no se compró.
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diaAnterior = (iso) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - 1); return fmt(d) }
const num = (v) => Number(v || 0)

export default function ControlCompras({ sedes, catalogo }) {
  const [fecha, setFecha] = useState(fmt(new Date()))
  const [compras, setCompras] = useState([])
  const [historico, setHistorico] = useState([])   // 30 días previos, para comparar precios
  const [cuadre, setCuadre] = useState(null)
  const [movs, setMovs] = useState([])
  const [turnos, setTurnos] = useState([])
  const [prevSaldo, setPrevSaldo] = useState(0)
  const [itemsLista, setItemsLista] = useState([])   // items de las listas ENVIADAS (traen cantidad_recibida)
  const [contado, setContado] = useState('')
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState('')

  const amazonas = useMemo(() => sedes.find((s) => /AMAZONAS/i.test(s.nombre)), [sedes])
  const prodN = useMemo(() => Object.fromEntries(catalogo.map((p) => [p.id, p])), [catalogo])
  const sedeN = useMemo(() => Object.fromEntries(sedes.map((s) => [s.id, s.nombre])), [sedes])

  async function cargar() {
    setCargando(true); setMsg('')
    const ayer = diaAnterior(fecha)
    const desde = new Date(fecha + 'T12:00:00'); desde.setDate(desde.getDate() - 30)
    const [cp, hi, dia, prev, mv, tu] = await Promise.all([
      supabase.from('compras').select('*').eq('fecha', fecha),
      supabase.from('compras').select('producto_id, precio_unitario, fecha').gte('fecha', fmt(desde)).lt('fecha', fecha),
      supabase.from('fondo_compras_dia').select('*').eq('fecha', fecha).maybeSingle(),
      supabase.from('fondo_compras_dia').select('vuelto_saldo').lt('fecha', fecha).order('fecha', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('fondo_movimientos').select('*').eq('fecha', fecha),
      amazonas ? supabase.from('caja_turno').select('turno, efectivo').eq('sede_id', amazonas.id).eq('fecha', ayer) : Promise.resolve({ data: [] }),
    ])
    // Los items de las listas enviadas: de ahí sale la cadena pidieron → compró → llegó.
    // Se leen directo (no de la vista) porque solo la tabla trae `cantidad_recibida`.
    const { data: ls } = await supabase.from('compras_listas').select('id').eq('estado', 'enviada')
    const ids = (ls || []).map((x) => x.id)
    const its = ids.length ? (await supabase.from('compras_lista_items').select('*').in('lista_id', ids)).data : []
    setItemsLista(its || [])
    setCompras(cp.data || []); setHistorico(hi.data || []); setCuadre(dia.data)
    setMovs(mv.data || []); setTurnos(tu.data || [])
    setPrevSaldo(num(prev.data?.vuelto_saldo))
    setContado(dia.data?.efectivo_contado != null ? String(dia.data.efectivo_contado) : '')
    setCargando(false)
  }
  useEffect(() => { cargar() }, [fecha, amazonas?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  // --- 1. El dinero -----------------------------------------------------
  const base = num(cuadre ? cuadre.base_inicial : prevSaldo)
  const manana = num(cuadre ? cuadre.efectivo_manana : turnos.find((t) => t.turno === 'manana')?.efectivo)
  const tarde = num(cuadre ? cuadre.efectivo_tarde : turnos.find((t) => t.turno === 'tarde')?.efectivo)
  const adic = movs.filter((m) => m.tipo === 'adicional').reduce((a, m) => a + num(m.monto), 0)
  const entregas = movs.filter((m) => m.tipo === 'entrega_gerencia').reduce((a, m) => a + num(m.monto), 0)
  const recibio = base + manana + tarde + adic
  const gastado = compras.reduce((a, c) => a + num(c.total), 0)
  const deberiaTener = recibio - gastado - entregas
  const hayConteo = contado !== '' && !Number.isNaN(Number(contado))
  const descuadre = hayConteo ? num(contado) - deberiaTener : null

  // --- 2. Comprobantes --------------------------------------------------
  const sinComp = compras.filter((c) => !c.voucher_url)
  const montoSinComp = sinComp.reduce((a, c) => a + num(c.total), 0)

  // --- 3. Precios: lo de hoy contra el promedio de los 30 días previos ---
  const alertasPrecio = useMemo(() => {
    const ref = {}
    for (const h of historico) {
      if (!h.producto_id || !num(h.precio_unitario)) continue
      ref[h.producto_id] = ref[h.producto_id] || { suma: 0, n: 0 }
      ref[h.producto_id].suma += num(h.precio_unitario); ref[h.producto_id].n++
    }
    const out = []
    for (const c of compras) {
      const r = ref[c.producto_id]
      if (!r || !r.n || !num(c.precio_unitario)) continue
      const prom = r.suma / r.n
      const var_ = (num(c.precio_unitario) - prom) / prom
      // Solo lo que se sale del ±20%: por debajo es ruido normal del mercado.
      if (Math.abs(var_) >= 0.2) out.push({ ...c, prom, var_ })
    }
    return out.sort((a, b) => Math.abs(b.var_) - Math.abs(a.var_))
  }, [compras, historico])

  // --- 4. La cadena completa: pidieron → compró → llegó ------------------
  const cobertura = useMemo(() => {
    const m = {}
    for (const it of itemsLista) {
      if (!it.producto_id) continue
      m[it.producto_id] = m[it.producto_id] || {
        producto: prodN[it.producto_id]?.nombre || it.nombre_libre || '—',
        unidad: it.unidad || prodN[it.producto_id]?.unidad || '', pedido: 0, recibido: 0, comprado: 0,
      }
      m[it.producto_id].pedido += num(it.cantidad)
      m[it.producto_id].recibido += num(it.cantidad_recibida)
    }
    for (const c of compras) if (c.producto_id && m[c.producto_id]) m[c.producto_id].comprado += num(c.cantidad)
    return Object.values(m).sort((a, b) => a.producto.localeCompare(b.producto))
  }, [itemsLista, compras, prodN])
  const conFalta = cobertura.filter((p) => p.comprado < p.pedido).length

  async function guardarConteo() {
    if (!hayConteo) return setMsg('Escribe cuánto efectivo se contó.')
    const { error } = await supabase.from('fondo_compras_dia').upsert({
      fecha, base_inicial: base, efectivo_manana: manana, efectivo_tarde: tarde,
      adicionales: adic, dinero_total: recibio, gasto_total: gastado, entrega_admin: entregas,
      vuelto_saldo: deberiaTener, efectivo_contado: num(contado),
    }, { onConflict: 'fecha' })
    if (error) return setMsg(error.message)
    setMsg('Conteo guardado.'); cargar()
  }

  if (cargando) return <p className="nota">Cargando…</p>

  return (
    <div>
      <p className="pagina-sub">Revisión del día: si la plata cuadra, qué se gastó sin comprobante, qué precios se salieron de lo normal y qué pidieron las sedes que no se compró.</p>

      <div className="form-inline" style={{ marginBottom: 12 }}>
        <label className="campo"><span>Día</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      </div>
      {msg && <div className="alerta">{msg}</div>}

      <div className="tarjetas" style={{ marginBottom: 16 }}>
        <div className="tarjeta"><span className="t-label">Recibió</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(recibio)}</span></div>
        <div className="tarjeta"><span className="t-label">Compró ({compras.length})</span><span className="t-valor" style={{ fontSize: 20, color: 'var(--rojo)' }}>{soles(gastado)}</span></div>
        <div className="tarjeta"><span className="t-label">A gerencia</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(entregas)}</span></div>
        <div className="tarjeta"><span className="t-label">Debería tener</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(deberiaTener)}</span></div>
      </div>

      <div className="panel-detalle">
        <h3>¿La plata cuadra?</h3>
        <p className="nota">El saldo de arriba es aritmética sobre lo que se registró: siempre va a cuadrar solo. Lo que de verdad controla es contar el efectivo que le quedó.</p>
        <div className="form-inline">
          <label className="campo"><span>Efectivo contado</span>
            <input type="number" step="0.01" className="in-num" value={contado} onChange={(e) => setContado(e.target.value)} placeholder={String(deberiaTener.toFixed(2))} style={{ maxWidth: 140 }} />
          </label>
          <button className="btn-mini" onClick={guardarConteo}>Guardar conteo</button>
        </div>
        {hayConteo && (
          <p style={{ marginTop: 10, fontSize: 17 }}>
            {descuadre === 0 ? <span className="chip chip-ok">Cuadra exacto</span>
              : descuadre < 0
                ? <span className="chip" style={{ background: '#fee2e2', color: '#991b1b' }}>Falta {soles(Math.abs(descuadre))}</span>
                : <span className="chip" style={{ background: '#fef9c3', color: '#854d0e' }}>Sobra {soles(descuadre)} — puede ser una compra sin registrar</span>}
          </p>
        )}
      </div>

      <div className="panel-detalle">
        <h3>Gastos sin comprobante <span className="nota">{soles(montoSinComp)} de {soles(gastado)}</span></h3>
        {sinComp.length === 0
          ? <p className="nota">Todo lo del día tiene su comprobante.</p>
          : (
            <table className="tabla">
              <thead><tr><th>Producto</th><th>Proveedor</th><th>Monto</th><th>Destino</th></tr></thead>
              <tbody>
                {sinComp.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.nombre_libre}</strong> <span className="nota">{c.cantidad} {c.unidad}</span></td>
                    <td>{c.proveedor || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{soles(c.total)}</td>
                    <td>{sedeN[c.destino_sede_id] || 'Almacén'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      <div className="panel-detalle">
        <h3>Precios fuera de lo normal</h3>
        {alertasPrecio.length === 0
          ? <p className="nota">Ningún precio de hoy se salió más de 20% de lo que se venía pagando el último mes.</p>
          : (
            <table className="tabla">
              <thead><tr><th>Producto</th><th>Pagó</th><th>Venía pagando</th><th>Variación</th></tr></thead>
              <tbody>
                {alertasPrecio.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.nombre_libre}</strong></td>
                    <td>{soles(c.precio_unitario)}</td>
                    <td className="nota">{soles(c.prom)}</td>
                    <td style={{ fontWeight: 700, color: c.var_ > 0 ? 'var(--rojo)' : '#15803d' }}>
                      {c.var_ > 0 ? '+' : ''}{Math.round(c.var_ * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      <div className="panel-detalle">
        <h3>Pidieron → compró → llegó {conFalta > 0 && <span className="nota">{conFalta} sin cubrir</span>}</h3>
        {cobertura.length === 0
          ? <p className="nota">Ninguna sede tiene listas enviadas pendientes.</p>
          : (
            <table className="tabla">
              <thead><tr><th>Producto</th><th>Pidieron</th><th>Compró</th><th>Llegó</th><th>Falta</th></tr></thead>
              <tbody>
                {cobertura.map((p) => {
                  const falta = p.pedido - p.comprado
                  return (
                    <tr key={p.producto} className={falta <= 0 ? 'fila-inactiva' : ''}>
                      <td><strong>{p.producto}</strong> <span className="nota">{p.unidad}</span></td>
                      <td>{p.pedido.toLocaleString('es-PE')}</td>
                      <td>{p.comprado.toLocaleString('es-PE')}</td>
                      <td>{p.recibido.toLocaleString('es-PE')}</td>
                      <td style={{ fontWeight: 700, color: falta > 0 ? 'var(--rojo)' : undefined }}>
                        {falta > 0 ? falta.toLocaleString('es-PE') : '✓'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
      </div>

      <div className="panel-detalle">
        <h3>Todo lo comprado el {fecha}</h3>
        {compras.length === 0 ? <p className="nota">Sin compras este día.</p> : (
          <table className="tabla">
            <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Total</th><th>Proveedor</th><th>Destino</th><th>Comp.</th></tr></thead>
            <tbody>
              {compras.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.nombre_libre}</strong></td>
                  <td>{c.cantidad} {c.unidad}</td>
                  <td>{soles(c.precio_unitario)}</td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{soles(c.total)}</td>
                  <td>{c.proveedor || '—'}</td>
                  <td>{sedeN[c.destino_sede_id] || 'Almacén'}</td>
                  <td>{c.voucher_url
                    ? <button className="btn-mini" onClick={async () => {
                        const { data } = await supabase.storage.from('arqueos').createSignedUrl(c.voucher_url, 3600)
                        if (data?.signedUrl) window.open(data.signedUrl, '_blank')
                      }}>📎</button>
                    : <span className="chip chip-off">sin</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
