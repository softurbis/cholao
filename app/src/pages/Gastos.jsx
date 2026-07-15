import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const CATEGORIAS = ['compras', 'planilla', 'admin_gerencial', 'deuda_retiro', 'operativo']
const CAT_LABEL = {
  compras: 'Compras/insumos', planilla: 'Planilla', admin_gerencial: 'Admin/gerencial',
  deuda_retiro: 'Deuda/retiro', operativo: 'Operativo',
}
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Gastos() {
  const [gastos, setGastos] = useState([])
  const [sedes, setSedes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [fMes, setFMes] = useState('')
  const [fCat, setFCat] = useState('')

  async function cargar() {
    setCargando(true)
    const [{ data: g }, { data: s }] = await Promise.all([
      supabase.from('gastos').select('*').order('fecha', { ascending: false }).limit(2000),
      supabase.from('sedes').select('id, nombre').order('nombre'),
    ])
    setGastos(g || []); setSedes(s || []); setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const meses = useMemo(() =>
    [...new Set(gastos.map((x) => (x.fecha || '').slice(0, 7)))].filter(Boolean).sort().reverse(),
    [gastos])

  const filtrados = useMemo(() => gastos.filter((x) =>
    (!fMes || (x.fecha || '').startsWith(fMes)) && (!fCat || x.categoria === fCat)), [gastos, fMes, fCat])

  const porCat = useMemo(() => {
    const m = {}; for (const x of filtrados) m[x.categoria] = (m[x.categoria] || 0) + Number(x.monto || 0); return m
  }, [filtrados])
  const total = useMemo(() => filtrados.reduce((a, x) => a + Number(x.monto || 0), 0), [filtrados])

  async function actualizar(id, campo, valor) {
    setGastos((prev) => prev.map((x) => (x.id === id ? { ...x, [campo]: valor } : x)))
    await supabase.from('gastos').update({ [campo]: valor || null }).eq('id', id)
  }

  return (
    <div className="pagina">
      <h1>📉 Gastos</h1>
      <p className="pagina-sub">Ledger de egresos 2026. Reclasifica categoría o asigna sede aquí mismo.</p>

      <div className="tarjetas" style={{ marginBottom: 18 }}>
        <div className="tarjeta"><span className="t-label">Total {fMes || '2026'}</span><span className="t-valor">{soles(total)}</span></div>
        {CATEGORIAS.filter((c) => porCat[c]).map((c) => (
          <div className="tarjeta" key={c}><span className="t-label">{CAT_LABEL[c]}</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(porCat[c])}</span></div>
        ))}
      </div>

      <div className="form-inline">
        <select value={fMes} onChange={(e) => setFMes(e.target.value)}>
          <option value="">Todos los meses</option>
          {meses.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
        </select>
        <span className="nota" style={{ alignSelf: 'center' }}>{filtrados.length} gastos</span>
      </div>

      {cargando ? <p className="nota">Cargando…</p> : (
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Categoría</th><th>Sede</th></tr></thead>
          <tbody>
            {filtrados.map((x) => (
              <tr key={x.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td>{x.concepto}{x.nota ? <span className="chip chip-off" style={{ marginLeft: 6 }}>{x.nota}</span> : null}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{soles(x.monto)}</td>
                <td>
                  <select value={x.categoria || ''} onChange={(e) => actualizar(x.id, 'categoria', e.target.value)}>
                    {CATEGORIAS.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                  </select>
                </td>
                <td>
                  <select value={x.sede_id || ''} onChange={(e) => actualizar(x.id, 'sede_id', e.target.value)}>
                    <option value="">General</option>
                    {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
