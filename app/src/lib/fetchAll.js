import { supabase } from './supabase'

// Trae TODAS las filas paginando de a 1000 (límite de PostgREST).
export async function fetchAll(tabla, select, orden = 'fecha') {
  const out = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.from(tabla).select(select)
      .order(orden, { ascending: false }).range(desde, desde + 999)
    if (error || !data || data.length === 0) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}
