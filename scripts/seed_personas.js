// Carga el maestro de personas (de "Horario EL CHOLAO.xlsx", snapshot mid-2025).
// Empleados de sede "General" (Juan, Marcelo) van con sede_id = null.
import { supabase, getSedeMap } from './lib.js'

const MAESTRO = [
  ['Milagros Marayma', 'Cocina',    '10:00 - 22:00', 'Amazonas',   1800],
  ['Yamile Paredes',   'Caja',      '10:00 - 22:00', 'Amazonas',   1700],
  ['Laura Tineo',      'Atencion',  '16:00 - 22:00', 'Amazonas',    850],
  ['Milagros Gonzales','Cocina',    '16:00 - 22:00', 'Amazonas',    850],
  ['Marllory',         'Cocina',    '16:00 - 22:00', 'Amazonas',    850],
  ['Karyme',           'Cocina',    '14:00 - 22:00', 'Bulevar',    1300],
  ['Francis',          'Seguridad', 'NOCTURNO',      'Bulevar',    1400],
  ['María Fernanda',   'Caja',      '14:00 - 22:00', 'Bulevar',    1300],
  ['Luz Maria',        'Atencion',  'Fin de Semana', 'Bulevar',     360],
  ['Moico Davila',     'Atencion',  'Fin de Semana', 'Bulevar',     360],
  ['Juan Orbe',        'Compras',   'COMPLETO',      'General',    1500],
  ['Berenice',         'Cocina',    '10:00 - 22:00', 'Miraflores', 1800],
  ['Ericka',           'Cocina',    '16:00 - 22:00', 'Miraflores',  850],
  ['Franck Riofrio',   'Cocina',    '10:00 - 22:00', 'Miraflores', 1600],
  ['Hermana Karyme',   'Cocina',    '16:00 - 22:00', 'Miraflores',  850],
  ['Marcelo',          'Delivery',  '10:00 - 22:00', 'General',    1100],
  ['Dulce',            'Atencion',  '16:00 - 22:00', 'Miraflores', 1500],
  ['Celina',           'Atencion',  '16:00 - 22:00', 'Miraflores',  850],
]

async function main() {
  const sedes = await getSedeMap()
  const filas = MAESTRO.map(([nombres, cargo, horario, sede, sueldo]) => ({
    nombres,
    cargo,
    sede_id: sedes[sede.toLowerCase()] || null,  // "General" -> null
    sueldo_base: sueldo,
    activo: true,
  }))
  // Evita duplicar si se re-corre: borra e inserta el maestro completo.
  const nombres = filas.map(f => f.nombres)
  await supabase.from('personas').delete().in('nombres', nombres)
  const { error } = await supabase.from('personas').insert(filas)
  if (error) { console.error('ERR:', error.message); process.exit(1) }
  console.log(`✓ ${filas.length} personas cargadas`)
  const { count } = await supabase.from('personas').select('*', { count: 'exact', head: true })
  console.log('Total personas en DB:', count)
}
main().catch(e => { console.error(e); process.exit(1) })
