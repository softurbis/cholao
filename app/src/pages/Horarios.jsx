import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { puedeEditar, veTodo } from '../lib/roles'
import Manual from '../components/Manual'

// Programación de horarios por persona y sede.
//
// Se programa por FECHA (una fila = una persona, un día) y no con una plantilla
// semanal fija: los turnos rotan y con fechas la rotación sale sola. Para no
// re-teclear todo cada semana está "copiar la semana anterior".
//
// ⚠️ Los bonos y las horas extra se ponen A MANO en Gastos. Aquí no se liquida
// nada ni se cruza con la asistencia: esto programa y da la referencia de pago.
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const suma = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return fmt(d) }
// El lunes de la semana de esa fecha (con domingo = fin de semana, no inicio).
function lunesDe(iso) {
  const d = new Date(iso + 'T12:00:00')
  const dow = (d.getDay() + 6) % 7   // 0 = lunes
  d.setDate(d.getDate() - dow)
  return fmt(d)
}
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hhmm = (t) => (t || '').slice(0, 5)
const diaCorto = (iso) => new Date(iso + 'T12:00:00').getDate()

// Turnos típicos, para no escribir la hora cada vez.
const PRESETS = [
  { l: 'Full', ini: '09:00', fin: '19:00' },
  { l: 'Mañana', ini: '08:00', fin: '15:00' },
  { l: 'Tarde', ini: '14:00', fin: '22:00' },
]

export default function Horarios() {
  const { perfil } = useAuth()
  const programa = puedeEditar(perfil)     // super y admin programan
  const veTodos = veTodo(perfil)           // + gerencia mira
  const [vista, setVista] = useState(programa || veTodos ? 'programar' : 'mio')

  return (
    <div className="pagina">
      <h1>📅 Horarios<Manual modulo="horarios" /></h1>
      {(programa || veTodos) && (
        <div className="tab-bar">
          <button className={vista === 'programar' ? 'tab activo' : 'tab'} onClick={() => setVista('programar')}>Programación</button>
          <button className={vista === 'mio' ? 'tab activo' : 'tab'} onClick={() => setVista('mio')}>Mi horario</button>
        </div>
      )}
      {vista === 'programar' && (programa || veTodos)
        ? <Programar perfil={perfil} puedeProgramar={programa} />
        : <MiHorario perfil={perfil} />}
    </div>
  )
}

