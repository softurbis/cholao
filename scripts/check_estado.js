// Chequeo rápido del estado del sistema (migraciones y catálogos).
//   node check_estado.js
import { supabase } from './lib.js'

const { error: e1 } = await supabase.from('caja_turno').select('estado,base_inicial,voucher_url,clima_auto').limit(1)
console.log('sql/14 campos de fases :', e1 ? 'FALTA — ' + e1.message.slice(0, 60) : 'OK')

const { count: tg, error: e2 } = await supabase.from('tipos_gasto').select('*', { count: 'exact', head: true })
console.log('sql/14 tipos_gasto     :', e2 ? 'FALTA' : 'OK — ' + tg + ' tipos para la búsqueda rápida')

const { error: e3 } = await supabase.from('caja_stock').select('esperado,coincide').limit(1)
console.log('sql/14 stock coincide  :', e3 ? 'FALTA' : 'OK')

const { count: ab } = await supabase.from('caja_turno').select('*', { count: 'exact', head: true }).eq('estado', 'abierto')
console.log('Turnos abiertos ahora  :', ab, ab === 0 ? '(históricos cerrados ✓)' : '(hay uno en curso)')

const { data: top } = await supabase.from('tipos_gasto').select('nombre,veces').order('veces', { ascending: false }).limit(8)
if (top?.length) {
  console.log('\nGastos más frecuentes (aparecen primero al buscar):')
  for (const t of top) console.log('   ' + t.nombre + ' (' + t.veces + ')')
}

const { data: b } = await supabase.storage.listBuckets()
console.log('\nBucket arqueos         :', (b || []).some((x) => x.name === 'arqueos') ? 'OK' : 'FALTA')
