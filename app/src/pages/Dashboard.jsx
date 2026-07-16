import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic']
const CAT_LABEL = { compras: 'Compras/insumos', planilla: 'Planilla', admin_gerencial: 'Admin/gerencial', deuda_retiro: 'Deuda/retiro', operativo: 'Operativo' }

export default function Dashboard() {
  const { perfil } = useAuth()
  const [ventas, setVentas] = useState([])
  const [gastos, setGastos] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    (async () => {
      const [{ data: v }, { data: g }] = await Promise.all([
        supabase.from('ventas').select('fecha,total').limit(20000),
        supabase.from('gastos').select('fecha,monto,categoria').limit(5000),
      ])
      setVentas(v || []); setGastos(g || []); setCargando(false)
    })()
  }, [])

  const ingTotal = useMemo(() => ventas.reduce((a, x) => a + Number(x.total || 0), 0), [ventas])
  const egrTotal = useMemo(() => gastos.reduce((a, x) => a + Number(x.monto || 0), 0), [gastos])
  const saldo = ingTotal - egrTotal

  // Flujo por mes (2026)
  const porMes = useMemo(() => {
    const m = {}
    const bump = (k, campo, val) => { (m[k] ??= { ing: 0, egr: 0 })[campo] += val }
    for (const v of ventas) if (v.fecha) bump(v.fecha.slice(0, 7), 'ing', Number(v.total || 0))
    for (const g of gastos) if (g.fecha) bump(g.fecha.slice(0, 7), 'egr', Number(g.monto || 0))
    return Object.entries(m).sort().map(([k, val]) => ({ mes: k, ...val, neto: val.ing - val.egr }))
  }, [ventas, gastos])

  const porCat = useMemo(() => {
    const m = {}; for (const g of gastos) m[g.categoria] = (m[g.categoria] || 0) + Number(g.monto || 0)
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [gastos])

  const maxBar = Math.max(1, ...porMes.map((r) => Math.max(r.ing, r.egr)))

  if (cargando) return <div className="pagina"><h1>📊 Panel</h1><p className="nota">Cargando…</p></div>

  return (
    <div className="pagina">
      <h1>📊 Panel de control</h1>
      <p className="pagina-sub">Hola{perfil?.nombre ? `, ${perfil.nombre}` : ''}. Flujo de dinero 2026 — puro números.</p>

      <div className="tarjetas">
        <div className="tarjeta"><span className="t-label">Ingresos (ventas)</span><span className="t-valor">{soles(ingTotal)}</span></div>
        <div className="tarjeta"><span className="t-label">Egresos (gastos)</span><span className="t-valor">{soles(egrTotal)}</span></div>
        <div className="tarjeta"><span className="t-label">Saldo</span><span className="t-valor" style={{ color: saldo < 0 ? 'var(--rojo)' : '#1a7f37' }}>{soles(saldo)}</span></div>
        <div className="tarjeta"><span className="t-label">Movimientos</span><span className="t-valor">{ventas.length + gastos.length}</span></div>
      </div>

      <div className="aviso-config" style={{ maxWidth: 640, margin: '16px 0' }}>
        <span><strong>Nota:</strong> las ventas cargadas son solo de <strong>julio</strong> (Amazonas). Cuando suba el histórico completo, los ingresos por mes se llenan y el saldo será real.</span>
      </div>

      <h2 style={{ fontSize: 18, margin: '18px 0 10px' }}>Flujo por mes</h2>
      <table className="tabla">
        <thead><tr><th>Mes</th><th>Ingresos</th><th>Egresos</th><th>Neto</th><th style={{ width: '38%' }}></th></tr></thead>
        <tbody>
          {porMes.map((r) => {
            const [y, mo] = r.mes.split('-')
            return (
              <tr key={r.mes}>
                <td style={{ whiteSpace: 'nowrap' }}>{MESES[+mo]} {y}</td>
                <td style={{ color: '#1a7f37' }}>{soles(r.ing)}</td>
                <td style={{ color: 'var(--rojo)' }}>{soles(r.egr)}</td>
                <td style={{ fontWeight: 700 }}>{soles(r.neto)}</td>
                <td>
                  <div style={{ display: 'grid', gap: 3 }}>
                    <div style={{ height: 8, background: '#1a7f37', borderRadius: 3, width: `${(r.ing / maxBar) * 100}%`, minWidth: r.ing ? 2 : 0 }} />
                    <div style={{ height: 8, background: 'var(--rojo)', borderRadius: 3, width: `${(r.egr / maxBar) * 100}%`, minWidth: r.egr ? 2 : 0 }} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h2 style={{ fontSize: 18, margin: '24px 0 10px' }}>Egresos por categoría (2026)</h2>
      <div className="tarjetas">
        {porCat.map(([c, v]) => (
          <div className="tarjeta" key={c}><span className="t-label">{CAT_LABEL[c] || c}</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(v)}</span></div>
        ))}
      </div>
    </div>
  )
}