// ---------------------------------------------------------------------
function Programar({ perfil, puedeProgramar }) {
  const [lunes, setLunes] = useState(lunesDe(fmt(new Date())))
  const [sedes, setSedes] = useState([])
  const [sedeSel, setSedeSel] = useState('')
  const [personas, setPersonas] = useState([])
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [abierto, setAbierto] = useState(null)     // día al que se le está agregando gente
  const [nuevo, setNuevo] = useState({ persona_id: '', hora_inicio: '09:00', hora_fin: '19:00' })
  const [msg, setMsg] = useState('')

  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => suma(lunes, i)), [lunes])

  async function cargar() {
    setCargando(true); setMsg('')
    const [{ data: s }, { data: p }, { data: h }] = await Promise.all([
      supabase.from('sedes').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('personas').select('id, nombres, apellidos, pago_hora, activo').eq('activo', true).order('nombres'),
      supabase.from('vista_horarios').select('*').gte('fecha', lunes).lte('fecha', suma(lunes, 6)),
    ])
    setSedes(s || []); setPersonas(p || []); setFilas(h || [])
    if (!sedeSel && (s || []).length) setSedeSel(s[0].id)
    setCargando(false)
  }
  useEffect(() => { cargar() }, [lunes])   // eslint-disable-line react-hooks/exhaustive-deps

  const deSede = useMemo(() => filas.filter((f) => !sedeSel || f.sede_id === sedeSel), [filas, sedeSel])
  const porDia = (d) => deSede.filter((f) => f.fecha === d).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))

  // Cuánto le toca a cada quien esa semana: la referencia para las horas extra.
  const porPersona = useMemo(() => {
    const m = {}
    for (const f of deSede) {
      m[f.persona_id] = m[f.persona_id] || { persona: f.persona, horas: 0, pago_hora: f.pago_hora }
      m[f.persona_id].horas += Number(f.horas || 0)
    }
    return Object.values(m).sort((a, b) => b.horas - a.horas)
  }, [deSede])

  async function agregar(fecha) {
    if (!nuevo.persona_id) return setMsg('Elige a la persona.')
    if (!nuevo.hora_inicio || !nuevo.hora_fin) return setMsg('Faltan las horas.')
    const { error } = await supabase.from('horarios_programados').insert({
      persona_id: nuevo.persona_id, sede_id: sedeSel || null, fecha,
      hora_inicio: nuevo.hora_inicio, hora_fin: nuevo.hora_fin, creado_por: perfil?.id || null,
    })
    if (error) return setMsg(/duplicate|unique/i.test(error.message)
      ? 'Esa persona ya tiene un bloque que empieza a esa hora ese día.' : error.message)
    setNuevo({ ...nuevo, persona_id: '' }); setMsg(''); cargar()
  }
  async function quitar(id) {
    await supabase.from('horarios_programados').delete().eq('id', id); cargar()
  }

  // Copiar la semana anterior: lo que hace usable la programación rotativa.
  async function copiarSemanaAnterior() {
    const iniPrev = suma(lunes, -7)
    const { data } = await supabase.from('horarios_programados').select('*')
      .gte('fecha', iniPrev).lte('fecha', suma(iniPrev, 6))
    const previas = (data || []).filter((x) => !sedeSel || x.sede_id === sedeSel)
    if (!previas.length) return setMsg('La semana anterior no tiene nada programado en esta sede.')
    // No duplicar lo que ya esté puesto en esta semana.
    const yaHay = new Set(deSede.map((f) => `${f.persona_id}|${f.fecha}|${f.hora_inicio}`))
    const nuevas = previas
      .map((x) => ({
        persona_id: x.persona_id, sede_id: x.sede_id, fecha: suma(x.fecha, 7),
        hora_inicio: x.hora_inicio, hora_fin: x.hora_fin, creado_por: perfil?.id || null,
      }))
      .filter((x) => !yaHay.has(`${x.persona_id}|${x.fecha}|${x.hora_inicio}`))
    if (!nuevas.length) return setMsg('Esta semana ya tiene todo lo de la anterior.')
    const { error } = await supabase.from('horarios_programados').insert(nuevas)
    if (error) return setMsg(error.message)
    setMsg(`Se copiaron ${nuevas.length} turnos de la semana anterior.`); cargar()
  }

  if (cargando) return <p className="nota">Cargando…</p>

  return (
    <div>
      <p className="pagina-sub">Quién trabaja cada día en cada sede. Las horas de aquí son la referencia para pagar horas extra; el pago se registra a mano en Gastos.</p>

      <div className="form-inline">
        <button className="btn-mini" onClick={() => setLunes(suma(lunes, -7))}>← Semana anterior</button>
        <span style={{ alignSelf: 'center', fontWeight: 700 }}>
          {diaCorto(lunes)} al {diaCorto(suma(lunes, 6))} · {new Date(lunes + 'T12:00:00').toLocaleDateString('es-PE', { month: 'long', year: 'numeric' })}
        </span>
        <button className="btn-mini" onClick={() => setLunes(suma(lunes, 7))}>Semana siguiente →</button>
        <button className="btn-mini" onClick={() => setLunes(lunesDe(fmt(new Date())))}>Hoy</button>
      </div>

      <div className="ch-pills ch-pills-wrap" style={{ marginBottom: 12 }}>
        {sedes.map((s) => (
          <button key={s.id} className={sedeSel === s.id ? 'ch-pill act' : 'ch-pill'} onClick={() => setSedeSel(s.id)}>{s.nombre}</button>
        ))}
      </div>

      {puedeProgramar && (
        <div className="form-inline">
          <button className="btn-mini" onClick={copiarSemanaAnterior}>⧉ Copiar la semana anterior</button>
        </div>
      )}
      {msg && <div className="alerta">{msg}</div>}

      <div className="hor-semana">
        {dias.map((d, i) => {
          const gente = porDia(d)
          const esHoy = d === fmt(new Date())
          return (
            <div key={d} className={esHoy ? 'hor-dia hoy' : 'hor-dia'}>
              <div className="hor-dia-cab">
                <strong>{DIAS[i]} {diaCorto(d)}</strong>
                <span className="nota">{gente.length} {gente.length === 1 ? 'persona' : 'personas'}</span>
              </div>
              {gente.map((f) => (
                <div key={f.id} className="hor-turno">
                  <span className="hor-nombre">{f.persona}</span>
                  <span className="hor-horas">{hhmm(f.hora_inicio)}–{hhmm(f.hora_fin)} <span className="nota">{f.horas}h</span></span>
                  {puedeProgramar && <button className="btn-mini btn-peligro" onClick={() => quitar(f.id)}>✕</button>}
                </div>
              ))}
              {gente.length === 0 && <p className="nota" style={{ margin: '4px 0' }}>Nadie programado.</p>}

              {puedeProgramar && (abierto === d ? (
                <div className="hor-alta">
                  <select value={nuevo.persona_id} onChange={(e) => setNuevo({ ...nuevo, persona_id: e.target.value })}>
                    <option value="">¿Quién?</option>
                    {personas.map((p) => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos || ''}</option>)}
                  </select>
                  <div className="ch-pills ch-pills-wrap" style={{ margin: '6px 0' }}>
                    {PRESETS.map((t) => (
                      <button key={t.l} className={nuevo.hora_inicio === t.ini && nuevo.hora_fin === t.fin ? 'ch-pill act' : 'ch-pill'}
                        onClick={() => setNuevo({ ...nuevo, hora_inicio: t.ini, hora_fin: t.fin })}>{t.l}</button>
                    ))}
                  </div>
                  <div className="form-inline" style={{ marginBottom: 0 }}>
                    <input type="time" value={nuevo.hora_inicio} onChange={(e) => setNuevo({ ...nuevo, hora_inicio: e.target.value })} />
                    <input type="time" value={nuevo.hora_fin} onChange={(e) => setNuevo({ ...nuevo, hora_fin: e.target.value })} />
                    <button onClick={() => agregar(d)}>Agregar</button>
                    <button className="btn-mini" onClick={() => setAbierto(null)}>Cerrar</button>
                  </div>
                </div>
              ) : (
                <button className="btn-mini hor-mas" onClick={() => { setAbierto(d); setMsg('') }}>+ Agregar</button>
              ))}
            </div>
          )
        })}
      </div>

      <div className="panel-detalle">
        <h3>Horas de la semana</h3>
        <p className="nota">Referencia para calcular una hora extra. El bono o la hora extra se registra a mano en Gastos: aquí no se liquida nada.</p>
        <table className="tabla tabla-movil">
          <thead><tr><th>Persona</th><th>Horas</th><th>Pago x hora</th><th>Equivale a</th></tr></thead>
          <tbody>
            {porPersona.map((p) => (
              <tr key={p.persona}>
                <td><strong>{p.persona}</strong></td>
                <td>{p.horas.toFixed(1)} h</td>
                <td>{p.pago_hora ? soles(p.pago_hora) : <span className="nota">sin definir</span>}</td>
                <td>{p.pago_hora ? soles(p.horas * Number(p.pago_hora)) : '—'}</td>
              </tr>
            ))}
            {porPersona.length === 0 && <tr><td colSpan="4" className="nota">Sin nadie programado esta semana en esta sede.</td></tr>}
          </tbody>
        </table>
        <p className="nota">El pago por hora se define en Personas.</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Lo que ve cada quien de lo suyo, desde el celular.
