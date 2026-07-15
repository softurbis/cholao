import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [perfil, setPerfil] = useState(null)   // fila de la tabla perfiles (rol, sede, nombre)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) cargarPerfil(data.session.user.id)
      else setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s) cargarPerfil(s.user.id)
      else { setPerfil(null); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function cargarPerfil(userId) {
    setLoading(true)
    const { data } = await supabase
      .from('perfiles')
      .select('*, sede:sedes(id, nombre)')
      .eq('id', userId)
      .single()
    setPerfil(data || null)
    setLoading(false)
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut()
    setPerfil(null)
    setSession(null)
  }

  return (
    <AuthContext.Provider value={{ session, perfil, loading, isSupabaseConfigured, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
