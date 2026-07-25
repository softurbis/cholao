import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Conteo físico del almacén. MISMO PRINCIPIO QUE EL EFECTIVO CONTADO: el stock que
// calcula el sistema (ingresos − salidas) siempre cuadra consigo mismo, porque sale
// de lo que se registró. Si algo se perdió, se malogró o alguien lo sacó sin anotar,
// el número no se entera. La única forma de saberlo es contar.
//
// Juan cuenta, se guarda el conteo (sistema vs. contado vs. diferencia) y se aplica
// el ajuste al kardex como un movimiento normal con nota CONTEO, para que el stock
// quede igual a la realidad.
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const num = (v) => Number(v || 0)

export default function ConteoAlmacen({ perfil, puedeContar }) {
  const [stock, setStock] = useState([])
  const [ultimos, setUltimos] = useState({})     // último conteo por producto
  const [conteos, setConteos] = useState([])     // historial reciente
  const [cuenta, setCuenta] = useState({})       // {producto_id: lo que contó}
  const [busca, setBusca] = useState('')
  const [soloConStock, setSoloConStock] = useState(true)
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState('')
  const [msg, setMsg] = useState('')

  async function cargar() {
    setCargando(true)
    const [st, ul, hi] = await Promise.all([
      supabase.from('vista_almacen_stock').select('*'),
      supabase.from('vista_ultimo_conteo').select('*'),
      supabase.from('almacen_conteos').select('*').order('fecha', { ascending: false }).limit(60),
    ])
    setStock(st.data || [])
    setUltimos(Object.fromEntries((ul.data || []).map((x) => [x.producto_id, x])))
    setConteos(hi.data || [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const fil = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return stock
      .filter((s) => (!q || s.nombre.toLowerCase().includes(q)) && (!soloConStock || num(s.stock) !== 0))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [stock, busca, soloConStock])

  // Guardar un conteo: deja constancia y ajusta el kardex para que el stock
  // del sistema quede igual a lo que de verdad hay.
  async function guardar(s) {
    const contado = num(cuenta[s.producto_id])
    if (cuenta[s.producto_id] === undefined || cuenta[s.producto_id] === '') return
    const sistema = num(s.stock)
    const dif = contado - sistema
    setOcupado(s.producto_id); setMsg('')

    const { error } = await supabase.from('almacen_conteos').insert({
      fecha: fmt(new Date()), producto_id: s.producto_id, sistema, contado,
      contado_por: perfil?.id || null,
    })
    if (error) { setOcupado(''); return setMsg(error.message) }

    // El ajuste va como movimiento normal (el kardex lo muestra con su nota).
    if (dif !== 0) {
      const { error: eMov } = await supabase.from('almacen_movimientos').insert({
        producto_id: s.producto_id, tipo: dif > 0 ? 'ingreso' : 'salida', cantidad: Math.abs(dif),
        nota: `CONTEO: había ${contado}, el sistema decía ${sistema}`, fecha: fmt(new Date()),
      })
      if (eMov) { setOcupado(''); return setMsg(eMov.message) }
    }
    setCuenta((c) => ({ ...c, [s.producto_id]: '' }))
    setOcupado(''); await cargar()
  }

  if (cargando) return <p className="nota">Cargando…</p>

  return (
    <div>
      <p className="pagina-sub">
        El stock que calcula el sistema siempre cuadra solo, porque sale de lo que se registró.
        Si algo se perdió o salió sin anotarse, solo se sabe contando. Cuenta lo que hay y el
        almacén queda igual a la realidad.
      </p>

      <div className="form-inline" style={{ marginBottom: 10 }}>
        <input placeholder="🔎 Buscar producto…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 200 }} />
        <label className="check-permiso" style={{ margin: 0 }}>
          <input type="checkbox" checked={soloConStock} onChange={(e) => setSoloConStock(e.target.checked)} />
          <span>Solo los que tienen movimiento</span>
        </label>
      </div>
      {msg && <div className="alerta">{msg}</div>}

      <table className="tabla">
        <thead><tr><th>Producto</th><th>Sistema</th>{puedeContar && <th>Conté</th>}<th>Último conteo</th></tr></thead>
        <tbody>
          {fil.map((s) => {
            const c = cuenta[s.producto_id]
            const dif = c !== undefined && c !== '' ? num(c) - num(s.stock) : null
            const ult = ultimos[s.producto_id]
            return (
              <tr key={s.producto_id}>
                <td><strong>{s.nombre}</strong> <span className="nota">{s.unidad}</span></td>
                <td style={{ fontWeight: 700, color: num(s.stock) < 0 ? 'var(--rojo)' : undefined }}>
                  {num(s.stock).toLocaleString('es-PE')}
                </td>
                {puedeContar && (
                  <td>
                    <span className="form-inline" style={{ gap: 6 }}>
                      <input type="number" step="0.001" className="in-num" placeholder={String(num(s.stock))}
                        value={c ?? ''} onChange={(e) => setCuenta((x) => ({ ...x, [s.producto_id]: e.target.value }))}
                        style={{ maxWidth: 90 }} />
                      <button className="btn-mini btn-ok" disabled={ocupado === s.producto_id || c === undefined || c === ''}
                        onClick={() => guardar(s)}>{ocupado === s.producto_id ? '…' : '✓'}</button>
                      {dif !== null && dif !== 0 && (
                        <span className="chip" style={dif < 0
                          ? { background: '#fee2e2', color: '#991b1b' }
                          : { background: '#fef9c3', color: '#854d0e' }}>
                          {dif < 0 ? `faltan ${Math.abs(dif)}` : `sobran ${dif}`}
                        </span>
                      )}
                    </span>
                  </td>
                )}
                <td className="nota">
                  {ult ? `${ult.fecha}${num(ult.diferencia) !== 0 ? ` (${num(ult.diferencia) > 0 ? '+' : ''}${num(ult.diferencia)})` : ' ✓'}` : 'Nunca'}
                </td>
              </tr>
            )
          })}
          {fil.length === 0 && <tr><td colSpan="4" className="nota">Nada que contar con ese filtro.</td></tr>}
        </tbody>
      </table>

      {conteos.length > 0 && (
        <div className="panel-detalle">
          <h3>Conteos recientes</h3>
          <p className="nota">Dónde se viene perdiendo mercadería: las diferencias que se repiten en el mismo producto no son casualidad.</p>
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Producto</th><th>Sistema</th><th>Contó</th><th>Diferencia</th></tr></thead>
            <tbody>
              {conteos.slice(0, 30).map((c) => {
                const nom = stock.find((s) => s.producto_id === c.producto_id)?.nombre || '—'
                return (
                  <tr key={c.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{c.fecha}</td>
                    <td><strong>{nom}</strong></td>
                    <td>{num(c.sistema).toLocaleString('es-PE')}</td>
                    <td>{num(c.contado).toLocaleString('es-PE')}</td>
                    <td style={{ fontWeight: 700, color: num(c.diferencia) < 0 ? 'var(--rojo)' : num(c.diferencia) > 0 ? '#854d0e' : undefined }}>
                      {num(c.diferencia) === 0 ? 'cuadró' : `${num(c.diferencia) > 0 ? '+' : ''}${num(c.diferencia)}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
