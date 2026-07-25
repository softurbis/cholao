import { useState } from 'react'
import { getManual } from '../manuales'

// Botón "❓ Manual" que va en el encabezado de cada módulo y despliega su
// instructivo. El contenido vive en `manuales/index.js`, junto al código, para que
// se actualice en el mismo cambio que la pantalla — y no quede un instructivo
// suelto que nadie mantiene.
//
// Es un panel en línea, no una ventana flotante: en el celular las ventanas
// flotantes tapan todo y cuesta cerrarlas.
export default function Manual({ modulo }) {
  const [abierto, setAbierto] = useState(false)
  const m = getManual(modulo)
  if (!m) return null

  return (
    <>
      <button type="button" className="man-btn" onClick={() => setAbierto(!abierto)}
        aria-expanded={abierto} title="Cómo se usa esta pantalla">
        {abierto ? '✕ Cerrar' : '❓ Manual'}
      </button>

      {abierto && (
        <div className="man-panel">
          <h2 className="man-titulo">{m.titulo}</h2>
          <p className="man-quien">Para: {m.paraQuien}</p>
          <p className="man-resumen">{m.resumen}</p>

          {m.pasos?.length > 0 && (
            <ol className="man-pasos">
              {m.pasos.map((p, i) => (
                <li key={i}>
                  <strong>{p.t}</strong>
                  <span>{p.d}</span>
                </li>
              ))}
            </ol>
          )}

          {m.ojo?.length > 0 && (
            <div className="man-ojo">
              <strong>Ojo con esto</strong>
              <ul>{m.ojo.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}

          {m.novedades?.length > 0 && (
            <details className="man-nov">
              <summary>Qué cambió últimamente ({m.novedades.length})</summary>
              <ul>
                {m.novedades.map((n, i) => (
                  <li key={i}><span className="man-fecha">{n.f}</span> {n.d}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </>
  )
}
