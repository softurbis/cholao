import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Sedes() {
  const [sedes, setSedes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ nombre: '', direccion: '', telefono: '' })
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    setCargando(true)
    const { data, error } = await supabase
      .from('sedes')
      .select('*')
      .order('nombre')
    if (error) setError(error.message)
    else setSedes(data || [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

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
    const { error } = await supabase.from('sedes')
      .update({ activo: !sede.activo }).eq('id', sede.id)
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
      <p className="pagina-sub">Los locales de El Cholao. Todo el control cuelga de aquí.</p>

      {error && <div className="alerta">{error}</div>}

      <form className="form-inline" onSubmit={agregar}>
        <input placeholder="Nombre *" value={form.nombre}
          onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
        <input placeholder="Dirección" value={form.direccion}
          onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
        <input placeholder="Teléfono" value={form.telefono}
          onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
        <button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : '+ Añadir sede'}</button>
      </form>

      {cargando ? (
        <p className="nota">Cargando…</p>
      ) : (
        <table className="tabla">
          <thead>
            <tr><th>Sede</th><th>Dirección</th><th>Teléfono</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {sedes.map((s) => (
              <tr key={s.id} className={s.activo ? '' : 'fila-inactiva'}>
                <td><strong>{s.nombre}</strong></td>
                <td>{s.direccion || '—'}</td>
                <td>{s.telefono || '—'}</td>
                <td>
                  <span className={`chip ${s.activo ? 'chip-ok' : 'chip-off'}`}>
                    {s.activo ? 'Activa' : 'Inactiva'}
                  </span>
                </td>
                <td className="acciones">
                  <button className="btn-mini" onClick={() => toggleActivo(s)}>
                    {s.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  <button className="btn-mini btn-peligro" onClick={() => borrar(s)}>Borrar</button>
                </td>
              </tr>
            ))}
            {sedes.length === 0 && (
              <tr><td colSpan="5" className="nota">Sin sedes. Añade la primera arriba.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
