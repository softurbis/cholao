// Lee el texto de un PDF en el navegador (para el arqueo de caja del POS).
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export async function textoDePdf(file) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  let texto = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // Reconstruye líneas usando la posición Y de cada fragmento
    const lineas = {}
    for (const it of content.items) {
      const y = Math.round(it.transform[5])
      ;(lineas[y] ??= []).push(it.str)
    }
    texto += Object.keys(lineas).sort((a, b) => b - a).map((y) => lineas[y].join(' ')).join('\n') + '\n'
  }
  return texto
}
