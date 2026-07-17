import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Panel independiente de Fernanda: gastos de tienda + adelantos, descuentos y
// bonos por persona, cada uno con su voucher por Yape. Y su consolidado en PDF.
const TIPOS = [
  { k: 'gasto', label: 'Gasto de tienda', persona: false },   // agua, luz, alquiler…
  { k: 'adelanto', label: 'Adelanto', persona: true },
  { k: 'descuento', label: 'Descuento', persona: true },
  { k: 'bono', label: 'Bono', persona: true },
]
const TIPO_LABEL = Object.fromEntries(TIPOS.map((t) => [t.k, t.label]))
const MEDIOS = ['yape', 'efectivo', 'transferencia', 'tarjeta', 'otro']
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoy = () => new Date().toISOString().slice(0, 10)
const mesActual = () => hoy().slice(0, 7)

export default function Pagos() {
  const { perfil } = useAuth()
  const [pagos, setPagos] = useState([])
  const [personas, setPersonas] = useState([])
  const [sedes, setSedes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [fMes, setFMes] = useState(mesActual())
  const [vista, setVista] = useState('registro')   // registro | consolidado

  async function cargar() {
    setCargando(true)
    const [{ data: p }, { data: per }, { data: s }] = await Promise.all([
      supabase.from('pagos_tienda').select('*').order('fecha', { ascending: false }).limit(3000),
      // vista_personal (sin sueldo): Fernanda no puede leer la tabla personas.
      supabase.from('vista_personal').select('id, nombres, apellidos').eq('activo', true).order('nombres'),
      supabase.from('sedes').select('id, nombre').order('nombre'),
    ])
    setPagos(p || []); setPersonas(per || []); setSedes(s || []); setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const nombrePersona = (id) => {
    const x = personas.find((p) => p.id === id)
    return x ? `${x.nombres} ${x.apellidos || ''}`.trim() : '—'
  }
  const meses = useMemo(() =>
    [...new Set([mesActual(), ...pagos.map((x) => (x.fecha || '').slice(0, 7))])].filter(Boolean).sort().reverse(),
    [pagos])
  const delMes = useMemo(() => pagos.filter((x) => (x.fecha || '').startsWith(fMes)), [pagos, fMes])

  async function borrar(x) {
    if (!confirm(`¿Borrar este ${TIPO_LABEL[x.tipo].toLowerCase()} de ${soles(x.monto)}?`)) return
    if (x.voucher_url) await supabase.storage.from('arqueos').remove([x.voucher_url])
    await supabase.from('pagos_tienda').delete().eq('id', x.id)
    setPagos((p) => p.filter((y) => y.id !== x.id))
  }
  async function verVoucher(ruta) {
    const { data } = await supabase.storage.from('arqueos').createSignedUrl(ruta, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="pagina">
      <h1>💸 Pagos y Adelantos</h1>
      <p className="pagina-sub">Gastos de tienda y adelantos/descuentos/bonos por persona, con su voucher.</p>

      <div className="tab-bar no-print">
        <button className={vista === 'registro' ? 'tab activo' : 'tab'} onClick={() => setVista('registro')}>Registrar</button>
        <button className={vista === 'consolidado' ? 'tab activo' : 'tab'} onClick={() => setVista('consolidado')}>Consolidado (PDF)</button>
      </div>

      {vista === 'registro' && (
        <FormPago perfil={perfil} personas={personas} sedes={sedes} onListo={cargar} />
      )}

      <div className="form-inline no-print" style={{ marginTop: 14 }}>
        <label className="campo"><span>Mes</span>
          <select value={fMes} onChange={(e) => setFMes(e.target.value)}>
            {meses.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <span className="nota" style={{ alignSelf: 'flex-end' }}>{delMes.length} movimientos</span>
      </div>

      {cargando ? <p className="nota">Cargando…</p>
        : vista === 'consolidado'
          ? <Consolidado mes={fMes} pagos={delMes} nombrePersona={nombrePersona} />
          : (
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Persona / Concepto</th><th>Monto</th><th>Medio</th><th>Voucher</th><th></th></tr></thead>
              <tbody>
                {delMes.map((x) => (
                  <tr key={x.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                    <td><span className="chip">{TIPO_LABEL[x.tipo]}</span></td>
                    <td>{x.persona_id ? <strong>{nombrePersona(x.persona_id)}</strong> : (x.concepto || '—')}
                      {x.nota ? <span className="chip chip-off" style={{ marginLeft: 6 }}>{x.nota}</span> : null}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{soles(x.monto)}</td>
                    <td>{x.medio_pago}</td>
                    <td>{x.voucher_url ? <button className="btn-mini" onClick={() => verVoucher(x.voucher_url)}>📎 Ver</button> : <span className="nota">—</span>}</td>
                    <td><button className="btn-mini btn-peligro" onClick={() => borrar(x)}>✕</button></td>
                  </tr>
                ))}
                {delMes.length === 0 && <tr><td colSpan="7" className="nota">Nada registrado este mes.</td></tr>}
              </tbody>
            </table>
          )}
    </div>
  )
}

// ---------------------------------------------------------------------
function FormPago({ perfil, personas, sedes, onListo }) {
  const vacio = { fecha: hoy(), tipo: 'gasto', persona_id: '', concepto: '', monto: '', medio_pago: 'yape', sede_id: '', nota: '' }
  const [g, setG] = useState(vacio)
  const [file, setFile] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const pidePersona = TIPOS.find((t) => t.k === g.tipo)?.persona

  async function guardar() {
    if (pidePersona && !g.persona_id) return setError('Elige a quién es el ' + g.tipo + '.')
    if (!pidePersona && !g.concepto.trim()) return setError('Escribe el concepto del gasto (agua, luz…).')
    if (!(Number(g.monto) > 0)) return setError('El monto debe ser mayor a 0.')
    setOcupado(true); setError('')

    let voucher_url = null
    if (file) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const ruta = `pagos/${g.fecha}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const { error: eUp } = await supabase.storage.from('arqueos').upload(ruta, file, { contentType: file.type || undefined })
      if (eUp) { setError('No pude subir el voucher: ' + eUp.message); setOcupado(false); return }
      voucher_url = ruta
    }

    const { error: eIns } = await supabase.from('pagos_tienda').insert({
      fecha: g.fecha, tipo: g.tipo,
      persona_id: pidePersona ? g.persona_id : null,
      concepto: pidePersona ? null : g.concepto.trim().toUpperCase(),
      monto: Number(g.monto), medio_pago: g.medio_pago,
      sede_id: g.sede_id || null, nota: g.nota.trim() || null,
      voucher_url, registrado_por: perfil?.id || null,
    })
    setOcupado(false)
    if (eIns) return setError(eIns.message)
    setG({ ...vacio, tipo: g.tipo, fecha: g.fecha }); setFile(null)
    onListo()
  }

  return (
    <div className="panel-detalle">
      {error && <div className="alerta">{error}</div>}
      <div className="filtros">
        <label className="campo"><span>Tipo</span>
          <select value={g.tipo} onChange={(e) => setG({ ...g, tipo: e.target.value, persona_id: '', concepto: '' })}>
            {TIPOS.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}
          </select></label>
        {pidePersona ? (
          <label className="campo"><span>Persona *</span>
            <select value={g.persona_id} onChange={(e) => setG({ ...g, persona_id: e.target.value })}>
              <option value="">Elige…</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos || ''}</option>)}
            </select></label>
        ) : (
          <label className="campo"><span>Concepto *</span>
            <input value={g.concepto} placeholder="Agua, luz, alquiler…"
              onChange={(e) => setG({ ...g, concepto: e.target.value })} /></label>
        )}
        <label className="campo"><span>Monto (S/) *</span>
          <input type="number" step="0.01" className="in-num" value={g.monto}
            onChange={(e) => setG({ ...g, monto: e.target.value })} /></label>
        <label className="campo"><span>Fecha</span>
          <input type="date" value={g.fecha} onChange={(e) => setG({ ...g, fecha: e.target.value })} /></label>
        <label className="campo"><span>Medio</span>
          <select value={g.medio_pago} onChange={(e) => setG({ ...g, medio_pago: e.target.value })}>
            {MEDIOS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></label>
        <label className="campo"><span>Sede</span>
          <select value={g.sede_id} onChange={(e) => setG({ ...g, sede_id: e.target.value })}>
            <option value="">General</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select></label>
      </div>

      <label className="campo campo-ancho" style={{ marginTop: 10 }}>
        <span>Nota (opcional)</span>
        <input value={g.nota} onChange={(e) => setG({ ...g, nota: e.target.value })} />
      </label>
      <label className="campo" style={{ marginTop: 10 }}>
        <span>Voucher del Yape (foto)</span>
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </label>
      {file && <p className="nota">📎 {file.name}</p>}

      <div className="acciones" style={{ marginTop: 12 }}>
        <button className="btn-guardar" onClick={guardar} disabled={ocupado}>
          {ocupado ? 'Guardando…' : `+ Registrar ${TIPO_LABEL[g.tipo].toLowerCase()}`}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// El consolidado: totales por tipo, y adelantos/descuentos/bonos por persona.
// Se imprime a PDF con el botón (window.print → guardar como PDF).
function Consolidado({ mes, pagos, nombrePersona }) {
  const porTipo = useMemo(() => {
    const m = { gasto: 0, adelanto: 0, descuento: 0, bono: 0 }
    for (const x of pagos) m[x.tipo] = (m[x.tipo] || 0) + Number(x.monto || 0)
    return m
  }, [pagos])

  // Por persona: neto = adelantos + descuentos − bonos (referencia para planilla)
  const porPersona = useMemo(() => {
    const m = {}
    for (const x of pagos) {
      if (!x.persona_id) continue
      m[x.persona_id] = m[x.persona_id] || { adelanto: 0, descuento: 0, bono: 0 }
      m[x.persona_id][x.tipo] += Number(x.monto || 0)
    }
    return Object.entries(m).map(([id, v]) => ({ id, ...v })).sort((a, b) => nombrePersona(a.id).localeCompare(nombrePersona(b.id)))
  }, [pagos, nombrePersona])

  const gastos = pagos.filter((x) => x.tipo === 'gasto')
  const total = Object.values(porTipo).reduce((a, b) => a + b, 0)

  return (
    <div className="consolidado">
      <div className="no-print" style={{ marginBottom: 10 }}>
        <button className="btn-guardar" onClick={() => window.print()}>🖨️ Descargar / Imprimir PDF</button>
      </div>

      <h2>Consolidado de pagos — {mes}</h2>

      <div className="tarjetas" style={{ margin: '12px 0' }}>
        {TIPOS.map((t) => (
          <div className="tarjeta" key={t.k}>
            <span className="t-label">{t.label}s</span>
            <span className="t-valor" style={{ fontSize: 20 }}>{soles(porTipo[t.k])}</span>
          </div>
        ))}
        <div className="tarjeta"><span className="t-label">TOTAL</span><span className="t-valor">{soles(total)}</span></div>
      </div>

      <h3>Gastos de tienda</h3>
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th></tr></thead>
        <tbody>
          {gastos.map((x) => <tr key={x.id}><td>{x.fecha}</td><td>{x.concepto}</td><td>{soles(x.monto)}</td></tr>)}
          {gastos.length === 0 && <tr><td colSpan="3" className="nota">Sin gastos este mes.</td></tr>}
          {gastos.length > 0 && <tr><td colSpan="2"><strong>Total gastos</strong></td><td><strong>{soles(porTipo.gasto)}</strong></td></tr>}
        </tbody>
      </table>

      <h3 style={{ marginTop: 18 }}>Por persona</h3>
      <table className="tabla">
        <thead><tr><th>Persona</th><th>Adelantos</th><th>Descuentos</th><th>Bonos</th></tr></thead>
        <tbody>
          {porPersona.map((p) => (
            <tr key={p.id}>
              <td><strong>{nombrePersona(p.id)}</strong></td>
              <td>{soles(p.adelanto)}</td><td>{soles(p.descuento)}</td><td>{soles(p.bono)}</td>
            </tr>
          ))}
          {porPersona.length === 0 && <tr><td colSpan="4" className="nota">Sin adelantos/descuentos/bonos este mes.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
