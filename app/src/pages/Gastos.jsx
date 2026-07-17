import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { puedeEditar, puedeGastos } from '../lib/roles'

const CATEGORIAS = ['compras', 'planilla', 'admin_gerencial', 'deuda_retiro', 'operativo']
const CAT_LABEL = {
  compras: 'Compras/insumos', planilla: 'Planilla', admin_gerencial: 'Admin/gerencial',
  deuda_retiro: 'Deuda/retiro', operativo: 'Operativo',
}
const MEDIOS = ['efectivo', 'yape', 'transferencia', 'tarjeta', 'otro']
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoy = () => new Date().toISOString().slice(0, 10)

export default function Gastos() {
  const { perfil } = useAuth()
  const editor = puedeEditar(perfil)         // reclasificar / corregir
  const registra = puedeGastos(perfil)       // subir un gasto nuevo (incl. Fernanda)

  const [gastos, setGastos] = useState([])
  const [sedes, setSedes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [fMes, setFMes] = useState('')
  const [fCat, setFCat] = useState('')
  const [abrirForm, setAbrirForm] = useState(false)

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
  const nombreSede = (id) => sedes.find((s) => s.id === id)?.nombre || 'General'

  async function actualizar(id, campo, valor) {
    setGastos((prev) => prev.map((x) => (x.id === id ? { ...x, [campo]: valor } : x)))
    await supabase.from('gastos').update({ [campo]: valor || null }).eq('id', id)
  }

  // Abre el voucher (bucket privado → hace falta un link firmado temporal)
  async function verVoucher(ruta) {
    const { data } = await supabase.storage.from('arqueos').createSignedUrl(ruta, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="pagina">
      <h1>📉 Gastos</h1>
      <p className="pagina-sub">
        Egresos de la tienda. {registra ? 'Registra un gasto nuevo con su voucher, o' : 'Aquí se'} ve el detalle
        {editor ? ' y se reclasifica la categoría o la sede.' : '.'}
      </p>

      <div className="tarjetas" style={{ marginBottom: 18 }}>
        <div className="tarjeta"><span className="t-label">Total {fMes || '2026'}</span><span className="t-valor">{soles(total)}</span></div>
        {CATEGORIAS.filter((c) => porCat[c]).map((c) => (
          <div className="tarjeta" key={c}><span className="t-label">{CAT_LABEL[c]}</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(porCat[c])}</span></div>
        ))}
      </div>

      {registra && (
        abrirForm
          ? <FormGasto perfil={perfil} sedes={sedes} onListo={() => { setAbrirForm(false); cargar() }} onCancelar={() => setAbrirForm(false)} />
          : <button className="btn-guardar" style={{ marginBottom: 14 }} onClick={() => setAbrirForm(true)}>+ Registrar gasto</button>
      )}

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
          <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Categoría</th><th>Sede</th><th>Voucher</th></tr></thead>
          <tbody>
            {filtrados.map((x) => (
              <tr key={x.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td>{x.concepto}{x.nota ? <span className="chip chip-off" style={{ marginLeft: 6 }}>{x.nota}</span> : null}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{soles(x.monto)}</td>
                <td>
                  {editor ? (
                    <select value={x.categoria || ''} onChange={(e) => actualizar(x.id, 'categoria', e.target.value)}>
                      {CATEGORIAS.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                    </select>
                  ) : (CAT_LABEL[x.categoria] || x.categoria || '—')}
                </td>
                <td>
                  {editor ? (
                    <select value={x.sede_id || ''} onChange={(e) => actualizar(x.id, 'sede_id', e.target.value)}>
                      <option value="">General</option>
                      {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                  ) : nombreSede(x.sede_id)}
                </td>
                <td>
                  {x.voucher_url
                    ? <button className="btn-mini" onClick={() => verVoucher(x.voucher_url)}>📎 Ver</button>
                    : <span className="nota">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
function FormGasto({ perfil, sedes, onListo, onCancelar }) {
  const [g, setG] = useState({
    fecha: hoy(), concepto: '', monto: '', categoria: 'operativo',
    sede_id: '', medio_pago: 'yape', nota: '',
  })
  const [file, setFile] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    if (!g.concepto.trim()) return setError('Falta el concepto (en qué se gastó).')
    if (!(Number(g.monto) > 0)) return setError('El monto debe ser mayor a 0.')
    setOcupado(true); setError('')

    // Sube el voucher primero (si hay). Bucket privado 'arqueos', prefijo gastos/.
    let voucher_url = null
    if (file) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const ruta = `gastos/${g.fecha}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const { error: eUp } = await supabase.storage.from('arqueos').upload(ruta, file, { contentType: file.type || undefined })
      if (eUp) { setError('No pude subir el voucher: ' + eUp.message); setOcupado(false); return }
      voucher_url = ruta
    }

    const { error: eIns } = await supabase.from('gastos').insert({
      fecha: g.fecha,
      concepto: g.concepto.trim().toUpperCase(),
      monto: Number(g.monto),
      categoria: g.categoria,
      sede_id: g.sede_id || null,
      medio_pago: g.medio_pago,
      nota: g.nota.trim() || null,
      voucher_url,
      creado_por: perfil?.id || null,
    })
    setOcupado(false)
    if (eIns) return setError(eIns.message)
    onListo()
  }

  return (
    <div className="panel-detalle">
      <h3>➕ Registrar gasto</h3>
      {error && <div className="alerta">{error}</div>}
      <div className="filtros">
        <label className="campo"><span>Fecha</span>
          <input type="date" value={g.fecha} onChange={(e) => setG({ ...g, fecha: e.target.value })} /></label>
        <label className="campo"><span>Concepto *</span>
          <input value={g.concepto} placeholder="Agua, luz, alquiler…"
            onChange={(e) => setG({ ...g, concepto: e.target.value })} autoFocus /></label>
        <label className="campo"><span>Monto (S/) *</span>
          <input type="number" step="0.01" className="in-num" value={g.monto}
            onChange={(e) => setG({ ...g, monto: e.target.value })} /></label>
        <label className="campo"><span>Categoría</span>
          <select value={g.categoria} onChange={(e) => setG({ ...g, categoria: e.target.value })}>
            {CATEGORIAS.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select></label>
        <label className="campo"><span>Sede</span>
          <select value={g.sede_id} onChange={(e) => setG({ ...g, sede_id: e.target.value })}>
            <option value="">General</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select></label>
        <label className="campo"><span>Medio de pago</span>
          <select value={g.medio_pago} onChange={(e) => setG({ ...g, medio_pago: e.target.value })}>
            {MEDIOS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></label>
      </div>

      <label className="campo campo-ancho" style={{ marginTop: 10 }}>
        <span>Descripción (opcional)</span>
        <input value={g.nota} placeholder="Detalle del gasto"
          onChange={(e) => setG({ ...g, nota: e.target.value })} />
      </label>

      <label className="campo" style={{ marginTop: 10 }}>
        <span>Voucher (foto del comprobante)</span>
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </label>
      {file && <p className="nota">📎 {file.name}</p>}

      <div className="acciones" style={{ marginTop: 12 }}>
        <button className="btn-guardar" onClick={guardar} disabled={ocupado}>
          {ocupado ? 'Guardando…' : 'Guardar gasto'}
        </button>
        <button className="btn-mini" onClick={onCancelar} disabled={ocupado}>Cancelar</button>
      </div>
    </div>
  )
}
