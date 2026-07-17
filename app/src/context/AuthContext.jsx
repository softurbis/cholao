import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [perfilReal, setPerfil] = useState(null)   // el perfil de verdad (rol, sede, nombre)
  const [loading, setLoading] = useState(true) // SOLO la carga inicial
  const userIdRef = useRef(null)               // usuario cuyo perfil ya está cargado

  // "Ver como": SOLO para el superusuario, para probar las ventanas de cada rol
  // sin cerrar sesión. OJO: cambia lo que MUESTRA la app (menús, accesos), NO los
  // datos — la sesión sigue siendo la del superusuario, así que en modo prueba se
  // siguen viendo todos los datos. Los permisos REALES los da la base (RLS).
  const [verComo, setVerComo] = useState(null)   // {rol, puede_gastos, puede_compras, label} o null
  const esSuperReal = perfilReal?.rol === 'superadmin'
  const perfil = (esSuperReal && verComo)
    ? { ...perfilReal, rol: verComo.rol, puede_gastos: !!verComo.puede_gastos, puede_compras: !!verComo.puede_compras }
    : perfilReal

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
    setVerComo(null)
  }

  return (
    <AuthContext.Provider value={{
      session, perfil, perfilReal, loading, isSupabaseConfigured, signIn, signOut,
      esSuperReal, verComo, setVerComo,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
