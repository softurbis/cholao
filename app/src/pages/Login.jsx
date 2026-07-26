import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { aEmail } from '../lib/roles'

// El celular de la tienda es siempre el mismo, y quien entra suele ser la misma
// persona. Recordar el usuario deja el ingreso en "teclear 6 números", que era
// justo lo que se pedía. Se guarda SOLO el usuario: el PIN jamás toca el disco.
const RECORDADO = 'cholao_usuario'
// Qué teclado abrir en el celular. La cajera teclea 6 números y quiere el teclado
// numérico; el superusuario y gerencia escriben una clave CON LETRAS y con el
// teclado numérico simplemente no podían entrar desde el celular. Como el rol no
// se sabe hasta después de autenticar, se recuerda la elección en ese aparato.
const TECLADO = 'cholao_teclado'

export default function Login() {
  const { signIn, isSupabaseConfigured } = useAuth()
  const navigate = useNavigate()
  const [usuario, setUsuario] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [cambiarUsuario, setCambiarUsuario] = useState(false)
  const [conLetras, setConLetras] = useState(false)
  const refPin = useRef(null)

  useEffect(() => {
    const guardado = localStorage.getItem(RECORDADO)
    if (localStorage.getItem(TECLADO) === 'letras') setConLetras(true)
    if (guardado) {
      setUsuario(guardado)
      // Si ya sabemos quién es, el cursor va directo al PIN.
      setTimeout(() => refPin.current?.focus(), 100)
    } else setCambiarUsuario(true)
  }, [])

  // Un usuario con arroba es un correo, y quien entra con correo usa contraseña,
  // no PIN: ahí el teclado de letras se pone solo sin que nadie toque nada.
  const teclas = conLetras || usuario.includes('@')

  function alternarTeclado() {
    const v = !conLetras
    setConLetras(v)
    localStorage.setItem(TECLADO, v ? 'letras' : 'numeros')
    refPin.current?.focus()
  }

  async function enviar(e) {
    e.preventDefault()
    setError('')
    setCargando(true)
    // La cajera escribe "marcelo"; Supabase necesita un correo. Si ya escribió
    // uno (el superadmin usa su gmail), se respeta tal cual.
    const err = await signIn(aEmail(usuario), pin)
    setCargando(false)
    if (err) {
      setError(/invalid login/i.test(err.message)
        ? 'Usuario o clave incorrectos.'   // "Invalid login credentials" no le dice nada a nadie en la tienda
        : err.message)
      setPin('')
      refPin.current?.focus()
      return
    }
    localStorage.setItem(RECORDADO, usuario.trim().toLowerCase())
    // A "/" siempre: ProtectedRoute manda a cada rol a su pantalla de inicio.
    navigate('/')
  }

  function olvidarUsuario() {
    localStorage.removeItem(RECORDADO)
    setUsuario(''); setPin(''); setCambiarUsuario(true)
  }

  return (
    <div className="login-pantalla">
      <div className="login-caja">
        <div className="login-logo">🍧</div>
        <h1>Sistema Cholao</h1>
        <p className="login-sub">Control de sedes</p>

        {!isSupabaseConfigured && (
          <div className="aviso-config">
            <strong>Falta configurar Supabase.</strong>
            <span>Crea el archivo <code>.env</code> con <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> y reinicia <code>npm run dev</code>.</span>
          </div>
        )}

        <form onSubmit={enviar}>
          {cambiarUsuario ? (
            // type="text", no "email": el navegador rechazaría "marcelo" por no
            // tener arroba y la cajera no podría ni intentar entrar.
            <input
              type="text"
              placeholder="Usuario"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              disabled={!isSupabaseConfigured}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck="false"
              autoComplete="username"
              required
              autoFocus
            />
          ) : (
            <div className="login-quien">
              <span>👤 <strong>{usuario}</strong></span>
              <button type="button" className="btn-mini" onClick={olvidarUsuario}>No soy yo</button>
            </div>
          )}

          {/* type="password" para que no se lea por encima del hombro en el
              mostrador. El teclado depende de quién entra: numérico para el PIN
              de 6 números de la cajera, de letras para la clave del superusuario
              y gerencia — con el numérico no podían ni escribirla en el celular. */}
          <input
            ref={refPin}
            type="password"
            inputMode={teclas ? 'text' : 'numeric'}
            autoComplete="current-password"
            placeholder={teclas ? 'Contraseña' : 'PIN de 6 números'}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={!isSupabaseConfigured}
            className={teclas ? 'login-pin letras' : 'login-pin'}
            required
          />

          <button type="button" className="login-teclado" onClick={alternarTeclado}>
            {teclas ? '🔢 Entro con PIN de números' : '🔤 Mi clave tiene letras'}
          </button>

          {error && <div className="login-error">{error}</div>}
          <button type="submit" disabled={!isSupabaseConfigured || cargando || !usuario || !pin}>
            {cargando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  )
}
