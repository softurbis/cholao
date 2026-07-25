import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { veTodo, puedeEditar } from '../lib/roles'
import Manual from '../components/Manual'

// Asistencia con selfie y georreferencia.
//
// Reglas que pidió el usuario (estrictas a propósito):
//   · Marca ENTRADA y SALIDA, siempre con selfie.
//   · La ubicación se valida contra la sede: fuera del radio, NO marca.
//   · Sin cámara o sin GPS, NO marca.
//   · Válvula de escape: super/admin registran a mano, con motivo, y la marca
//     queda señalada. Sin eso, un celular viejo o un local sin señal deja a
//     alguien sin poder marcar y el negocio se traba.
//
// El orden importa: PRIMERO se pide la ubicación y se valida, DESPUÉS la selfie.
// Al revés sería hacerle tomar la foto para recién decirle que no puede marcar.
//
// La distancia que se guarda la calcula la BASE (trigger de sql/32), no esta
// pantalla: así nadie puede mandar un número de metros inventado.
const hoyISO = () => new Date().toISOString().slice(0, 10)
const hora = (ts) => new Date(ts).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })

// Haversine, solo para avisarle al momento. La cifra que vale es la de la base.
function distancia(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))))
}

function ubicacionActual() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este celular no permite ubicación.'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy }),
      (e) => reject(new Error(
        e.code === 1 ? 'No diste permiso de ubicación. Actívalo para poder marcar.'
          : e.code === 3 ? 'No se pudo obtener tu ubicación (tardó demasiado). Sal al aire libre e inténtalo de nuevo.'
            : 'No se pudo obtener tu ubicación.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  })
}

export default function Asistencia() {
  const { perfil } = useAuth()
  const esControl = veTodo(perfil)
  const [vista, setVista] = useState('marcar')

  return (
    <div className="pagina">
      <h1>🕒 Asistencia<Manual modulo="asistencia" /></h1>
      {esControl && (
        <div className="tab-bar">
          <button className={vista === 'marcar' ? 'tab activo' : 'tab'} onClick={() => setVista('marcar')}>Marcar</button>
          <button className={vista === 'control' ? 'tab activo' : 'tab'} onClick={() => setVista('control')}>Quién marcó</button>
        </div>
      )}
      {vista === 'marcar' || !esControl
        ? <Marcar perfil={perfil} />
        : <PanelAsistencia perfil={perfil} />}
    </div>
  )
}

// ---------------------------------------------------------------------
function Marcar({ perfil }) {
  const [sedes, setSedes] = useState([])
  const [misMarcas, setMisMarcas] = useState([])
  const [sedeSel, setSedeSel] = useState('')
  const [paso, setPaso] = useState('')      // '' | 'ubicando' | 'foto' | 'guardando'
  const [ubic, setUbic] = useState(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [tipo, setTipo] = useState(null)

  async function cargar() {
    const [{ data: s }, { data: m }] = await Promise.all([
      supabase.from('sedes').select('id, nombre, lat, lng, radio_m').eq('activo', true).order('nombre'),
      supabase.from('asistencia_marcas').select('*').eq('perfil_id', perfil.id).eq('fecha', hoyISO()),
    ])
    setSedes(s || []); setMisMarcas(m || [])
    if (!sedeSel) setSedeSel(perfil.sede_id || (s || [])[0]?.id || '')
  }
  useEffect(() => { cargar() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const entrada = misMarcas.find((m) => m.tipo === 'entrada')
  const salida = misMarcas.find((m) => m.tipo === 'salida')
  const sede = sedes.find((s) => s.id === sedeSel)
  const siguiente = !entrada ? 'entrada' : !salida ? 'salida' : null

  // Paso 1: la ubicación. Se valida ANTES de pedir la foto.
  async function pedirUbicacion(t) {
    setErr(''); setOk(''); setTipo(t); setPaso('ubicando')
    if (!sede) { setPaso(''); return setErr('Elige tu sede.') }
    if (sede.lat == null || sede.lng == null) {
      setPaso(''); return setErr('Tu sede todavía no tiene su ubicación configurada. Avísale al administrador.')
    }
    try {
      const u = await ubicacionActual()
      const d = distancia(u.lat, u.lng, Number(sede.lat), Number(sede.lng))
      if (d > (sede.radio_m || 120)) {
        setPaso('')
        return setErr(`Estás a ${d} m de ${sede.nombre} y solo se puede marcar dentro de ${sede.radio_m} m. Acércate e inténtalo de nuevo.`)
      }
      setUbic({ ...u, distancia: d }); setPaso('foto')
    } catch (e) { setPaso(''); setErr(e.message) }
  }

  // Paso 2: la selfie, y recién ahí se guarda.
  async function conFoto(file) {
    if (!file) return
    setPaso('guardando'); setErr('')
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const ruta = `asistencia/${hoyISO()}/${perfil.id}-${tipo}-${Date.now()}.${ext}`
      const { error: eUp } = await supabase.storage.from('arqueos').upload(ruta, file, { contentType: file.type || undefined })
      if (eUp) throw new Error('No se pudo subir la foto: ' + eUp.message)
      const { error } = await supabase.from('asistencia_marcas').insert({
        perfil_id: perfil.id, sede_id: sedeSel, tipo, fecha: hoyISO(),
        lat: ubic.lat, lng: ubic.lng, precision_m: Math.round(ubic.precision || 0), selfie_url: ruta,
      })
      if (error) throw new Error(/duplicate|unique/i.test(error.message)
        ? `Ya marcaste tu ${tipo} de hoy.` : error.message)
      setOk(`✅ ${tipo === 'entrada' ? 'Entrada' : 'Salida'} marcada. ¡Buen día!`)
      setUbic(null); setTipo(null); setPaso(''); cargar()
    } catch (e) { setPaso(''); setErr(e.message) }
  }

  return (
    <div className="ch">
      <p className="pagina-sub">Marca tu entrada y tu salida desde tu celular. Se toma tu ubicación y una foto.</p>

      <div className="asis-hoy">
        <div className={entrada ? 'asis-marca ok' : 'asis-marca'}>
          <span className="asis-lbl">Entrada</span>
          <strong>{entrada ? hora(entrada.marcada_en) : '—'}</strong>
        </div>
        <div className={salida ? 'asis-marca ok' : 'asis-marca'}>
          <span className="asis-lbl">Salida</span>
          <strong>{salida ? hora(salida.marcada_en) : '—'}</strong>
        </div>
      </div>

      {err && <div className="alerta">{err}</div>}
      {ok && <div className="aviso-ok">{ok}</div>}

      {!perfil.sede_id && sedes.length > 0 && (<>
        <label className="ch-lbl">¿En qué sede estás?</label>
        <div className="ch-pills ch-pills-wrap">
          {sedes.map((s) => (
            <button type="button" key={s.id} className={sedeSel === s.id ? 'ch-pill act' : 'ch-pill'}
              onClick={() => setSedeSel(s.id)}>{s.nombre}</button>
          ))}
        </div>
      </>)}

      {!siguiente ? (
        <div className="bloque-vacio"><p>Ya marcaste tu entrada y tu salida de hoy. Nada más que hacer aquí.</p></div>
      ) : paso === 'foto' ? (
        <div className="asis-foto-paso">
          <p className="nota">Estás a {ubic.distancia} m de {sede?.nombre}. Ahora tómate la foto para confirmar.</p>
          <label className="ch-foto" style={{ minHeight: 64 }}>
            🤳 Tomarme la foto
            <input type="file" accept="image/*" capture="user" style={{ display: 'none' }}
              onChange={(e) => conFoto(e.target.files?.[0])} />
          </label>
          <button type="button" className="ch-sec" onClick={() => { setPaso(''); setUbic(null) }}>Cancelar</button>
        </div>
      ) : (
        <button type="button" className="ch-guardar asis-btn" disabled={paso !== ''}
          onClick={() => pedirUbicacion(siguiente)}>
          {paso === 'ubicando' ? 'Buscando tu ubicación…'
            : paso === 'guardando' ? 'Guardando…'
              : siguiente === 'entrada' ? 'Marcar mi entrada' : 'Marcar mi salida'}
        </button>
      )}

      {paso === 'ubicando' && <p className="nota">Si tarda, sal al aire libre: dentro del local el GPS agarra mal.</p>}
    </div>
  )
}

// ---------------------------------------------------------------------
// Quién marcó: lo que revisa gerencia/administración.
function PanelAsistencia({ perfil }) {
  const [fecha, setFecha] = useState(hoyISO())
  const [marcas, setMarcas] = useState([])
  const [personas, setPersonas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [manual, setManual] = useState({ perfil_id: '', tipo: 'entrada', motivo: '' })
  const [msg, setMsg] = useState('')
  const puedeCorregir = puedeEditar(perfil)

  async function cargar() {
    setCargando(true)
    const [{ data: m }, { data: p }] = await Promise.all([
      supabase.from('vista_asistencia_dia').select('*').eq('fecha', fecha),
      supabase.from('perfiles').select('id, nombre, rol').eq('activo', true).order('nombre'),
    ])
    setMarcas(m || []); setPersonas(p || []); setCargando(false)
  }
  useEffect(() => { cargar() }, [fecha])   // eslint-disable-line react-hooks/exhaustive-deps

  const porPersona = useMemo(() => {
    const m = {}
    for (const x of marcas) {
      m[x.perfil_id] = m[x.perfil_id] || { persona: x.persona, rol: x.rol, sede: x.sede }
      m[x.perfil_id][x.tipo] = x
    }
    return Object.entries(m).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.persona.localeCompare(b.persona))
  }, [marcas])

  async function verFoto(ruta) {
    const { data } = await supabase.storage.from('arqueos').createSignedUrl(ruta, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // La válvula de escape: registrar a mano cuando el celular no dio.
  async function registrarManual() {
    if (!manual.perfil_id) return setMsg('Elige a la persona.')
    if (!manual.motivo.trim()) return setMsg('Escribe por qué se registra a mano.')
    const { error } = await supabase.from('asistencia_marcas').insert({
      perfil_id: manual.perfil_id, tipo: manual.tipo, fecha,
      manual: true, motivo_manual: manual.motivo.trim(), registrada_por: perfil.id,
    })
    if (error) return setMsg(/duplicate|unique/i.test(error.message) ? 'Esa persona ya tiene esa marca ese día.' : error.message)
    setManual({ perfil_id: '', tipo: 'entrada', motivo: '' }); setMsg('Marca registrada a mano.'); cargar()
  }

  const celda = (m) => {
    if (!m) return <span className="nota">—</span>
    return (
      <span>
        <strong>{hora(m.marcada_en)}</strong>
        {m.manual && <span className="chip chip-off" style={{ marginLeft: 4 }} title={m.motivo_manual}>a mano</span>}
        {m.fuera_de_rango && <span className="chip" style={{ marginLeft: 4, background: '#fee2e2', color: '#991b1b' }}>{Math.round(m.distancia_m)} m</span>}
        {m.selfie_url && <button className="btn-mini" style={{ marginLeft: 4 }} onClick={() => verFoto(m.selfie_url)}>🤳</button>}
      </span>
    )
  }

  return (
    <div>
      <p className="pagina-sub">Quién marcó, a qué hora y desde dónde. Las marcas fuera del radio o registradas a mano salen señaladas.</p>
      <div className="form-inline">
        <label className="campo"><span>Día</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      </div>
      {msg && <div className="alerta">{msg}</div>}

      {cargando ? <p className="nota">Cargando…</p> : (
        <table className="tabla tabla-movil">
          <thead><tr><th>Persona</th><th>Sede</th><th>Entrada</th><th>Salida</th></tr></thead>
          <tbody>
            {porPersona.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.persona}</strong> <span className="nota">{p.rol}</span></td>
                <td>{p.sede || '—'}</td>
                <td>{celda(p.entrada)}</td>
                <td>{celda(p.salida)}</td>
              </tr>
            ))}
            {porPersona.length === 0 && <tr><td colSpan="4" className="nota">Nadie marcó este día.</td></tr>}
          </tbody>
        </table>
      )}

      {puedeCorregir && (
        <div className="panel-detalle">
          <h3>Registrar una marca a mano</h3>
          <p className="nota">
            Para cuando el celular no dio la cámara o el GPS. Queda señalada como “a mano” con
            tu nombre y el motivo, para que se note la diferencia con una marca normal.
          </p>
          <div className="form-inline">
            <select value={manual.perfil_id} onChange={(e) => setManual({ ...manual, perfil_id: e.target.value })} style={{ minWidth: 170 }}>
              <option value="">¿Quién?</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <select value={manual.tipo} onChange={(e) => setManual({ ...manual, tipo: e.target.value })}>
              <option value="entrada">Entrada</option>
              <option value="salida">Salida</option>
            </select>
            <input placeholder="Motivo (obligatorio)" value={manual.motivo}
              onChange={(e) => setManual({ ...manual, motivo: e.target.value })} style={{ minWidth: 200 }} />
            <button onClick={registrarManual}>Registrar</button>
          </div>
        </div>
      )}
    </div>
  )
}