function MiHorario({ perfil }) {
  const [lunes, setLunes] = useState(lunesDe(fmt(new Date())))
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => suma(lunes, i)), [lunes])

  useEffect(() => {
    (async () => {
      setCargando(true)
      // La policy `horarios_mio` ya filtra por la persona del login: no hace falta
      // (ni conviene) mandar el persona_id desde el navegador.
      const { data } = await supabase.from('vista_horarios').select('*')
        .gte('fecha', lunes).lte('fecha', suma(lunes, 6))
      setFilas(data || []); setCargando(false)
    })()
  }, [lunes])

  const mias = useMemo(() => filas.filter((f) => !perfil?.persona_id || f.persona_id === perfil.persona_id), [filas, perfil])
  const total = mias.reduce((a, f) => a + Number(f.horas || 0), 0)

  if (cargando) return <p className="nota">Cargando…</p>

  return (
    <div className="ch">
      <div className="form-inline">
        <button className="btn-mini" onClick={() => setLunes(suma(lunes, -7))}>←</button>
        <span style={{ alignSelf: 'center', fontWeight: 700, flex: 1, textAlign: 'center' }}>
          {diaCorto(lunes)} al {diaCorto(suma(lunes, 6))} de {new Date(lunes + 'T12:00:00').toLocaleDateString('es-PE', { month: 'long' })}
        </span>
        <button className="btn-mini" onClick={() => setLunes(suma(lunes, 7))}>→</button>
      </div>

      {!perfil?.persona_id && (
        <div className="alerta">Tu usuario todavía no está enlazado a tu ficha de personal. Avísale al administrador.</div>
      )}

      {dias.map((d, i) => {
        const hoy = d === fmt(new Date())
        const bloques = mias.filter((f) => f.fecha === d)
        return (
          <div key={d} className={hoy ? 'ch-fila ch-abierta' : 'ch-fila'}>
            <div className="ch-cab" style={{ cursor: 'default' }}>
              <div className="ch-info">
                <strong>{DIAS[i]} {diaCorto(d)}{hoy ? ' · hoy' : ''}</strong>
                {bloques.length === 0
                  ? <span className="ch-sub">Descansas</span>
                  : bloques.map((f) => (
                    <span key={f.id} className="ch-sub ch-ok">
                      {hhmm(f.hora_inicio)} a {hhmm(f.hora_fin)} · {f.sede || 'sin sede'} · {f.horas}h
                    </span>
                  ))}
              </div>
            </div>
          </div>
        )
      })}

      <div className="asis-hoy" style={{ marginTop: 12 }}>
        <div className="asis-marca">
          <span className="asis-lbl">Total de la semana</span>
          <strong>{total.toFixed(1)} h</strong>
        </div>
      </div>
    </div>
  )
}
