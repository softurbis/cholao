import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { puedeEditar, veTodo, puedeGastos } from '../lib/roles'
import Manual from '../components/Manual'

// Módulo GASTOS unificado: gastos de tienda + adelantos/descuentos/bonos por
// persona, todo con su voucher (o marcado "en efectivo, sin comprobante").
//   · Víctor (gerente), Cesar (super) y admin: ven TODO (lo nuevo + el histórico
//     2026, mezclado por fecha) + el consolidado en PDF.
//   · Fernanda (cajera con permiso): solo INGRESA y ve lo que ella registró.
// `voucher`: si ese tipo mueve plata de verdad y por tanto puede tener comprobante.
// Un descuento o un bono son apuntes de planilla, no un pago con voucher: pedirles
// comprobante era un paso vacío que había que saltar todos los días.
const TIPOS = [
  { k: 'gasto', label: 'Gasto de tienda', persona: false, voucher: true },
  { k: 'adelanto', label: 'Adelanto', persona: true, voucher: true },
  { k: 'descuento', label: 'Descuento', persona: true, voucher: false },
  { k: 'bono', label: 'Bono', persona: true, voucher: false },
]
const TIPO_LABEL = Object.fromEntries(TIPOS.map((t) => [t.k, t.label]))
const MEDIOS = ['yape', 'efectivo', 'transferencia', 'tarjeta', 'otro']
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoy = () => new Date().toISOString().slice(0, 10)
const mesActual = () => hoy().slice(0, 7)

