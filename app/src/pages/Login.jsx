import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { aEmail } from '../lib/roles'

// El celular de la tienda es siempre el mismo, y quien entra suele ser la misma
// persona. Recordar el usuario deja el ingreso en "teclear 6 números", que era
// justo lo que se pedía. Se guarda SOLO el usuario: el PIN jamás toca el disco.
const RECORDADO = 'cholao_usuario'

export default function Login() {
  const { signIn, isSupabaseConfigured } = useAuth()
  const navigate = useNavigate()
  const [usuario, setUsuario] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [cambiarUsuario, setCambiarUsuario] = useState(false)
  const refPin = useRef(null)

  useEffect(() => {
    const guardado = localStorage.getItem(RECORDADO)
    if (guardado) {
      setUsuario(guardado)
      // Si ya sabemos quién es, el cursor va directo al PIN.
      setTimeout(() => refPin.current?.focus(), 100)
    } else setCambiarUsuario(true)
  }, [])

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

          {/* inputMode="numeric" abre el teclado de números en el celular, que es
              donde se usa esto. type="password" para que no se lea por encima
              del hombro en el mostrador. */}
          <input
            ref={refPin}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="current-password"
            placeholder="Clave o PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={!isSupabaseConfigured}
            className="login-pin"
            required
          />

          {error && <div className="login-error">{error}</div>}
          <button type="submit" disabled={!isSupabaseConfigured || cargando || !usuario || !pin}>
            {cargando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  )
}
