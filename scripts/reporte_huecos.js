// =====================================================================
// Qué días de caja faltan, por sede y por mes.
//
// Un día "falta" cuando no tiene NINGÚN turno registrado. Ojo: eso no prueba
// que la tienda estuviera cerrada — solo que nadie registró. Hoy el sistema no
// sabe distinguir "no abrimos" de "no lo cargamos"; por eso el módulo de
// horarios (sql/22) lleva un campo `cerrado`.
//
//   node reporte_huecos.js
// =====================================================================
import { supabase } from './lib.js'

const sol = (v) => 'S/ ' + Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const HOY = '2026-07-17'

const { data: sedes } = await supabase.from('sedes').select('id, nombre, activo').order('nombre')
const nom = Object.fromEntries(sedes.map((s) => [s.id, s.nombre]))

let turnos = [], desde = 0
while (true) {
  const { data } = await supabase.from('caja_turno').select('sede_id, fecha, turno, venta_total, origen_archivo').range(desde, desde + 999)
  if (!data?.length) break
  turnos.push(...data); desde += 1000
  if (data.length < 1000) break
}

const diasDe = (mes) => new Date(+mes.slice(0, 4), +mes.slice(5, 7), 0).getDate()
const fechaStr = (mes, d) => `${mes}-${String(d).padStart(2, '0')}`

for (const s of sedes) {
  const mios = turnos.filter((t) => t.sede_id === s.id)
  if (!mios.length) { console.log(`\n\n████ ${s.nombre} — sin ningún turno registrado`); continue }

  const fechas = new Set(mios.map((t) => t.fecha))
  const meses = [...new Set(mios.map((t) => t.fecha.slice(0, 7)))].sort()
  const primero = mios.map((t) => t.fecha).sort()[0]
  const ultimo = mios.map((t) => t.fecha).sort().at(-1)

  console.log(`\n\n████████ ${s.nombre}${s.activo ? '' : '  (SEDE INACTIVA)'} ████████`)
  console.log(`${mios.length} turnos · del ${primero} al ${ultimo}`)
  if (ultimo < HOY) {
    const dias = Math.round((new Date(HOY) - new Date(ultimo)) / 864e5)
    if (dias > 2) console.log(`⚠️  ${dias} días sin registrar nada desde el último (${ultimo})`)
  }

  // Meses que faltan enteros, entre el primero y el último
  const todosLosMeses = []
  let [a, m] = primero.slice(0, 7).split('-').map(Number)
  const [aF, mF] = ultimo.slice(0, 7).split('-').map(Number)
  while (a < aF || (a === aF && m <= mF)) {
    todosLosMeses.push(`${a}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; a++ }
  }
  const sinNada = todosLosMeses.filter((x) => !meses.includes(x))
  if (sinNada.length) console.log(`\n🚫 MESES ENTEROS SIN NADA: ${sinNada.join(' · ')}`)

  console.log('')
  for (const mes of todosLosMeses) {
    if (sinNada.includes(mes)) continue
    const total = diasDe(mes)
    const faltan = []
    for (let d = 1; d <= total; d++) {
      const f = fechaStr(mes, d)
      if (f > HOY) break
      if (!fechas.has(f)) faltan.push(d)
    }
    const delMes = mios.filter((t) => t.fecha.startsWith(mes))
    const venta = delMes.reduce((acc, t) => acc + Number(t.venta_total || 0), 0)
    const conDatos = total - faltan.length
    const etiqueta = `${mes}  ${String(delMes.length).padStart(3)} turnos · ${conDatos}/${total} días · ${sol(venta).padStart(14)}`
    console.log(faltan.length ? `${etiqueta}\n         faltan los días: ${faltan.join(', ')}` : `${etiqueta}   ✅ completo`)
  }

  // De qué archivo salió cada mes: sirve para saber qué Excel volver a mirar
  console.log('\n   archivos por mes:')
  const porMes = {}
  for (const t of mios) {
    const k = t.fecha.slice(0, 7)
    porMes[k] = porMes[k] || new Set()
    porMes[k].add(t.origen_archivo || '(sin archivo)')
  }
  for (const [mes, arch] of Object.entries(porMes).sort()) {
    console.log(`     ${mes}: ${[...arch].join(' + ')}`)
  }
}
