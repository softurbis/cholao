// Parsea el PDF "PRODUCTOS VENDIDOS" del POS.
// Formato por línea: <CANT> <PRODUCTO> <P.U.> <IMP.>  agrupado por categoría.
// Ojo: los nombres largos se parten en 2 líneas y hay subtotales sueltos por categoría.

const num = (s) => { const n = Number(String(s).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null }
const RE_ITEM = /^(\d+)\s+(.+?)\s+([\d.,]+)\s+([\d.,]+)$/     // cant nombre pu imp
const RE_SOLO_NUM = /^[\d.,]+$/                                // subtotal de categoría
const RE_CATEGORIA = /^[A-ZÁÉÍÓÚÑ/ ]{3,}$/                     // encabezado de categoría

export function parseProductos(texto) {
  const t = String(texto || '')
  if (!/PRODUCTOS VENDIDOS/i.test(t)) return { ok: false, error: 'El PDF no parece el reporte de Productos Vendidos.' }

  const lineas = t.split('\n').map((l) => l.trim()).filter(Boolean)
  const items = []
  let categoria = null
  let buffer = null   // nombre partido en 2 líneas

  for (const l of lineas) {
    if (/^(PRODUCTO\s+CANT|==|DATOS DE IMPRESION|USUARIO:|FECHA:|_{3,}|-- \d)/i.test(l)) { buffer = null; continue }

    // ¿la línea (sola o unida al buffer) es un item completo?
    const cand = buffer ? `${buffer} ${l}` : l
    const m = cand.match(RE_ITEM)
    if (m) {
      items.push({
        categoria, cantidad: num(m[1]), producto: m[2].replace(/\s+/g, ' ').trim(),
        precio_unit: num(m[3]), importe: num(m[4]),
      })
      buffer = null
      continue
    }
    if (RE_SOLO_NUM.test(l)) { buffer = null; continue }          // subtotal
    if (!buffer && RE_CATEGORIA.test(l)) { categoria = l.trim(); continue }
    // línea incompleta -> empieza (o sigue) un nombre partido
    buffer = buffer ? `${buffer} ${l}` : (/^\d+\s/.test(l) ? l : null)
  }

  const total = items.reduce((a, x) => a + (x.importe || 0), 0)
  const unidades = items.reduce((a, x) => a + (x.cantidad || 0), 0)
  return { ok: true, items, total: Math.round(total * 100) / 100, unidades, usuario: (t.match(/USUARIO:\s*(.+)/i) || [])[1]?.trim() || null }
}

// Normaliza para comparar nombres ("Tres Leches Clásico" ~ "TRES LECHES CLASICO (VAINILLA)")
const tokens = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2)

// Cruza lo vendido según el POS con los productos que SÍ se controlan por stock.
// (No todos los productos vendidos tienen stock — solo se comparan los que están en el catálogo.)
export function cruzarConStock(itemsPdf, productosStock) {
  return productosStock.map((p) => {
    const tp = tokens(p.producto ?? p.nombre)
    const match = itemsPdf.filter((i) => { const ti = tokens(i.producto); return tp.length && tp.every((w) => ti.includes(w)) })
    const vendidoSistema = match.reduce((a, i) => a + (i.cantidad || 0), 0)
    return { ...p, vendido_sistema: match.length ? vendidoSistema : null, match: match.map((m) => m.producto) }
  })
}
