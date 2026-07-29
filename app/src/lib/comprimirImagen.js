// Achica las fotos ANTES de subirlas.
//
// Por qué: un celular saca fotos de 2 a 5 MB. Entre los vouchers de compras, los
// comprobantes de gastos y las selfies de asistencia (dos por persona y por día),
// eso llena el almacenamiento de Supabase en semanas y consume transferencia cada
// vez que alguien abre una. Para lo que sirven estas fotos —leer un voucher,
// reconocer una cara— con ~200 KB alcanza y se ven igual.
//
// Reglas de la casa:
//   · Si NO es imagen (un PDF de comprobante), se sube tal cual. No se toca.
//   · Si algo falla (un formato que el navegador no sabe decodificar, un celular
//     viejo), se sube la ORIGINAL. Comprimir no puede impedir que alguien
//     registre su gasto o marque su asistencia.
//   · Si el resultado no pesa menos que el original, se queda el original.

// Convierte "foto.HEIC" en "foto.jpg": al recomprimir siempre sale JPEG, y la
// extensión tiene que decir la verdad o después no abre.
function nombreJpg(nombre = 'foto') {
  return nombre.replace(/\.[^.]+$/, '') + '.jpg'
}

/**
 * @param {File} file            lo que eligió la persona
 * @param {object} opts
 * @param {number} opts.maxLado  lado mayor en píxeles (el resto se escala igual)
 * @param {number} opts.calidad  0 a 1
 * @returns {Promise<File>}      la comprimida, o la original si no se pudo/no convino
 */
export async function comprimirImagen(file, { maxLado = 1600, calidad = 0.7 } = {}) {
  if (!file || !file.type?.startsWith('image/')) return file

  try {
    // createImageBitmap y no `new Image()`: no depende de cargar una URL y
    // respeta la orientación EXIF, así las fotos verticales no salen tumbadas.
    // El segundo intento SIN opciones importa: hay navegadores que rechazan ese
    // parámetro, y sin esto la compresión se saltaría en silencio justo donde más
    // pesa —los celulares— y nadie se enteraría.
    let bitmap
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      bitmap = await createImageBitmap(file)
    }
    const lado = Math.max(bitmap.width, bitmap.height)
    const escala = Math.min(1, maxLado / lado)
    const w = Math.max(1, Math.round(bitmap.width * escala))
    const h = Math.max(1, Math.round(bitmap.height * escala))

    const lienzo = document.createElement('canvas')
    lienzo.width = w; lienzo.height = h
    const ctx = lienzo.getContext('2d')
    // Fondo blanco: un PNG con transparencia pasado a JPEG saldría con manchas negras.
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob = await new Promise((r) => lienzo.toBlob(r, 'image/jpeg', calidad))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], nombreJpg(file.name), { type: 'image/jpeg' })
  } catch {
    return file
  }
}

// Un voucher hay que poder LEERLO: se le deja más lado y más calidad que a una cara.
export const comprimirVoucher = (f) => comprimirImagen(f, { maxLado: 1600, calidad: 0.72 })

// Una selfie de asistencia solo tiene que dejar reconocer a la persona, y son las
// que más se acumulan (dos por persona cada día).
export const comprimirSelfie = (f) => comprimirImagen(f, { maxLado: 1000, calidad: 0.65 })