export default function Gastos() {
  const { perfil } = useAuth()
  const veTodos = veTodo(perfil)          // Víctor / Cesar / admin
  const registra = puedeGastos(perfil)    // los de arriba + Fernanda

  const [pagos, setPagos] = useState([])       // pagos_tienda (lo nuevo)
  const [ledger, setLedger] = useState([])     // gastos (histórico 2026), solo si veTodos
  const [personas, setPersonas] = useState([])
  const [sedes, setSedes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [fMes, setFMes] = useState(mesActual())
  const [vista, setVista] = useState('lista')   // lista | consolidado

  async function cargar() {
    setCargando(true)
    const consultas = [
      supabase.from('pagos_tienda').select('*').order('fecha', { ascending: false }).limit(4000),
      supabase.from('vista_personal').select('id, nombres, apellidos').eq('activo', true).order('nombres'),
      supabase.from('sedes').select('id, nombre').order('nombre'),
    ]
    // El histórico solo lo cargan quienes ven todo (Fernanda no lo necesita).
    if (veTodos) consultas.push(supabase.from('gastos').select('*').order('fecha', { ascending: false }).limit(4000))
    const [{ data: p }, { data: per }, { data: s }, g] = await Promise.all(consultas)
    setPagos(p || []); setPersonas(per || []); setSedes(s || [])
    setLedger(g?.data || [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const nombrePersona = (id) => {
    const x = personas.find((p) => p.id === id)
    return x ? `${x.nombres} ${x.apellidos || ''}`.trim() : '—'
  }
  const nombreSede = (id) => sedes.find((s) => s.id === id)?.nombre || 'General'

  // Todo en una forma común, mezclado por fecha (lo pediste así).
  const movimientos = useMemo(() => {
    const dePagos = pagos.map((x) => ({
      id: 'p_' + x.id, fuente: 'pago', raw: x, fecha: x.fecha, tipo: x.tipo,
      detalle: x.persona_id ? nombrePersona(x.persona_id) : (x.concepto || '—'),
      monto: Number(x.monto || 0), medio: x.medio_pago, voucher: x.voucher_url, nota: x.nota,
    }))
    const deLedger = ledger.map((x) => ({
      id: 'g_' + x.id, fuente: 'ledger', raw: x, fecha: x.fecha, tipo: 'gasto',
      detalle: x.concepto || '—', categoria: x.categoria,
      monto: Number(x.monto || 0), medio: x.medio_pago, voucher: x.voucher_url, nota: x.nota,
    }))
    return [...dePagos, ...deLedger].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
  }, [pagos, ledger, personas])

  const meses = useMemo(() =>
    [...new Set([mesActual(), ...movimientos.map((x) => (x.fecha || '').slice(0, 7))])].filter(Boolean).sort().reverse(),
    [movimientos])
  const delMes = useMemo(() => movimientos.filter((x) => (x.fecha || '').startsWith(fMes)), [movimientos, fMes])

  async function borrar(m) {
    if (m.fuente !== 'pago') return   // el histórico no se borra desde aquí
    if (!confirm(`¿Borrar este ${TIPO_LABEL[m.tipo]?.toLowerCase() || 'gasto'} de ${soles(m.monto)}?`)) return
    if (m.voucher) await supabase.storage.from('arqueos').remove([m.voucher])
    await supabase.from('pagos_tienda').delete().eq('id', m.raw.id)
    setPagos((p) => p.filter((y) => y.id !== m.raw.id))
  }
  async function verVoucher(ruta) {
    const { data } = await supabase.storage.from('arqueos').createSignedUrl(ruta, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="pagina">
      <h1>📉 Gastos<Manual modulo="gastos" /></h1>
      <p className="pagina-sub">
        Gastos de tienda y adelantos/descuentos/bonos, con su voucher.
        {veTodos ? ' Ves todo el movimiento.' : ' Registras y ves lo que tú anotas.'}
      </p>

      {veTodos && (
        <div className="tab-bar no-print">
          <button className={vista === 'lista' ? 'tab activo' : 'tab'} onClick={() => setVista('lista')}>Movimientos</button>
          <button className={vista === 'consolidado' ? 'tab activo' : 'tab'} onClick={() => setVista('consolidado')}>Consolidado (PDF)</button>
        </div>
      )}

      {registra && vista === 'lista' && (
        <FormGasto perfil={perfil} personas={personas} sedes={sedes} onListo={cargar} />
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
          ? <Consolidado mes={fMes} movimientos={delMes} nombrePersona={nombrePersona} />
          : (
            <table className="tabla tabla-movil">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Persona / Concepto</th><th>Monto</th><th>Medio</th><th>Comprob.</th>{registra && <th></th>}</tr></thead>
              <tbody>
                {delMes.map((m) => (
                  <tr key={m.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{m.fecha}</td>
                    <td><span className="chip">{TIPO_LABEL[m.tipo] || m.tipo}</span>{m.categoria && <span className="chip chip-off" style={{ marginLeft: 4 }}>{m.categoria}</span>}</td>
                    <td>{m.raw.persona_id ? <strong>{m.detalle}</strong> : m.detalle}{m.nota ? <span className="chip chip-off" style={{ marginLeft: 6 }}>{m.nota}</span> : null}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{soles(m.monto)}</td>
                    <td>{m.medio || '—'}</td>
                    <td>{m.voucher
                      ? <button className="btn-mini" onClick={() => verVoucher(m.voucher)}>📎 Ver</button>
                      : <span className="chip chip-off">efectivo</span>}</td>
                    {registra && <td>{m.fuente === 'pago' ? <button className="btn-mini btn-peligro" onClick={() => borrar(m)}>✕</button> : null}</td>}
                  </tr>
                ))}
                {delMes.length === 0 && <tr><td colSpan={registra ? 7 : 6} className="nota">Nada registrado este mes.</td></tr>}
              </tbody>
            </table>
          )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Formulario AL REVÉS: primero el comprobante (o "en efectivo"), luego los datos.
// Pensado para el CELULAR, igual que la pantalla de compras de Juan: la cámara se
// abre directo (capture), los botones miden 44px o más, y lo que se elige entre
// pocas opciones va en pastillas, no en desplegables (en el celular los
// desplegables son el peor control que hay).
// Reusa las clases .ch-* de Compras: son estilos de formulario móvil compartidos.
function FormGasto({ perfil, personas, sedes, onListo }) {
  const vacio = { fecha: hoy(), tipo: 'gasto', persona_id: '', concepto: '', monto: '', medio_pago: 'yape', sede_id: '', nota: '' }
  const [g, setG] = useState(vacio)
  const [file, setFile] = useState(null)
  const [efectivo, setEfectivo] = useState(false)   // sin comprobante
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [masDatos, setMasDatos] = useState(false)   // fecha/sede/nota: casi nunca se tocan
  const tipoDef = TIPOS.find((t) => t.k === g.tipo)
  const pidePersona = tipoDef?.persona
  const necesitaVoucher = !!tipoDef?.voucher
  // Listo para los datos: el tipo no lleva comprobante, o ya hay foto, o se marcó efectivo.
  const paso1 = !necesitaVoucher || !!file || efectivo

  async function guardar() {
    if (pidePersona && !g.persona_id) return setError('Elige a quién es el ' + g.tipo + '.')
    if (!pidePersona && !g.concepto.trim()) return setError('Escribe el concepto del gasto (agua, luz…).')
    if (!(Number(g.monto) > 0)) return setError('El monto debe ser mayor a 0.')
    setOcupado(true); setError('')

    let voucher_url = null
    if (file && !efectivo) {
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
      monto: Number(g.monto),
      // Un descuento o un bono no se "pagan": no llevan medio de pago.
      medio_pago: !necesitaVoucher ? null : (efectivo ? 'efectivo' : g.medio_pago),
      sede_id: g.sede_id || null, nota: g.nota.trim() || null,
      voucher_url, registrado_por: perfil?.id || null,
    })
    setOcupado(false)
    if (eIns) return setError(eIns.message)
    setG({ ...vacio, tipo: g.tipo, fecha: g.fecha }); setFile(null); setEfectivo(false)
    onListo()
  }

  return (
    <div className="panel-detalle ch">
      <h3>➕ Registrar gasto o pago</h3>
      {error && <div className="alerta">{error}</div>}

      {/* El tipo va PRIMERO: de él depende si hace falta comprobante o no. */}
      <label className="ch-lbl">¿Qué es?</label>
      <div className="ch-pills ch-pills-wrap">
        {TIPOS.map((t) => (
          <button type="button" key={t.k} className={g.tipo === t.k ? 'ch-pill act' : 'ch-pill'}
            onClick={() => { setG({ ...g, tipo: t.k, persona_id: '', concepto: '' }); setFile(null); setEfectivo(false) }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* El comprobante solo para lo que mueve plata (gasto y adelanto). Un descuento
          o un bono son apuntes de planilla: pedirles voucher era un paso vacío. */}
      {necesitaVoucher && (!paso1 ? (
        <div className="paso-voucher">
          <label className="ch-foto">
            📎 Subir o tomar el comprobante
            <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <button type="button" className="ch-sec" onClick={() => { setEfectivo(true); setFile(null) }}>
            Sin comprobante — en efectivo
          </button>
        </div>
      ) : (
        <div className="ch-comp ch-comp-ok" style={{ marginTop: 4 }}>
          <div className="ch-info">
            <strong>{efectivo ? 'En efectivo' : 'Con comprobante'}</strong>
            <span className="ch-sub">{efectivo ? 'Se registra sin voucher' : file?.name}</span>
          </div>
          <button type="button" className="ch-btn-comprar" onClick={() => { setFile(null); setEfectivo(false) }}>Cambiar</button>
        </div>
      ))}

      <div style={{ opacity: paso1 ? 1 : .45, pointerEvents: paso1 ? 'auto' : 'none' }}>
        {pidePersona ? (<>
          <label className="ch-lbl">¿A quién?</label>
          <select className="ch-select" value={g.persona_id} onChange={(e) => setG({ ...g, persona_id: e.target.value })}>
            <option value="">Elige la persona…</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos || ''}</option>)}
          </select>
        </>) : (<>
          <label className="ch-lbl">¿De qué?</label>
          <input className="ch-select" value={g.concepto} placeholder="Agua, luz, alquiler…"
            onChange={(e) => setG({ ...g, concepto: e.target.value })} />
        </>)}

        <label className="ch-lbl">Monto</label>
        <input className="ch-precio" inputMode="decimal" placeholder="0.00"
          value={g.monto} onChange={(e) => setG({ ...g, monto: e.target.value })} />

        {necesitaVoucher && !efectivo && (<>
          <label className="ch-lbl">¿Cómo se pagó?</label>
          <div className="ch-pills ch-pills-wrap">
            {MEDIOS.map((m) => (
              <button type="button" key={m} className={g.medio_pago === m ? 'ch-pill act' : 'ch-pill'}
                onClick={() => setG({ ...g, medio_pago: m })}>{m}</button>
            ))}
          </div>
        </>)}

        {/* Fecha, sede y nota casi nunca se cambian: van escondidas para no estorbar. */}
        {!masDatos ? (
          <button type="button" className="ch-sec" onClick={() => setMasDatos(true)}>
            + Cambiar fecha, sede o agregar nota
          </button>
        ) : (<>
          <label className="ch-lbl">Fecha</label>
          <input className="ch-select" type="date" value={g.fecha} onChange={(e) => setG({ ...g, fecha: e.target.value })} />
          <label className="ch-lbl">Sede</label>
          <div className="ch-pills ch-pills-wrap">
            <button type="button" className={!g.sede_id ? 'ch-pill act' : 'ch-pill'} onClick={() => setG({ ...g, sede_id: '' })}>General</button>
            {sedes.map((s) => (
              <button type="button" key={s.id} className={g.sede_id === s.id ? 'ch-pill act' : 'ch-pill'}
                onClick={() => setG({ ...g, sede_id: s.id })}>{s.nombre}</button>
            ))}
          </div>
          <label className="ch-lbl">Nota (opcional)</label>
          <input className="ch-select" value={g.nota} onChange={(e) => setG({ ...g, nota: e.target.value })} />
        </>)}

        <button type="button" className="ch-guardar" onClick={guardar} disabled={ocupado || !paso1}>
          {ocupado ? 'Guardando…' : `Guardar ${TIPO_LABEL[g.tipo].toLowerCase()}${Number(g.monto) > 0 ? ` · ${soles(g.monto)}` : ''}`}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
function Consolidado({ mes, movimientos, nombrePersona }) {
  const porTipo = useMemo(() => {
    const m = { gasto: 0, adelanto: 0, descuento: 0, bono: 0 }
    for (const x of movimientos) m[x.tipo] = (m[x.tipo] || 0) + x.monto
    return m
  }, [movimientos])
  const porPersona = useMemo(() => {
    const m = {}
    for (const x of movimientos) {
      if (!x.raw.persona_id) continue
      m[x.raw.persona_id] = m[x.raw.persona_id] || { adelanto: 0, descuento: 0, bono: 0 }
      m[x.raw.persona_id][x.tipo] += x.monto
    }
    return Object.entries(m).map(([id, v]) => ({ id, ...v })).sort((a, b) => nombrePersona(a.id).localeCompare(nombrePersona(b.id)))
  }, [movimientos, nombrePersona])
  const gastos = movimientos.filter((x) => x.tipo === 'gasto')
  const total = Object.values(porTipo).reduce((a, b) => a + b, 0)

  return (
    <div className="consolidado">
      <div className="no-print" style={{ marginBottom: 10 }}>
        <button className="btn-guardar" onClick={() => window.print()}>🖨️ Descargar / Imprimir PDF</button>
      </div>
      <h2>Consolidado de gastos y pagos — {mes}</h2>
      <div className="tarjetas" style={{ margin: '12px 0' }}>
        {TIPOS.map((t) => (
          <div className="tarjeta" key={t.k}><span className="t-label">{t.label}s</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(porTipo[t.k])}</span></div>
        ))}
        <div className="tarjeta"><span className="t-label">TOTAL</span><span className="t-valor">{soles(total)}</span></div>
      </div>

      <h3>Gastos de tienda</h3>
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th></tr></thead>
        <tbody>
          {gastos.map((x) => <tr key={x.id}><td>{x.fecha}</td><td>{x.detalle}</td><td>{soles(x.monto)}</td></tr>)}
          {gastos.length === 0 && <tr><td colSpan="3" className="nota">Sin gastos este mes.</td></tr>}
          {gastos.length > 0 && <tr><td colSpan="2"><strong>Total gastos</strong></td><td><strong>{soles(porTipo.gasto)}</strong></td></tr>}
        </tbody>
      </table>

      <h3 style={{ marginTop: 18 }}>Por persona</h3>
      <table className="tabla">
        <thead><tr><th>Persona</th><th>Adelantos</th><th>Descuentos</th><th>Bonos</th></tr></thead>
        <tbody>
          {porPersona.map((p) => (
            <tr key={p.id}><td><strong>{nombrePersona(p.id)}</strong></td><td>{soles(p.adelanto)}</td><td>{soles(p.descuento)}</td><td>{soles(p.bono)}</td></tr>
          ))}
          {porPersona.length === 0 && <tr><td colSpan="4" className="nota">Sin adelantos/descuentos/bonos este mes.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
