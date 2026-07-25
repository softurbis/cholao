import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Manual from '../components/Manual'

const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export default function Config() {
  const [tab, setTab] = useState('productos')
  const [sedes, setSedes] = useState([])
  const [prods, setProds] = useState([])
  const [metas, setMetas] = useState([])
  const [turnos, setTurnos] = useState([])
  const [invDias, setInvDias] = useState([])
  const [sedeMeta, setSedeMeta] = useState('')
  const [nuevo, setNuevo] = useState({ nombre: '', stock_minimo: '' })

  async function cargar() {
    const [{ data: s }, { data: p }, { data: m }, { data: c }, { data: t }] = await Promise.all([
      supabase.from('sedes').select('id, nombre').order('nombre'),
      supabase.from('productos_stock').select('*').order('orden'),
      supabase.from('caja_metas').select('*'),
      supabase.from('config').select('*').eq('clave', 'inventario_dias').maybeSingle(),
      supabase.from('sede_turnos').select('*').eq('activo', true).order('orden'),
    ])
    setSedes(s || []); setProds(p || []); setMetas(m || [])
    setTurnos(t || [])
    setInvDias(c?.valor || [])
    if (s?.[0] && !sedeMeta) setSedeMeta(s[0].id)
  }
  useEffect(() => { cargar() }, [])

  // Las columnas salen de los turnos QUE TRABAJA la sede, no de dos fijas.
  // Antes esta tabla tenía "Meta Mañana" y "Meta Tarde" cableadas, así que a
  // Miraflores —que trabaja un solo turno— le pedía una meta de tarde que no
  // existe, y a una sede con 3 turnos no habría dónde ponérsela.
  const turnosSede = turnos.filter((t) => t.sede_id === sedeMeta)

  async function addProd() {
    if (!nuevo.nombre.trim()) return
    await supabase.from('productos_stock').insert({ nombre: nuevo.nombre.toUpperCase().replace(/\s+/g, ' ').trim(), stock_minimo: Number(nuevo.stock_minimo) || 0, orden: prods.length + 1 })
    setNuevo({ nombre: '', stock_minimo: '' }); cargar()
  }
  async function delProd(id) { if (confirm('¿Quitar producto?')) { await supabase.from('productos_stock').delete().eq('id', id); cargar() } }

  async function setMeta(dia, turno, valor) {
    const existe = metas.find((m) => m.sede_id === sedeMeta && m.dia_semana === dia && m.turno === turno.codigo)
    if (existe) await supabase.from('caja_metas').update({ meta: Number(valor) || 0, turno_id: turno.id }).eq('id', existe.id)
    else await supabase.from('caja_metas').insert({ sede_id: sedeMeta, dia_semana: dia, turno: turno.codigo, turno_id: turno.id, meta: Number(valor) || 0 })
    cargar()
  }
  const metaVal = (dia, turno) => metas.find((m) => m.sede_id === sedeMeta && m.dia_semana === dia && m.turno === turno.codigo)?.meta ?? ''

  async function toggleDia(dia) {
    const nuevos = invDias.includes(dia) ? invDias.filter((d) => d !== dia) : [...invDias, dia]
    setInvDias(nuevos)
    await supabase.from('config').upsert({ clave: 'inventario_dias', valor: nuevos, updated_at: new Date().toISOString() })
  }

  return (
    <div className="pagina">
      <h1>⚙️ Configuración<Manual modulo="config" /></h1>
      <p className="pagina-sub">Productos de stock, metas por sede/turno y días de inventario.</p>

      <div className="tab-bar">
        {[['productos', 'Productos de stock'], ['metas', 'Metas por sede/turno'], ['inventario', 'Días de inventario']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'tab activo' : 'tab'} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'productos' && (<>
        <div className="form-inline">
          <input placeholder="Nombre del producto" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          <input type="number" placeholder="Stock mín." value={nuevo.stock_minimo} onChange={(e) => setNuevo({ ...nuevo, stock_minimo: e.target.value })} style={{ maxWidth: 120 }} />
          <button onClick={addProd}>+ Añadir producto</button>
        </div>
        <table className="tabla">
          <thead><tr><th>Producto</th><th>Stock mínimo</th><th></th></tr></thead>
          <tbody>
            {prods.map((p) => (
              <tr key={p.id}><td><strong>{p.nombre}</strong></td><td>{p.stock_minimo}</td>
                <td><button className="btn-mini btn-peligro" onClick={() => delProd(p.id)}>Quitar</button></td></tr>
            ))}
          </tbody>
        </table>
      </>)}

      {tab === 'metas' && (<>
        <div className="form-inline">
          <select value={sedeMeta} onChange={(e) => setSedeMeta(e.target.value)}>{sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
        </div>
        {turnosSede.length === 0 ? (
          <div className="bloque-vacio">
            <p>Esta sede no tiene turnos configurados, así que no hay dónde poner la meta.</p>
            <p className="nota">Configúralos en <strong>Sedes → 🕒 Turnos y horario</strong>.</p>
          </div>
        ) : (<>
          <table className="tabla">
            <thead>
              <tr>
                <th>Día</th>
                {turnosSede.map((t) => <th key={t.id}>Meta {t.nombre}</th>)}
              </tr>
            </thead>
            <tbody>
              {DIAS.map((d) => (
                <tr key={d}>
                  <td><strong>{d}</strong></td>
                  {turnosSede.map((t) => (
                    <td key={t.id}>
                      <input type="number" defaultValue={metaVal(d, t)} onBlur={(e) => setMeta(d, t, e.target.value)}
                        className="in-num" style={{ maxWidth: 130 }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="nota">Se guarda al salir de cada casilla. Las columnas son los turnos que trabaja esta sede.</p>
        </>)}
      </>)}

      {tab === 'inventario' && (<>
        <p className="pagina-sub">Marca los días en que se hace conteo físico de inventario:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {DIAS.map((d) => (
            <button key={d} className={invDias.includes(d.toLowerCase()) || invDias.includes(d) ? 'chip-dia activo' : 'chip-dia'} onClick={() => toggleDia(d.toLowerCase())}>{d}</button>
          ))}
        </div>
      </>)}
    </div>
  )
}
