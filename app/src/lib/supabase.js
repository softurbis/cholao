import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Permite que la app arranque aunque todavía no se hayan cargado las credenciales,
// mostrando una pantalla de configuración en vez de una pantalla en blanco.
export const isSupabaseConfigured = Boolean(url && key)

if (!isSupabaseConfigured) {
  console.warn('[Cholao] Falta VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env')
}

export const supabase = isSupabaseConfigured ? createClient(url, key) : null
