import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic']
const CAT_LABEL = { compras: 'Compras/insumos', planilla: 'Planilla', admin_gerencial: 'Admin/gerencial', deuda_retiro: 'Deuda/retiro', operativo: 'Operativo', gastos_caja: 'Gastos de caja' }

export default function Dashboard() {
  const { perfil } = useAuth()
  const [vm, setVm] = useState([])   // vista_ventas_mensual
  const [gm, setGm] = useState([])   // vista_gastos_mensual
  const [anio, setAnio] = useState('2026')
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState('')

  const [cajaG, setCajaG] = useState([])
  useEffect(() => {
    (async () => {
      const [{ data: v, error: e1 }, { data: g, error: e2 }, { data: cg }] = await Promise.all([
        supabase.from('vista_ventas_mensual').select('*'),
        supabase.from('vista_gastos_mensual').select('*'),
        supabase.from('vista_caja_gastos_mensual').select('*'),
      ])
      if (e1 || e2) setErr('Falta correr sql/08_vistas_dashboard.sql en Supabase.')
      setVm(v || []); setGm(g || []); setCajaG(cg || []); setCargando(false)
    })()
  }, [])

  const anios = useMemo(() =>
    [...new Set([...vm, ...gm].map((x) => (x.ym || '').slice(0, 4)))].filter(Boolean).sort().reverse(), [vm, gm])

  const vAnio = useMemo(() => vm.filter((x) => (x.ym || '').startsWith(anio)), [vm, anio])
  const gAnio = useMemo(() => gm.filter((x) => (x.ym || '').startsWith(anio)), [gm, anio])
  const cgAnio = useMemo(() => cajaG.filter((x) => (x.ym || '').startsWith(anio)), [cajaG, anio])

  const ing = vAnio.reduce((a, x) => a + Number(x.monto || 0), 0)
  const egrLedger = gAnio.reduce((a, x) => a + Number(x.monto || 0), 0)
  const egrCaja = cgAnio.reduce((a, x) => a + Number(x.monto || 0), 0)
  const egr = egrLedger + egrCaja
  const tickets = vAnio.reduce((a, x) => a + Number(x.tickets || 0), 0)

  const porMes = useMemo(() => {
    const m = {}
    for (const x of vAnio) (m[x.ym] ??= { ing: 0, egr: 0 }).ing += Number(x.monto || 0)
    for (const x of gAnio) (m[x.ym] ??= { ing: 0, egr: 0 }).egr += Number(x.monto || 0)
    for (const x of cgAnio) (m[x.ym] ??= { ing: 0, egr: 0 }).egr += Number(x.monto || 0)
    return Object.entries(m).sort().map(([ym, val]) => ({ ym, ...val, neto: val.ing - val.egr }))
  }, [vAnio, gAnio, cgAnio])

  const porCat = useMemo(() => {
    const m = {}; for (const x of gAnio) m[x.categoria] = (m[x.categoria] || 0) + Number(x.monto || 0)
    if (egrCaja) m['gastos_caja'] = egrCaja
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [gAnio, egrCaja])

  const maxBar = Math.max(1, ...porMes.map((r) => Math.max(r.ing, r.egr)))
  const ventasIncompletas = anio === '2026' && porMes.filter((r) => r.ing > 0).length < 6

  if (cargando) return <div className="pagina"><h1>📊 Panel</h1><p className="nota">Cargando…</p></div>

  return (
    <div className="pagina">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1>📊 Panel de control</h1>
          <p className="pagina-sub">Hola{perfil?.nombre ? `, ${perfil.nombre}` : ''}. Flujo de dinero — puro números.</p>
        </div>
        <select className="sel-anio" value={anio} onChange={(e) => setAnio(e.target.value)}>
          {anios.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {err && <div className="alerta">{err}</div>}

      <div className="tarjetas">
        <div className="tarjeta"><span className="t-label">Ingresos (ventas)</span><span className="t-valor">{soles(ing)}</span></div>
        <div className="tarjeta"><span className="t-label">Egresos (gastos)</span><span className="t-valor">{soles(egr)}</span></div>
        <div className="tarjeta"><span className="t-label">Saldo</span><span className="t-valor" style={{ color: ing - egr < 0 ? 'var(--rojo)' : '#1a7f37' }}>{soles(ing - egr)}</span></div>
        <div className="tarjeta"><span className="t-label">Tickets {anio}</span><span className="t-valor">{tickets.toLocaleString('es-PE')}</span></div>
      </div>

      {ventasIncompletas && (
        <div className="aviso-config" style={{ maxWidth: 680, margin: '16px 0' }}>
          <span><strong>Ojo:</strong> en 2026 solo están cargadas las ventas de <strong>julio</strong>. Faltan ene–jun 2026 (esos exports aún no se suben), por eso el saldo del año todavía no es real.</span>
        </div>
      )}

      <h2 style={{ fontSize: 18, margin: '18px 0 10px' }}>Flujo por mes — {anio}</h2>
      <table className="tabla">
        <thead><tr><th>Mes</th><th>Ingresos</th><th>Egresos</th><th>Neto</th><th style={{ width: '36%' }}></th></tr></thead>
        <tbody>
          {porMes.map((r) => (
            <tr key={r.ym}>
              <td style={{ whiteSpace: 'nowrap' }}>{MESES[+r.ym.slice(5)]} {r.ym.slice(0, 4)}</td>
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
          ))}
          {porMes.length === 0 && <tr><td colSpan="5" className="nota">Sin datos para {anio}.</td></tr>}
        </tbody>
      </table>

      {porCat.length > 0 && <>
        <h2 style={{ fontSize: 18, margin: '24px 0 10px' }}>Egresos por categoría — {anio}</h2>
        <div className="tarjetas">
          {porCat.map(([c, v]) => (
            <div className="tarjeta" key={c}><span className="t-label">{CAT_LABEL[c] || c}</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(v)}</span></div>
          ))}
        </div>
      </>}
    </div>
  )
}
