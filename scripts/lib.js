// Cliente Supabase server-side (secret key) + utilidades comunes.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Carga simple de .env (sin dependencia externa)
function loadEnv() {
  try {
    const txt = readFileSync(new URL('./.env', import.meta.url), 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
      if (m) process.env[m[1]] ??= m[2]
    }
  } catch { /* .env opcional si ya está en el entorno */ }
}
loadEnv()

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SECRET_KEY (revisa scripts/.env)')
  process.exit(1)
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
})

// Parsea "S/ 1,285.50" -> 1285.5 ; "" -> null
export function money(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

// Inserta en lotes para no reventar el request
export async function insertChunked(tabla, filas, tam = 500) {
  let ok = 0
  for (let i = 0; i < filas.length; i += tam) {
    const lote = filas.slice(i, i + tam)
    const { error } = await supabase.from(tabla).insert(lote)
    if (error) { console.error(`  ✗ ${tabla} lote ${i}:`, error.message); throw error }
    ok += lote.length
    process.stdout.write(`\r  ${tabla}: ${ok}/${filas.length}`)
  }
  process.stdout.write('\n')
  return ok
}

export async function getSedeMap() {
  const { data, error } = await supabase.from('sedes').select('id, nombre')
  if (error) throw error
  const map = {}
  for (const s of data) map[s.nombre.toLowerCase()] = s.id
  return map
}
