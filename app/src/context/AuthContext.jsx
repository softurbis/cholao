import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [perfil, setPerfil] = useState(null)   // fila de la tabla perfiles (rol, sede, nombre)
  const [loading, setLoading] = useState(true) // SOLO la carga inicial
  const userIdRef = useRef(null)               // usuario cuyo perfil ya está cargado

  async function cargarPerfil(userId) {
    const { data } = await supabase
      .from('perfiles')
      .select('*, sede:sedes(id, nombre)')
      .eq('id', userId)
      .single()
    setPerfil(data || null)
  }

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return }

    // 1) Carga inicial
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) {
        userIdRef.current = data.session.user.id
        await cargarPerfil(data.session.user.id)
      }
      setLoading(false)
    })

    // 2) Cambios de sesión.
    // IMPORTANTE: al volver a la pestaña Supabase emite TOKEN_REFRESHED/SIGNED_IN del MISMO
    // usuario. Si ahí recargábamos el perfil, se activaba "Cargando…" y se desmontaba la
    // pantalla, perdiendo lo que estabas llenando (archivos del cierre). Por eso, si el
    // usuario no cambió, solo refrescamos la sesión y no tocamos loading ni el perfil.
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSession(s)
      if (!s) { userIdRef.current = null; setPerfil(null); return }
      if (userIdRef.current === s.user.id) return   // mismo usuario -> no recargar nada
      userIdRef.current = s.user.id
      cargarPerfil(s.user.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut()
    userIdRef.current = null
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
