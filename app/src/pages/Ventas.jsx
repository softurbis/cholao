import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Manual from '../components/Manual'

const num = (n) => Number(n || 0).toLocaleString('es-PE')

// Módulo VENTAS — todavía sin construir. Esta pantalla documenta qué debe hacer
// y qué falta, para armarlo después. (El detalle de ventas hoy vive a medias en
// el Panel —por mes— y en Caja Diaria —por turno—; aquí iría el detalle CRUDO,
// ticket a ticket, que hoy no tiene pantalla.)
export default function Ventas() {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    (async () => {
      const { count } = await supabase.from('ventas').select('*', { count: 'exact', head: true })
      const { data: sedes } = await supabase.from('sedes').select('id, nombre')
      const porSede = {}
      for (const s of (sedes || [])) {
        const { count: c } = await supabase.from('ventas').select('*', { count: 'exact', head: true }).eq('sede_id', s.id)
        porSede[s.nombre] = c || 0
      }
      setStats({ total: count || 0, porSede })
    })()
  }, [])

  return (
    <div className="pagina">
      <h1>💵 Ventas<Manual modulo="ventas" /></h1>
      <p className="pagina-sub">Módulo por construir. Aquí está todo lo que le falta, para armarlo después.</p>

      {stats && (
        <div className="tarjetas" style={{ marginBottom: 18 }}>
          <div className="tarjeta"><span className="t-label">Tickets cargados</span><span className="t-valor">{num(stats.total)}</span></div>
          {Object.entries(stats.porSede).map(([s, c]) => (
            <div className="tarjeta" key={s}><span className="t-label">{s}</span><span className="t-valor" style={{ fontSize: 20, color: c ? undefined : 'var(--rojo)' }}>{num(c)}</span></div>
          ))}
        </div>
      )}

      <div className="panel-detalle">
        <h3>🎯 Qué debe mostrar este módulo</h3>
        <ul className="lista-pend">
          <li><b>Detalle de ventas ticket a ticket</b> — lo crudo del sistema de ventas (fecha, hora, caja, canal, tipo de pago, monto). Hoy no tiene pantalla: ni el Panel (que va por mes) ni Caja Diaria (que va por turno) lo muestran.</li>
          <li><b>Ventas por día</b>, filtrables por sede, canal (salón/mostrador/delivery) y tipo de pago (efectivo/yape/tarjeta).</li>
          <li><b>Comparativo de ventas</b> — la venta <i>contada</i> (lo que dice la cajera) vs la del <i>sistema</i> vs el <i>POS real</i>. Sirve para pillar descuadres.</li>
          <li><b>Búsqueda</b> de un ticket puntual (por fecha, documento o monto).</li>
        </ul>
      </div>

      <div className="panel-detalle">
        <h3>📥 Qué datos faltan cargar</h3>
        <ul className="lista-pend">
          <li><b>Ventas de Miraflores</b> (ticket a ticket) — hoy tiene <b>0 tickets</b>. Solo Amazonas está cargado.</li>
          <li><b>Amazonas 2026</b> — solo está enero cargado en la tabla de tickets; faltan feb a jul (esos exports no se han subido).</li>
          <li><b>Uploads semanales</b> — un flujo para subir el export del sistema de ventas cada semana y que se acumule solo.</li>
        </ul>
        <p className="nota">Ojo: el <b>Panel</b> saca los ingresos de otra fuente (la venta del sistema por turno), por eso ahí sí se ven más meses de 2026 aunque acá los tickets no estén. Al construir Ventas hay que decidir cuál manda.</p>
      </div>

      <div className="panel-detalle">
        <h3>🔗 De dónde salen los datos</h3>
        <ul className="lista-pend">
          <li>Tabla <code>ventas</code> (columnas: sede, fecha, hora, caja, cliente, documento, canal, mesa, tipo de pago, total, estado).</li>
          <li>Se carga con el script <code>scripts/import_ventas_pos.js</code> desde el export del sistema de ventas actual.</li>
          <li>Estas ventas alimentan el cuadre de caja y el Panel.</li>
        </ul>
      </div>
    </div>
  )
}
