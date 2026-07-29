import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, ROLES_ASIGNABLES, necesitaSede } from '../lib/roles'
import Manual from '../components/Manual'
import {
  crearUsuario, resetearClave, activarUsuario, eliminarUsuario,
  sugerirUsuario, sugerirPin, ES_PIN,
} from '../lib/adminUsuarios'

const VACIO = { nombres: '', apellidos: '', dni: '', telefono: '', cargo: '', sede_id: '', sueldo_base: '', pago_hora: '' }
const n = (v) => (v === '' || v == null ? null : Number(v))
const sol = (v) => (v == null ? '—' : 'S/ ' + Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2 }))

export default function Personas() {
  const { perfil } = useAuth()
  const [personas, setPersonas] = useState([])
  const [perfiles, setPerfiles] = useState([])
  const [sedes, setSedes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [form, setForm] = useState(VACIO)
  const [guardando, setGuardando] = useState(false)
  const [editando, setEditando] = useState(null)   // id de la persona en edición
  const [creandoPara, setCreandoPara] = useState(null)  // persona a la que se le crea el login
  const [credencial, setCredencial] = useState(null)    // lo recién creado, para dictarlo

  async function cargar() {
    setCargando(true)
    const [{ data: p, error: e1 }, { data: pf, error: e2 }, { data: s }] = await Promise.all([
      supabase.from('personas').select('*').order('nombres'),
      supabase.from('perfiles').select('*'),
      supabase.from('sedes').select('id, nombre').order('nombre'),
    ])
    if (e1 || e2) setError((e1 || e2).message)
    setPersonas(p || []); setPerfiles(pf || []); setSedes(s || [])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  // El acceso de cada persona, indexado por persona_id
  const accesoDe = useMemo(() => {
    const m = {}
    for (const pf of perfiles) if (pf.persona_id) m[pf.persona_id] = pf
    return m
  }, [perfiles])

  // Activos arriba, desactivados abajo. Se separan para que la lista de trabajo
  // no se ensucie con gente que ya no está, pero sin perderlos de vista.
  const activas = useMemo(() => personas.filter((p) => p.activo), [personas])
  const inactivas = useMemo(() => personas.filter((p) => !p.activo), [personas])

  // Logins que no cuelgan de ninguna persona (el superadmin, por ejemplo)
  const sueltos = useMemo(() => perfiles.filter((p) => !p.persona_id), [perfiles])

  const nombreSede = (id) => sedes.find((s) => s.id === id)?.nombre || '—'

  function aviso(tipo, msg) {
    if (tipo === 'ok') { setOk(msg); setError('') } else { setError(msg); setOk('') }
  }

  // ---------- personas ----------
  async function agregar(e) {
    e.preventDefault()
    if (!form.nombres.trim()) return
    setGuardando(true); setError('')
    const { error } = await supabase.from('personas').insert({
      nombres: form.nombres.trim().toUpperCase(),
      apellidos: form.apellidos.trim().toUpperCase() || null,
      dni: form.dni.trim() || null,
      telefono: form.telefono.trim() || null,
      cargo: form.cargo.trim().toUpperCase() || null,
      sede_id: form.sede_id || null,
      sueldo_base: n(form.sueldo_base), pago_hora: n(form.pago_hora),
    })
    setGuardando(false)
    if (error) aviso('err', error.message)
    else { setForm(VACIO); aviso('ok', '✅ Persona añadida'); cargar() }
  }

  async function guardarEdicion(p, campos) {
    const { error } = await supabase.from('personas').update(campos).eq('id', p.id)
    if (error) aviso('err', error.message)
    else { setEditando(null); aviso('ok', '✅ Guardado'); cargar() }
  }

  async function togglePersona(p) {
    const { error } = await supabase.from('personas').update({ activo: !p.activo }).eq('id', p.id)
    if (error) aviso('err', error.message); else cargar()
  }

  // ---------- accesos ----------
  async function crearAcceso(datos) {
    setGuardando(true); setError('')
    try {
      const r = await crearUsuario(datos)
      // Se muestra la clave UNA vez para que se la dicten a la persona. No se
      // guarda en ningún lado: si se pierde, se resetea desde acá.
      setCredencial({ usuario: r.usuario, clave: datos.clave, nombre: datos.nombre, esCorreo: !!datos.correo })
      setCreandoPara(null)
      aviso('ok', `✅ Login creado para ${datos.nombre}`)
      cargar()
    } catch (e) { aviso('err', e.message) }
    setGuardando(false)
  }

  // Quien entra con correo usa contraseña, no PIN: pedirle 6 dígitos sería
  // cambiarle la forma de entrar sin avisarle.
  async function resetear(pf) {
    const esCorreo = (pf.usuario || '').includes('@')
    const clave = esCorreo
      ? prompt(`Nueva contraseña para "${pf.usuario}" — mínimo 6 caracteres:`, '')
      : prompt(`Nuevo PIN para "${pf.usuario}" — 6 números:`, sugerirPin())
    if (!clave) return
    if (esCorreo) {
      if (clave.length < 6) return aviso('err', 'La contraseña debe tener al menos 6 caracteres.')
    } else if (!ES_PIN.test(clave)) {
      return aviso('err', 'El PIN debe ser exactamente 6 números (Supabase no acepta menos de 6).')
    }
    try {
      await resetearClave(pf.id, clave)
      setCredencial({ usuario: pf.usuario, clave, nombre: pf.nombre, esCorreo })
      aviso('ok', esCorreo ? '✅ Contraseña cambiada' : '✅ PIN cambiado')
    } catch (e) { aviso('err', e.message) }
  }

  async function toggleAcceso(pf) {
    try {
      await activarUsuario(pf.id, !pf.activo)
      aviso('ok', pf.activo ? '🔒 Acceso desactivado' : '✅ Acceso reactivado')
      cargar()
    } catch (e) { aviso('err', e.message) }
  }

  // El permiso de gastos se guarda en perfiles; el superusuario lo edita directo
  // (su RLS se lo permite), sin pasar por la Edge Function.
  async function toggleGastos(pf) {
    const { error } = await supabase.from('perfiles').update({ puede_gastos: !pf.puede_gastos }).eq('id', pf.id)
    if (error) aviso('err', error.message)
    else { aviso('ok', pf.puede_gastos ? 'Permiso de gastos quitado' : '✅ Ahora puede registrar gastos y adelantos'); cargar() }
  }
  async function toggleCompras(pf) {
    const { error } = await supabase.from('perfiles').update({ puede_compras: !pf.puede_compras }).eq('id', pf.id)
    if (error) aviso('err', error.message)
    else { aviso('ok', pf.puede_compras ? 'Permiso de compras quitado' : '✅ Ahora puede registrar compras'); cargar() }
  }

  async function borrarAcceso(pf) {
    if (!confirm(`¿Eliminar el login "${pf.usuario}" de ${pf.nombre}?\n\nSu historial (turnos, gastos) NO se borra.\nSi la persona solo se fue, es mejor DESACTIVAR.`)) return
    try {
      await eliminarUsuario(pf.id)
      aviso('ok', '🗑️ Login eliminado')
      cargar()
    } catch (e) { aviso('err', e.message) }
  }

  if (perfil && perfil.rol !== 'superadmin') {
    return (
      <div className="pagina">
        <h1>👥 Personas</h1>
        <div className="bloque-vacio"><p>Solo el superadmin administra el personal y sus accesos.</p></div>
      </div>
    )
  }

  return (
    <div className="pagina">
      <h1>👥 Personas<Manual modulo="personas" /></h1>
      <p className="pagina-sub">El personal de El Cholao y quién entra al sistema.</p>

      {error && <div className="alerta">{error}</div>}
      {ok && <div className="aviso-ok">{ok}</div>}

      {credencial && (
        <div className="panel-detalle">
          <h3>🔑 Anota estos datos y dáselos a {credencial.nombre}</h3>
          <div className="dos-cols">
            <p><span className="t-label">{credencial.esCorreo ? 'Correo' : 'Usuario'}</span> <b className="t-valor">{credencial.usuario}</b></p>
            <p><span className="t-label">{credencial.esCorreo ? 'Contraseña' : 'PIN'}</span>
              <b className="t-valor" style={credencial.esCorreo ? undefined : { letterSpacing: 3 }}>{credencial.clave}</b></p>
          </div>
          <p className="nota">
            Entra en la misma página escribiendo <b>{credencial.usuario}</b> y su {credencial.esCorreo ? 'contraseña' : 'PIN'}.
            {credencial.esCorreo
              ? ' En el celular hay un botón para cambiar al teclado de letras.'
              : ' No necesita correo. En su celular el usuario queda recordado, así que en adelante solo teclea los 6 números.'}
            {' '}No se vuelve a mostrar; si se le olvida, se la cambias desde aquí con <b>Resetear clave</b>.
          </p>
          <button className="btn-mini" onClick={() => setCredencial(null)}>Ya lo anoté</button>
        </div>
      )}

      <form className="form-inline" onSubmit={agregar}>
        <input placeholder="Nombres *" value={form.nombres}
          onChange={(e) => setForm({ ...form, nombres: e.target.value })} required />
        <input placeholder="Apellidos" value={form.apellidos}
          onChange={(e) => setForm({ ...form, apellidos: e.target.value })} />
        <input placeholder="DNI" value={form.dni}
          onChange={(e) => setForm({ ...form, dni: e.target.value })} />
        <input placeholder="Teléfono" value={form.telefono}
          onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
        <input placeholder="Cargo" value={form.cargo}
          onChange={(e) => setForm({ ...form, cargo: e.target.value })} />
        <select value={form.sede_id} onChange={(e) => setForm({ ...form, sede_id: e.target.value })}>
          <option value="">Sede…</option>
          {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <input placeholder="Sueldo" type="number" step="0.01" className="in-num" value={form.sueldo_base}
          onChange={(e) => setForm({ ...form, sueldo_base: e.target.value })} />
        {/* Referencia para calcular horas extra. El pago se registra a mano en Gastos. */}
        <input placeholder="Pago x hora" type="number" step="0.01" className="in-num" value={form.pago_hora}
          onChange={(e) => setForm({ ...form, pago_hora: e.target.value })} />
        <button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : '+ Añadir persona'}</button>
      </form>

      {cargando ? <p className="nota">Cargando…</p> : (() => {
        const fila = (p) => (
          <FilaPersona
            key={p.id} p={p} pf={accesoDe[p.id]} sedes={sedes} nombreSede={nombreSede}
            editando={editando === p.id}
            onEditar={() => setEditando(editando === p.id ? null : p.id)}
            onGuardar={(campos) => guardarEdicion(p, campos)}
            onToggle={() => togglePersona(p)}
            onCrearLogin={() => { setCreandoPara(p); setCredencial(null) }}
            onResetear={() => resetear(accesoDe[p.id])}
            onToggleAcceso={() => toggleAcceso(accesoDe[p.id])}
            onToggleGastos={() => toggleGastos(accesoDe[p.id])}
            onToggleCompras={() => toggleCompras(accesoDe[p.id])}
            onBorrarAcceso={() => borrarAcceso(accesoDe[p.id])}
          />
        )
        return (
          <table className="tabla">
            <thead>
              <tr>
                <th>Persona</th><th>DNI</th><th>Cargo</th><th>Sede</th><th>Sueldo</th><th>Pago x hora</th>
                <th>Acceso al sistema</th><th></th>
              </tr>
            </thead>
            <tbody>
              {activas.map(fila)}
              {personas.length === 0 && (
                <tr><td colSpan="7" className="nota">Sin personas. Añade la primera arriba.</td></tr>
              )}
              {inactivas.length > 0 && (
                <tr className="fila-separadora">
                  <td colSpan="7">
                    Desactivados ({inactivas.length}) — ya no trabajan aquí, pero se guardan
                    para que su historial de caja y planilla siga cuadrando.
                  </td>
                </tr>
              )}
              {inactivas.map(fila)}
            </tbody>
          </table>
        )
      })()}

      {creandoPara && (
        <FormAcceso
          persona={creandoPara} sedes={sedes} guardando={guardando}
          onCancelar={() => setCreandoPara(null)}
          onCrear={crearAcceso}
        />
      )}

      {sueltos.length > 0 && (
        <div className="seccion">
          <h2 className="sub-titulo">Logins sin persona</h2>
          <p className="nota">
            Entran al sistema pero no están en la lista de arriba (el tuyo, por ejemplo).
            No pasa nada: solo significa que no cobran planilla ni salen en los adelantos.
          </p>
          <table className="tabla">
            <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Sede</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {sueltos.map((pf) => (
                <tr key={pf.id} className={pf.activo ? '' : 'fila-inactiva'}>
                  <td><b>{pf.usuario || '—'}</b></td>
                  <td>{pf.nombre}</td>
                  <td><span className="chip">{ROLES[pf.rol] || pf.rol}</span></td>
                  <td>{nombreSede(pf.sede_id)}</td>
                  <td>
                    <span className={`chip ${pf.activo ? 'chip-ok' : 'chip-off'}`}>
                      {pf.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="acciones">
                    <button className="btn-mini" onClick={() => resetear(pf)}>Resetear clave</button>
                    {pf.id !== perfil?.id && (
                      <button className="btn-mini" onClick={() => toggleAcceso(pf)}>
                        {pf.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
function FilaPersona({
  p, pf, sedes, nombreSede, editando, onEditar, onGuardar, onToggle,
  onCrearLogin, onResetear, onToggleAcceso, onToggleGastos, onToggleCompras, onBorrarAcceso,
}) {
  const [ed, setEd] = useState({
    cargo: p.cargo || '', sede_id: p.sede_id || '', sueldo_base: p.sueldo_base ?? '',
    pago_hora: p.pago_hora ?? '', telefono: p.telefono || '', dni: p.dni || '',
  })

  if (editando) {
    return (
      <tr className="fila-edit">
        <td><b>{p.nombres} {p.apellidos || ''}</b></td>
        <td><input value={ed.dni} onChange={(e) => setEd({ ...ed, dni: e.target.value })} style={{ maxWidth: 90 }} /></td>
        <td><input value={ed.cargo} onChange={(e) => setEd({ ...ed, cargo: e.target.value })} style={{ maxWidth: 110 }} /></td>
        <td>
          <select value={ed.sede_id} onChange={(e) => setEd({ ...ed, sede_id: e.target.value })} style={{ maxWidth: 120 }}>
            <option value="">—</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </td>
        <td>
          <input type="number" step="0.01" className="in-num" value={ed.sueldo_base}
            onChange={(e) => setEd({ ...ed, sueldo_base: e.target.value })} style={{ maxWidth: 90 }} />
        </td>
        <td>
          <input type="number" step="0.01" className="in-num" value={ed.pago_hora}
            onChange={(e) => setEd({ ...ed, pago_hora: e.target.value })} style={{ maxWidth: 80 }} />
        </td>
        <td><input value={ed.telefono} onChange={(e) => setEd({ ...ed, telefono: e.target.value })}
          placeholder="Teléfono" style={{ maxWidth: 110 }} /></td>
        <td className="acciones">
          <button className="btn-mini btn-ok" onClick={() => onGuardar({
            dni: ed.dni.trim() || null, cargo: ed.cargo.trim().toUpperCase() || null,
            sede_id: ed.sede_id || null, sueldo_base: n(ed.sueldo_base), pago_hora: n(ed.pago_hora),
            telefono: ed.telefono.trim() || null,
          })}>Guardar</button>
          <button className="btn-mini" onClick={onEditar}>Cancelar</button>
        </td>
      </tr>
    )
  }

  return (
    <tr className={p.activo ? '' : 'fila-inactiva'}>
      <td><strong>{p.nombres} {p.apellidos || ''}</strong></td>
      <td>{p.dni || '—'}</td>
      <td>{p.cargo || '—'}</td>
      <td>{nombreSede(p.sede_id)}</td>
      <td>{sol(p.sueldo_base)}</td>
      <td>{p.pago_hora ? sol(p.pago_hora) : <span className="nota">—</span>}</td>
      <td>
        {pf ? (
          <>
            <b>🔑 {pf.usuario}</b>{' '}
            <span className="chip">{ROLES[pf.rol] || pf.rol}</span>{' '}
            {pf.puede_gastos && <span className="chip chip-ok" title="Registra gastos y adelantos de tienda">+ gastos</span>}{' '}
            {pf.puede_compras && <span className="chip chip-ok" title="Opera el módulo Compras">+ compras</span>}{' '}
            {!pf.activo && <span className="chip chip-off">sin acceso</span>}
          </>
        ) : (
          <button className="btn-mini" onClick={onCrearLogin} disabled={!p.activo}>+ Crear login</button>
        )}
      </td>
      <td className="acciones">
        <button className="btn-mini" onClick={onEditar}>✎</button>
        {pf && <button className="btn-mini" onClick={onResetear}>Resetear clave</button>}
        {/* El permiso de gastos solo se ofrece para cajera/cocina: los demás roles
            ya lo tienen (o no aplica). */}
        {pf && pf.rol === 'cajera' && (
          <button className="btn-mini" onClick={onToggleGastos}>
            {pf.puede_gastos ? 'Quitar gastos' : 'Permitir gastos'}
          </button>
        )}
        {pf && pf.rol === 'cajera' && (
          <button className="btn-mini" onClick={onToggleCompras}>
            {pf.puede_compras ? 'Quitar compras' : 'Permitir compras'}
          </button>
        )}
        {pf && <button className="btn-mini" onClick={onToggleAcceso}>{pf.activo ? 'Quitar acceso' : 'Dar acceso'}</button>}
        {pf && <button className="btn-mini btn-peligro" onClick={onBorrarAcceso}>✕ login</button>}
        {!pf && <button className="btn-mini" onClick={onToggle}>{p.activo ? 'Desactivar' : 'Activar'}</button>}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------
function FormAcceso({ persona, sedes, guardando, onCancelar, onCrear }) {
  const [f, setF] = useState({
    usuario: sugerirUsuario(persona.nombres),
    correo: '',
    clave: sugerirPin(),
    rol: 'cajera',
    sede_id: persona.sede_id || '',
    puede_gastos: false,
    puede_compras: false,
  })
  // Dos formas de entrar: usuario simple (el personal de tienda, que no tiene
  // correo) o correo de verdad (gerencia, administración, alguien externo).
  const [conCorreo, setConCorreo] = useState(false)
  const nombre = `${persona.nombres} ${persona.apellidos || ''}`.trim()
  // Solo cajera/cocina/encargado trabajan en una sede fija (ver ROLES_CON_SEDE).
  const pideSede = necesitaSede(f.rol)
  // Los permisos extra solo tienen sentido para cajera (una registra gastos, otro
  // registra compras). Gerencia/admin/super ya lo hacen por su rol.
  const ofreceGastos = f.rol === 'cajera'
  const ofreceCompras = f.rol === 'cajera'
  // Con correo se usa contraseña siempre. Sin correo, el PIN depende del rol:
  // el personal de tienda teclea 6 números desde el celular.
  const usaPin = !conCorreo && ['cajera', 'cocina', 'compras'].includes(f.rol)
  const claveOk = usaPin ? ES_PIN.test(f.clave) : f.clave.length >= 6
  const correoOk = !conCorreo || /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(f.correo)

  // Al cambiar de forma de ingreso, la clave sugerida cambia con ella: un PIN de
  // 6 dígitos no sirve de contraseña ni al revés.
  function cambiarModo(v) {
    setConCorreo(v)
    setF((x) => ({ ...x, clave: v ? '' : sugerirPin(), correo: v ? x.correo : '' }))
  }

  return (
    <div className="panel-detalle">
      <h3>🔑 Crear login para {nombre}</h3>

      <div className="ch-pills ch-pills-wrap" style={{ maxWidth: 420, marginBottom: 12 }}>
        <button type="button" className={!conCorreo ? 'ch-pill act' : 'ch-pill'} onClick={() => cambiarModo(false)}>
          Usuario y PIN
        </button>
        <button type="button" className={conCorreo ? 'ch-pill act' : 'ch-pill'} onClick={() => cambiarModo(true)}>
          Correo y contraseña
        </button>
      </div>
      <p className="nota" style={{ marginTop: 0 }}>
        {conCorreo
          ? 'Entra con su correo real y una contraseña. Para gerencia, administración o alguien de fuera.'
          : 'Entra escribiendo solo su usuario y 6 números, sin correo. Para el personal de tienda.'}
      </p>

      <div className="filtros">
        {conCorreo ? (
          <label className="campo campo-ancho">
            <span>Correo</span>
            <input type="email" value={f.correo} autoFocus
              onChange={(e) => setF({ ...f, correo: e.target.value.trim().toLowerCase() })}
              placeholder="nombre@gmail.com" autoCapitalize="none" autoCorrect="off" spellCheck="false" />
          </label>
        ) : (
          <label className="campo">
            <span>Usuario</span>
            <input value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.target.value.toLowerCase() })}
              placeholder="marcelo" autoFocus />
          </label>
        )}
        <label className="campo">
          <span>{usaPin ? 'PIN (6 números)' : 'Contraseña'}</span>
          <input value={f.clave}
            inputMode={usaPin ? 'numeric' : 'text'} maxLength={usaPin ? 6 : 40}
            onChange={(e) => setF({ ...f, clave: usaPin ? e.target.value.replace(/\D/g, '') : e.target.value })}
            style={usaPin ? { letterSpacing: 3, fontWeight: 700 } : undefined} />
        </label>
        <label className="campo">
          <span>Rol</span>
          <select value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value, puede_gastos: false, puede_compras: false })}>
            {ROLES_ASIGNABLES.map((k) => <option key={k} value={k}>{ROLES[k]}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Sede {pideSede && '*'}</span>
          <select value={f.sede_id} onChange={(e) => setF({ ...f, sede_id: e.target.value })}
            disabled={!pideSede}>
            <option value="">{pideSede ? 'Elige…' : 'Todas'}</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
      </div>

      {ofreceGastos && (
        <label className="check-permiso">
          <input type="checkbox" checked={f.puede_gastos}
            onChange={(e) => setF({ ...f, puede_gastos: e.target.checked })} />
          <span>
            <b>Puede registrar gastos de tienda y adelantos</b>:
            además de su caja, sube los gastos del cholao (agua, luz…) y los adelantos de todos.
          </span>
        </label>
      )}
      {ofreceCompras && (
        <label className="check-permiso">
          <input type="checkbox" checked={f.puede_compras}
            onChange={(e) => setF({ ...f, puede_compras: e.target.checked })} />
          <span>
            <b>Puede registrar compras</b>: además de su caja, opera el módulo
            Compras (catálogo, proveedores, pedidos y sus compras con voucher).
          </span>
        </label>
      )}

      <p className="nota">
        Entra escribiendo <b>{(conCorreo ? f.correo : f.usuario) || '…'}</b> y su clave.
        {!conCorreo && ' No necesita correo.'}
        {pideSede && ' Solo verá los datos de su sede.'}
        {usaPin && ' El PIN lo pone el sistema: si lo eligieran, la mitad pondría 123456.'}
      </p>
      {!claveOk && (
        <p className="alerta">{usaPin
          ? 'El PIN debe ser exactamente 6 números (Supabase no acepta menos de 6).'
          : 'La contraseña debe tener al menos 6 caracteres.'}</p>
      )}
      {!correoOk && f.correo && <p className="alerta">Ese correo no tiene forma de correo válido.</p>}

      <div className="acciones">
        <button className="btn-guardar"
          disabled={guardando || !claveOk || !correoOk || (conCorreo ? !f.correo : !f.usuario) || (pideSede && !f.sede_id)}
          onClick={() => onCrear({
            // Si va con correo, el servidor lo usa tal cual; si no, arma
            // usuario@cholao.local. Se manda solo lo que corresponde.
            ...(conCorreo ? { correo: f.correo } : { usuario: f.usuario }),
            clave: f.clave, nombre, rol: f.rol,
            sede_id: pideSede ? f.sede_id : null, persona_id: persona.id,
            puede_gastos: ofreceGastos ? f.puede_gastos : false,
            puede_compras: ofreceCompras ? f.puede_compras : false,
          })}>
          {guardando ? 'Creando…' : 'Crear login'}
        </button>
        <button className="btn-mini" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}
