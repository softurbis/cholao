// Consulta el clima real de Pucallpa (open-meteo, gratis y sin API key)
// Se usa en el cierre para sugerir/validar el clima que pone el cajero.
const PUCALLPA = { lat: -8.3791, lon: -74.5539 }

// Códigos WMO -> nuestras 3 opciones
function mapClima(code) {
  if (code === 0 || code === 1) return 'Soleado'
  if (code === 2 || code === 3 || (code >= 45 && code <= 48)) return 'Nublado'
  return 'Lluvioso'   // llovizna, lluvia, chubascos, tormenta
}

export async function climaDe(fecha) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${PUCALLPA.lat}&longitude=${PUCALLPA.lon}` +
      `&daily=weather_code,temperature_2m_max,precipitation_sum&timezone=America%2FLima&start_date=${fecha}&end_date=${fecha}`
    const r = await fetch(url)
    if (!r.ok) return null
    const j = await r.json()
    const code = j?.daily?.weather_code?.[0]
    if (code == null) return null
    return {
      clima: mapClima(code),
      temp_max: j.daily.temperature_2m_max?.[0],
      lluvia_mm: j.daily.precipitation_sum?.[0],
    }
  } catch { return null }
}
