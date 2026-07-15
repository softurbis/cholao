import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn, isSupabaseConfigured } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setError('')
    setCargando(true)
    const err = await signIn(email, password)
    setCargando(false)
    if (err) setError(err.message)
    else navigate('/')
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
          <input
            type="email"
            placeholder="Correo"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!isSupabaseConfigured}
            required
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!isSupabaseConfigured}
            required
          />
          {error && <div className="login-error">{error}</div>}
          <button type="submit" disabled={!isSupabaseConfigured || cargando}>
            {cargando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  )
}
