import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { esSuper } from '../lib/roles'

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
// El código es lo que se guarda en caja_turno.turno; el nombre es lo que se lee.
// Se ofrecen los que ya existen en el histórico para no inventar códigos nuevos
// que dejarían los turnos viejos huérfanos.
const CODIGOS = [
  { codigo: 'unico', nombre: 'Único' },
  { codigo: 'manana', nombre: 'Mañana' },
  { codigo: 'tarde', nombre: 'Tarde' },
  { codigo: 'noche', nombre: 'Noche' },
]
const hhmm = (t) => (t ? String(t).slice(0, 5) : '')

export default function Sedes() {
  const { perfil } = useAuth()
  // Sedes es solo del superusuario (config del sistema). Aun así se gatea por si
  // se abre la ruta a mano.
  const puedeEditar = esSuper(perfil)
  const [sedes, setSedes] = useState([])
  const [turnos, setTurnos] = useState([])
  const [horario, setHorario] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ nombre: '', direccion: '', telefono: '' })
  const [guardando, setGuardando] = useState(false)
  const [abierta, setAbierta] = useState(null)   // sede cuyo horario se está viendo

  async function cargar() {
    setCargando(true)
    const [{ data: s, error: e1 }, { data: t }, { data: h }] = await Promise.all([
      supabase.from('sedes').select('*').order('nombre'),
      supabase.from('sede_turnos').select('*').order('orden'),
      supabase.from('sede_horario').select('*'),
    ])
    if (e1) setError(e1.message)
    else setSedes(s || [])
    setTurnos(t || []); setHorario(h || [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const turnosDe = (sedeId) => turnos.filter((t) => t.sede_id === sedeId).sort((a, b) => a.orden - b.orden)

  async function agregar(e) {
    e.preventDefault()
    if (!form.nombre.trim()) return
    setGuardando(true); setError('')
    const { error } = await supabase.from('sedes').insert({
      nombre: form.nombre.trim(),
      direccion: form.direccion.trim() || null,
      telefono: form.telefono.trim() || null,
    })
    setGuardando(false)
    if (error) setError(error.message)
    else { setForm({ nombre: '', direccion: '', telefono: '' }); cargar() }
  }

  async function toggleActivo(sede) {
    const { error } = await supabase.from('sedes').update({ activo: !sede.activo }).eq('id', sede.id)
    if (error) setError(error.message); else cargar()
  }

  async function borrar(sede) {
    if (!confirm(`¿Borrar la sede "${sede.nombre}"? Solo se puede si no tiene datos asociados.`)) return
    setError('')
    const { error } = await supabase.from('sedes').delete().eq('id', sede.id)
    if (error) {
      setError(
        error.message.includes('foreign key') || error.code === '23503'
          ? `No se puede borrar "${sede.nombre}": tiene ventas/caja u otros datos. Puedes desactivarla en su lugar.`
          : error.message
      )
    } else cargar()
  }

  return (
    <div className="pagina">
      <h1>🏪 Sedes</h1>
      <p className="pagina-sub">Los locales de El Cholao, sus turnos y su horario.</p>

      {error && <div className="alerta">{error}</div>}

      {puedeEditar && (
        <form className="form-inline" onSubmit={agregar}>
          <input placeholder="Nombre *" value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
          <input placeholder="Dirección" value={form.direccion}
            onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
          <input placeholder="Teléfono" value={form.telefono}
            onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
          <button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : '+ Añadir sede'}</button>
        </form>
      )}

      {cargando ? <p className="nota">Cargando…</p> : (
        <table className="tabla">
          <thead>
            <tr><th>Sede</th><th>Dirección</th><th>Teléfono</th><th>Turnos</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {sedes.map((s) => {
              const ts = turnosDe(s.id).filter((t) => t.activo)
              return (
                <tr key={s.id} className={s.activo ? '' : 'fila-inactiva'}>
                  <td><strong>{s.nombre}</strong></td>
                  <td>{s.direccion || '—'}</td>
                  <td>{s.telefono || '—'}</td>
                  <td>
                    {ts.length
                      ? ts.map((t) => <span key={t.id} className="chip" style={{ marginRight: 4 }}>{t.nombre}</span>)
                      : <span className="nota">sin turnos</span>}
                  </td>
                  <td>
                    <span className={`chip ${s.activo ? 'chip-ok' : 'chip-off'}`}>
                      {s.activo ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="acciones">
                    <button className="btn-mini" onClick={() => setAbierta(abierta === s.id ? null : s.id)}>
                      {abierta === s.id ? 'Cerrar' : '🕒 Turnos y horario'}
                    </button>
                    {puedeEditar && <button className="btn-mini" onClick={() => toggleActivo(s)}>
                      {s.activo ? 'Desactivar' : 'Activar'}
                    </button>}
                    {puedeEditar && <button className="btn-mini btn-peligro" onClick={() => borrar(s)}>Borrar</button>}
                  </td>
                </tr>
              )
            })}
            {sedes.length === 0 && (
              <tr><td colSpan="6" className="nota">Sin sedes. Añade la primera arriba.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {abierta && (
        <PanelSede
          sede={sedes.find((s) => s.id === abierta)}
          turnos={turnosDe(abierta)}
          horario={horario.filter((h) => h.sede_id === abierta)}
          puedeEditar={puedeEditar}
          onCambio={cargar}
          onError={setError}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
function PanelSede({ sede, turnos, horario, puedeEditar, onCambio, onError }) {
  const [nuevo, setNuevo] = useState({ codigo: 'unico', hora_inicio: '', hora_fin: '' })
  const activos = useMemo(() => turnos.filter((t) => t.activo), [turnos])
  const historicos = useMemo(() => turnos.filter((t) => !t.activo), [turnos])

  const celda = (turnoId, dia) => horario.find((h) => h.turno_id === turnoId && h.dia_semana === dia)

  async function addTurno() {
    if (turnos.some((t) => t.codigo === nuevo.codigo && t.activo)) {
      return onError(`"${sede.nombre}" ya tiene un turno ${nuevo.codigo}.`)
    }
    const def = CODIGOS.find((c) => c.codigo === nuevo.codigo)
    // Si el turno existió antes (quedó inactivo por histórico), se REACTIVA en
    // vez de crear otro: el unique(sede_id,codigo) lo impediría, y además así
    // los turnos viejos se reenganchan solos.
    const previo = turnos.find((t) => t.codigo === nuevo.codigo)
    const campos = {
      nombre: def.nombre, orden: activos.length + 1, activo: true,
      hora_inicio: nuevo.hora_inicio || null, hora_fin: nuevo.hora_fin || null,
    }
    const { data, error } = previo
      ? await supabase.from('sede_turnos').update(campos).eq('id', previo.id).select().single()
      : await supabase.from('sede_turnos').insert({ sede_id: sede.id, codigo: nuevo.codigo, ...campos }).select().single()
    if (error) return onError(error.message)

    // Un turno sin horario no se ve en la tabla de abajo: se le siembran los 7 días.
    const filas = [...Array(7).keys()].map((d) => ({
      sede_id: sede.id, dia_semana: d, turno_id: data.id,
      abre: nuevo.hora_inicio || null, cierra: nuevo.hora_fin || null, cerrado: false,
    }))
    await supabase.from('sede_horario').upsert(filas, { onConflict: 'sede_id,dia_semana,turno_id' })
    setNuevo({ codigo: 'unico', hora_inicio: '', hora_fin: '' })
    onCambio()
  }

  async function quitarTurno(t) {
    if (!confirm(`¿Quitar el turno "${t.nombre}" de ${sede.nombre}?\n\nNo se borra: queda como histórico para que los turnos ya registrados con él se sigan leyendo. Solo deja de poder elegirse.`)) return
    const { error } = await supabase.from('sede_turnos').update({ activo: false }).eq('id', t.id)
    if (error) onError(error.message); else onCambio()
  }

  async function setHora(turnoId, dia, campo, valor) {
    const fila = celda(turnoId, dia)
    const v = valor || null
    const { error } = fila
      ? await supabase.from('sede_horario').update({ [campo]: v }).eq('id', fila.id)
      : await supabase.from('sede_horario').insert({ sede_id: sede.id, dia_semana: dia, turno_id: turnoId, [campo]: v })
    if (error) onError(error.message); else onCambio()
  }

  async function toggleCerrado(turnoId, dia) {
    const fila = celda(turnoId, dia)
    const { error } = fila
      ? await supabase.from('sede_horario').update({ cerrado: !fila.cerrado }).eq('id', fila.id)
      : await supabase.from('sede_horario').insert({ sede_id: sede.id, dia_semana: dia, turno_id: turnoId, cerrado: true })
    if (error) onError(error.message); else onCambio()
  }

  return (
    <div className="panel-detalle">
      <h3>🕒 {sede.nombre} — turnos y horario</h3>

      <h4 className="sub-titulo">Turnos que trabaja</h4>
      <p className="nota">
        Cuántas veces se cuadra la caja al día. Amazonas trabaja mañana y tarde; Miraflores, uno solo.
      </p>

      <table className="tabla">
        <thead><tr><th>Turno</th><th>Orden</th><th>Entra</th><th>Sale</th><th></th></tr></thead>
        <tbody>
          {activos.map((t) => (
            <tr key={t.id}>
              <td><strong>{t.nombre}</strong> <span className="nota">({t.codigo})</span></td>
              <td>{t.orden}º</td>
              <td>
                <input type="time" defaultValue={hhmm(t.hora_inicio)} disabled={!puedeEditar}
                  onBlur={async (e) => {
                    await supabase.from('sede_turnos').update({ hora_inicio: e.target.value || null }).eq('id', t.id)
                    onCambio()
                  }} />
              </td>
              <td>
                <input type="time" defaultValue={hhmm(t.hora_fin)} disabled={!puedeEditar}
                  onBlur={async (e) => {
                    await supabase.from('sede_turnos').update({ hora_fin: e.target.value || null }).eq('id', t.id)
                    onCambio()
                  }} />
              </td>
              <td className="acciones">
                {puedeEditar && <button className="btn-mini btn-peligro" onClick={() => quitarTurno(t)}>Quitar</button>}
              </td>
            </tr>
          ))}
          {!activos.length && <tr><td colSpan="5" className="nota">Sin turnos activos: esta sede no puede registrar caja.</td></tr>}
        </tbody>
      </table>

      {puedeEditar && (
        <div className="form-inline" style={{ marginTop: 10 }}>
          <select value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })}>
            {CODIGOS.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
          </select>
          <input type="time" value={nuevo.hora_inicio} onChange={(e) => setNuevo({ ...nuevo, hora_inicio: e.target.value })} title="Entra" />
          <input type="time" value={nuevo.hora_fin} onChange={(e) => setNuevo({ ...nuevo, hora_fin: e.target.value })} title="Sale" />
          <button onClick={addTurno}>+ Añadir turno</button>
        </div>
      )}

      {historicos.length > 0 && (
        <p className="nota" style={{ marginTop: 10 }}>
          <strong>Turnos históricos:</strong> {historicos.map((t) => t.nombre).join(', ')}. Ya no se
          pueden elegir, pero se conservan para que la caja vieja registrada con ellos se siga leyendo.
        </p>
      )}

      <h4 className="sub-titulo" style={{ marginTop: 22 }}>Horario de la tienda</h4>
      <p className="nota">
        A qué hora abre y cierra cada día. Marca <strong>Cerrado</strong> los días que no se
        atiende: así un día sin caja se sabe que fue descanso y no que se olvidaron de registrarlo.
      </p>

      {activos.map((t) => (
        <div key={t.id} className="horario-turno">
          <p className="t-label"><strong>{t.nombre}</strong></p>
          <table className="tabla">
            <thead><tr><th>Día</th><th>Abre</th><th>Cierra</th><th>¿Atiende?</th></tr></thead>
            <tbody>
              {DIAS.map((d, i) => {
                const h = celda(t.id, i)
                const cerrado = h?.cerrado
                return (
                  <tr key={i} className={cerrado ? 'fila-inactiva' : ''}>
                    <td><strong>{d}</strong></td>
                    <td>
                      <input type="time" defaultValue={hhmm(h?.abre)} disabled={!puedeEditar || cerrado}
                        onBlur={(e) => setHora(t.id, i, 'abre', e.target.value)} />
                    </td>
                    <td>
                      <input type="time" defaultValue={hhmm(h?.cierra)} disabled={!puedeEditar || cerrado}
                        onBlur={(e) => setHora(t.id, i, 'cierra', e.target.value)} />
                    </td>
                    <td>
                      <button className={`chip ${cerrado ? 'chip-off' : 'chip-ok'}`}
                        disabled={!puedeEditar} onClick={() => toggleCerrado(t.id, i)}>
                        {cerrado ? 'Cerrado' : 'Abre'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
