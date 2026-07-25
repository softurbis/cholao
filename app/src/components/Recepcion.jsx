import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Recepción / validación de entrega de una sede. La sede confirma, CONFORME va
// llegando, cuánto recibió de cada ítem de su lista; cada recepción descuenta del
// almacén central (una SALIDA hacia esa sede). Parcial permitido: cantidad_recibida
// se acumula. Reutilizado por "Mi Lista" (cocina) y por Compras (Juan/almacén).
// También deja registrar recepciones de emergencia (fuera de la lista).
const hoy = () => new Date().toISOString().slice(0, 10)

export default function Recepcion({ sedeId, sedeNombre, perfil, puedeRecibir }) {
  const [lista, setLista] = useState(null)
  const [items, setItems] = useState([])
  const [productos, setProductos] = useState([])
  const [movs, setMovs] = useState([])
  const [comprado, setComprado] = useState({})   // {producto_id: cantidad comprada para esta sede}
  const [cargando, setCargando] = useState(true)
  const [recibir, setRecibir] = useState({})   // {itemId: cantidad a recibir ahora}
  const [emerg, setEmerg] = useState({ producto_id: '', cantidad: '' })
  const [msg, setMsg] = useState('')

  async function cargar() {
    if (!sedeId) { setCargando(false); return }
    setCargando(true); setMsg('')
    const { data: listas } = await supabase.from('compras_listas').select('*')
      .eq('sede_id', sedeId).in('estado', ['enviada', 'atendida']).order('fecha', { ascending: false }).limit(1)
    const l = (listas || [])[0] || null
    const [{ data: it }, { data: pr }, { data: mv }, { data: cp }] = await Promise.all([
      l ? supabase.from('compras_lista_items').select('*').eq('lista_id', l.id).order('id') : Promise.resolve({ data: [] }),
      supabase.from('productos').select('id, nombre, unidad').eq('activo', true).order('nombre'),
      supabase.from('almacen_movimientos').select('*').eq('sede_id', sedeId).eq('tipo', 'salida').order('fecha', { ascending: false }).limit(50),
      // Lo que Juan compró PARA esta sede desde que se envió la lista: así se ve la
      // cadena completa (pidieron → compró → llegó) sin salir de esta pantalla.
      l ? supabase.from('compras').select('producto_id, cantidad').eq('destino_sede_id', sedeId).gte('fecha', l.fecha) : Promise.resolve({ data: [] }),
    ])
    setLista(l); setItems(it || []); setProductos(pr || []); setMovs(mv || [])
    const m = {}
    for (const c of (cp || [])) if (c.producto_id) m[c.producto_id] = (m[c.producto_id] || 0) + Number(c.cantidad || 0)
    setComprado(m)
    setCargando(false)
  }
  useEffect(() => { cargar() }, [sedeId])   // eslint-disable-line react-hooks/exhaustive-deps

  const prodN = useMemo(() => Object.fromEntries(productos.map((p) => [p.id, p])), [productos])

  // Da recepción de un ítem: descuenta del almacén (si es del catálogo) y acumula.
  async function darRecepcion(it) {
    const rem = Number(it.cantidad || 0) - Number(it.cantidad_recibida || 0)
    const delta = recibir[it.id] !== undefined && recibir[it.id] !== '' ? Number(recibir[it.id]) : rem
    if (!(delta > 0)) return setMsg('Pon una cantidad mayor a 0.')
    setMsg('')
    if (it.producto_id) {
      const { error } = await supabase.from('almacen_movimientos').insert({
        producto_id: it.producto_id, tipo: 'salida', cantidad: delta, sede_id: sedeId, nota: 'Recepción', fecha: hoy(),
      })
      if (error) return setMsg('No pude descontar del almacén: ' + error.message)
    }
    const { error: eUp } = await supabase.from('compras_lista_items').update({ cantidad_recibida: Number(it.cantidad_recibida || 0) + delta }).eq('id', it.id)
    if (eUp) return setMsg(eUp.message)
    setRecibir((s) => ({ ...s, [it.id]: '' })); cargar()
  }
  async function darEmergencia() {
    const p = prodN[emerg.producto_id]
    if (!p || !(Number(emerg.cantidad) > 0)) return setMsg('Elige producto y cantidad.')
    const { error } = await supabase.from('almacen_movimientos').insert({
      producto_id: p.id, tipo: 'salida', cantidad: Number(emerg.cantidad), sede_id: sedeId, nota: 'EMERGENCIA', fecha: hoy(),
    })
    if (error) return setMsg(error.message)
    setEmerg({ producto_id: '', cantidad: '' }); cargar()
  }

  if (!sedeId) return <p className="nota">Elige una sede.</p>
  if (cargando) return <p className="nota">Cargando…</p>

  const pendientes = items.filter((it) => Number(it.cantidad_recibida || 0) < Number(it.cantidad || 0))

  return (
    <div>
      <h3>📥 Recepción — {sedeNombre || ''} {lista && <span className="nota">· lista del {lista.fecha}</span>}</h3>
      <p className="nota">Conforme llega, marca cuánto recibiste de cada producto. Cada recepción descuenta del almacén.</p>
      {msg && <div className="alerta">{msg}</div>}
      {!lista ? <p className="nota">Esta sede no tiene una lista enviada por recibir.</p> : (<>
        <table className="tabla">
          <thead><tr><th>Producto</th><th>Pidieron</th><th>Compró</th><th>Llegó</th>{puedeRecibir && <th>Recibir ahora</th>}</tr></thead>
          <tbody>
            {items.map((it) => {
              const ped = Number(it.cantidad || 0), rec = Number(it.cantidad_recibida || 0)
              const completo = rec >= ped, rem = Math.max(0, ped - rec)
              return (
                <tr key={it.id} className={completo ? 'fila-inactiva' : ''}>
                  <td><strong>{prodN[it.producto_id]?.nombre || it.nombre_libre || '—'}</strong> <span className="nota">{it.unidad || ''}</span></td>
                  <td>{ped.toLocaleString('es-PE')}</td>
                  <td className="nota">{comprado[it.producto_id] ? Number(comprado[it.producto_id]).toLocaleString('es-PE') : '—'}</td>
                  <td>{rec.toLocaleString('es-PE')} {completo && <span className="chip chip-ok" style={{ marginLeft: 4 }}>completo</span>}</td>
                  {puedeRecibir && <td>{completo ? '—' : (
                    <span className="form-inline" style={{ gap: 4 }}>
                      <input type="number" step="0.001" placeholder={String(rem)} className="in-num" value={recibir[it.id] ?? ''} onChange={(e) => setRecibir((s) => ({ ...s, [it.id]: e.target.value }))} style={{ maxWidth: 80 }} />
                      <button className="btn-mini btn-ok" onClick={() => darRecepcion(it)}>✓ Recibí</button>
                    </span>
                  )}</td>}
                </tr>
              )
            })}
            {items.length === 0 && <tr><td colSpan={puedeRecibir ? 5 : 4} className="nota">La lista no tiene productos.</td></tr>}
          </tbody>
        </table>
        {pendientes.length === 0 && items.length > 0 && <p className="aviso-ok">✅ Todo lo de la lista fue recibido.</p>}

        {puedeRecibir && (
          <div className="panel-detalle" style={{ marginTop: 12 }}>
            <h3>➕ Recepción de emergencia <span className="nota">(algo que llegó fuera de la lista)</span></h3>
            <div className="form-inline">
              <select value={emerg.producto_id} onChange={(e) => setEmerg({ ...emerg, producto_id: e.target.value })} style={{ minWidth: 170 }}>
                <option value="">Producto…</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.unidad})</option>)}
              </select>
              <input type="number" step="0.001" placeholder="Cantidad" className="in-num" value={emerg.cantidad} onChange={(e) => setEmerg({ ...emerg, cantidad: e.target.value })} style={{ maxWidth: 100 }} />
              <button className="btn-mini" onClick={darEmergencia}>+ Registrar</button>
            </div>
          </div>
        )}

        {movs.length > 0 && (<>
          <h4 className="sub-titulo" style={{ marginTop: 16 }}>Recibido últimamente</h4>
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Producto</th><th>Cantidad</th><th>Detalle</th></tr></thead>
            <tbody>
              {movs.slice(0, 20).map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{m.fecha}</td>
                  <td>{prodN[m.producto_id]?.nombre || '—'}</td>
                  <td>{Number(m.cantidad).toLocaleString('es-PE')} {prodN[m.producto_id]?.unidad || ''}</td>
                  <td className="nota">{m.nota || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>)}
      </>)}
    </div>
  )
}
