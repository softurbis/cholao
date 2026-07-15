import { useAuth } from '../context/AuthContext'

export default function Dashboard() {
  const { perfil } = useAuth()
  return (
    <div className="pagina">
      <h1>Panel de control</h1>
      <p className="pagina-sub">Hola{perfil?.nombre ? `, ${perfil.nombre}` : ''}. Resumen en números de El Cholao.</p>
      <div className="tarjetas">
        <div className="tarjeta"><span className="t-label">Ventas de hoy</span><span className="t-valor">—</span></div>
        <div className="tarjeta"><span className="t-label">Yape + Plin hoy</span><span className="t-valor">—</span></div>
        <div className="tarjeta"><span className="t-label">Efectivo esperado</span><span className="t-valor">—</span></div>
        <div className="tarjeta"><span className="t-label">Descuadres del día</span><span className="t-valor">—</span></div>
      </div>
      <p className="nota">Los indicadores se llenan cuando conectemos el cuadre diario y las ventas.</p>
    </div>
  )
}
