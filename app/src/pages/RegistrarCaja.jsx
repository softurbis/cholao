import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { textoDePdf } from '../lib/leerPdf'
import { parseArqueo } from '../lib/parseArqueo'
import { parseProductos, cruzarConStock } from '../lib/parseProductos'
import { climaDe } from '../lib/clima'
import { puedeEditar } from '../lib/roles'
import Manual from '../components/Manual'

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const soles = (v) => 'S/ ' + Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n = (v) => Number(v) || 0

export default function RegistrarCaja() {
  const { perfil } = useAuth()
  // Borrar un turno se lleva sus comprobantes, que son justo la evidencia que
  // gerencia revisa al validar. La base ya lo impide para el resto (sql/21);
  // esto es para que la cajera no vea un botón que solo le daría un error.
  const puedeBorrar = puedeEditar(perfil)
  // Quién firma el turno. Para la cajera es SU nombre y no se toca: el campo era
  // libre y quedaron 33 nombres distintos para 18 personas (Yamile firmó de 8
  // formas: "YAMILE", "YAM", "YAMI PAREDES"…, y 25 turnos salieron sin nadie).
  // Con eso, saber quién cuadró una caja era imposible — y sin eso el control
  // de caja no controla nada.
  // Gerencia sí puede escribirlo: a veces registra un turno de otro o carga
  // atrasados, y ahí el nombre no es el suyo.
  const puedeElegirCajero = puedeEditar(perfil)
  const [turno, setTurno] = useState(null)          // turno abierto (fila de caja_turno)
  const [sedes, setSedes] = useState([])
  const [personas, setPersonas] = useState([])
  const [tiposGasto, setTiposGasto] = useState([])
  const [prodCat, setProdCat] = useState([])
  const [metas, setMetas] = useState([])
  const [msg, setMsg] = useState(null)              // {tipo:'ok'|'err', texto}
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState(false)

  // datos del turno abierto
  const [gastos, setGastos] = useState([])
  const [descs, setDescs] = useState([])
  const [stock, setStock] = useState([])
  const [movs, setMovs] = useState([])           // adiciones / mermas del turno
  const [pendientes, setPendientes] = useState([]) // traslados que otra sede me envió

  // apertura
  // Sin turno por defecto: lo pone la sede cuando se elige (ver el efecto de
  // abajo). El default 'manana' de antes era el turno equivocado en cualquier
  // sede que no trabaje mañanas.
  const [ap, setAp] = useState({ sede_id: '', fecha: fmt(new Date()), turno: '', cajero: '', base_inicial: '' })
  const [sedeTurnos, setSedeTurnos] = useState([])
  const [stockIni, setStockIni] = useState([])

  // cierre
  const [ci, setCi] = useState({ clima: '', observaciones: '', efectivo_contado: '' })
  const [arqueo, setArqueo] = useState(null)        // valores leídos del PDF (editables)
  const [arqueoOrig, setArqueoOrig] = useState(null) // lo que decía el PDF (nunca se toca)
  const [prodPdf, setProdPdf] = useState(null)      // PDF de productos vendidos
  const [adjuntos, setAdjuntos] = useState([])      // [{tipo, file}] a subir
  const [climaAuto, setClimaAuto] = useState(null)
  const [fase, setFase] = useState('turno')         // turno | cierre

  const setArq = (campo, valor) => setArqueo((a) => ({ ...a, [campo]: valor === '' ? '' : Number(valor) }))

  const aviso = (tipo, texto) => { setMsg({ tipo, texto }); setTimeout(() => setMsg(null), 5000) }

  // Los turnos que trabaja la sede elegida, en su orden.
  const turnosSede = useMemo(
    () => sedeTurnos.filter((t) => t.sede_id === ap.sede_id).sort((a, b) => a.orden - b.orden),
    [sedeTurnos, ap.sede_id]
  )

  // Cómo se llama un turno, según la sede. Se busca por código porque eso es lo
  // que guarda caja_turno.turno. Si no está configurado (turnos históricos como
  // las letras viejas), se muestra el código crudo en vez de mentir con "Tarde".
  const nombreTurno = (codigo, sedeId) =>
    sedeTurnos.find((t) => t.sede_id === (sedeId || ap.sede_id) && t.codigo === codigo)?.nombre || codigo

  // Al cambiar de sede, el turno elegido puede no existir ahí (Amazonas trabaja
  // 'tarde', Miraflores no). Se preselecciona el que toca por la hora: si son
  // las 4pm, el turno de tarde. Eso es un toque menos en el celular y, sobre
  // todo, evita el error de etiqueta — que es justo el que ensució el histórico.
  useEffect(() => {
    if (!turnosSede.length) return
    if (turnosSede.some((t) => t.codigo === ap.turno)) return   // el actual sirve
    const ahora = new Date().toTimeString().slice(0, 5)
    const porHora = turnosSede.find((t) => t.hora_inicio && t.hora_fin
      && String(t.hora_inicio).slice(0, 5) <= ahora && ahora < String(t.hora_fin).slice(0, 5))
    setAp((a) => ({ ...a, turno: (porHora || turnosSede[0]).codigo }))
  }, [turnosSede])   // eslint-disable-line react-hooks/exhaustive-deps

  async function cargarTodo() {
    const [{ data: s }, { data: p }, { data: tg }, { data: pc }, { data: m }, { data: st }] = await Promise.all([
      supabase.from('sedes').select('id, nombre').eq('activo', true).order('nombre'),
      // vista_personal y no `personas`: esa tabla lleva sueldo_base y quedó solo
      // para gerencia (sql/21). La vista trae lo mismo sin el sueldo, que es lo
      // único que hace falta acá — poner nombres en los adelantos.
      supabase.from('vista_personal').select('nombres').eq('activo', true).order('nombres'),
      supabase.from('tipos_gasto').select('*').eq('activo', true).order('veces', { ascending: false }),
      supabase.from('productos_stock').select('*').eq('activo', true).order('orden'),
      supabase.from('caja_metas').select('*'),
      supabase.from('sede_turnos').select('*').eq('activo', true).order('orden'),
    ])
    setSedes(s || []); setPersonas(p || []); setTiposGasto(tg || []); setProdCat(pc || []); setMetas(m || [])
    setSedeTurnos(st || [])
    const sedeDef = perfil?.sede?.id || s?.[0]?.id || ''
    setAp((a) => ({ ...a, sede_id: a.sede_id || sedeDef, cajero: a.cajero || perfil?.nombre || '' }))

    // ¿hay un turno abierto?
    const { data: ab } = await supabase.from('caja_turno').select('*, sede:sedes(nombre)')
      .eq('estado', 'abierto').order('abierto_en', { ascending: false }).limit(1)
    if (ab?.[0]) { setTurno(ab[0]); await cargarHijos(ab[0].id); await cargarPendientes(ab[0].sede_id) } else setTurno(null)
    setCargando(false)
  }
  async function cargarHijos(tid) {
    const [{ data: g }, { data: d }, { data: st }, { data: mv }] = await Promise.all([
      supabase.from('caja_gastos').select('*').eq('turno_id', tid),
      supabase.from('caja_descuentos').select('*').eq('turno_id', tid),
      supabase.from('caja_stock').select('*').eq('turno_id', tid),
      supabase.from('caja_stock_mov').select('*').eq('turno_id', tid).order('created_at'),
    ])
    setGastos(g || []); setDescs(d || []); setStock(st || []); setMovs(mv || [])
  }

  // Movimiento de stock durante el turno: adición, merma o salida (traslado a otra sede)
  async function addMov(m) {
    const esTraslado = m.tipo === 'salida' && m.sede_destino_id
    const cant = m.tipo === 'adicion' ? Math.abs(n(m.cantidad)) : -Math.abs(n(m.cantidad))
    const { data, error } = await supabase.from('caja_stock_mov').insert({
      turno_id: turno.id, producto: m.producto, tipo: m.tipo,
      cantidad: cant, motivo: m.motivo || null, registrado_por: perfil?.id || null,
      sede_origen_id: turno.sede_id,
      sede_destino_id: m.sede_destino_id || null,
      aceptado: esTraslado ? false : null,   // queda pendiente hasta que el destino lo reciba
    }).select().single()
    if (error) { aviso('err', error.message); return }
    setMovs((p) => [...p, data])
    if (esTraslado) {
      const dest = sedes.find((s) => s.id === m.sede_destino_id)?.nombre
      aviso('ok', `📤 Enviado a ${dest}: ${Math.abs(n(m.cantidad))} ${m.producto}. Queda pendiente hasta que lo reciban.`)
    }
    // actualiza el acumulado del producto
    const fila = stock.find((s) => s.producto === m.producto)
    if (fila) {
      const campo = m.tipo === 'adicion' ? 'adicion' : m.tipo === 'merma' ? 'merma' : 'salida'
      const nuevo = n(fila[campo]) + Math.abs(n(m.cantidad))
      await supabase.from('caja_stock').update({ [campo]: nuevo }).eq('id', fila.id)
      setStock((p) => p.map((s) => s.id === fila.id ? { ...s, [campo]: nuevo } : s))
    }
    aviso('ok', `📦 ${m.tipo === 'adicion' ? 'Adición' : 'Merma'} registrada: ${m.producto}`)
  }
  // Traslados que otra sede me envió y aún no recibo
  async function cargarPendientes(sedeId) {
    if (!sedeId) return setPendientes([])
    const { data } = await supabase.from('caja_stock_mov')
      .select('*, origen:sedes!caja_stock_mov_sede_origen_id_fkey(nombre)')
      .eq('sede_destino_id', sedeId).eq('aceptado', false)
    setPendientes(data || [])
  }

  // Acepto el traslado -> me entra como adición en mi turno
  async function aceptarTraslado(t) {
    const cant = Math.abs(n(t.cantidad))
    const { data, error } = await supabase.from('caja_stock_mov').insert({
      turno_id: turno.id, producto: t.producto, tipo: 'adicion', cantidad: cant,
      motivo: `Traslado de ${t.origen?.nombre || 'otra sede'}`,
      registrado_por: perfil?.id || null, mov_origen_id: t.id, sede_origen_id: t.sede_origen_id,
    }).select().single()
    if (error) { aviso('err', error.message); return }
    await supabase.from('caja_stock_mov').update({ aceptado: true, aceptado_en: new Date().toISOString() }).eq('id', t.id)
    setMovs((p) => [...p, data])
    setPendientes((p) => p.filter((x) => x.id !== t.id))

    // suma al stock del producto (si no lo tengo en la lista, lo agrego)
    const fila = stock.find((s) => s.producto === t.producto)
    if (fila) {
      const nuevo = n(fila.adicion) + cant
      await supabase.from('caja_stock').update({ adicion: nuevo }).eq('id', fila.id)
      setStock((p) => p.map((s) => s.id === fila.id ? { ...s, adicion: nuevo } : s))
    } else {
      const { data: nf } = await supabase.from('caja_stock')
        .insert({ turno_id: turno.id, producto: t.producto, inicio: 0, adicion: cant, merma: 0, salida: 0 }).select().single()
      if (nf) setStock((p) => [...p, nf])
    }
    aviso('ok', `📥 Recibido: ${cant} ${t.producto}`)
  }

  async function delMov(mv) {
    await supabase.from('caja_stock_mov').delete().eq('id', mv.id)
    setMovs((p) => p.filter((x) => x.id !== mv.id))
    const fila = stock.find((s) => s.producto === mv.producto)
    if (fila) {
      const campo = mv.tipo === 'adicion' ? 'adicion' : mv.tipo === 'merma' ? 'merma' : 'salida'
      const nuevo = Math.max(0, n(fila[campo]) - Math.abs(n(mv.cantidad)))
      await supabase.from('caja_stock').update({ [campo]: nuevo }).eq('id', fila.id)
      setStock((p) => p.map((s) => s.id === fila.id ? { ...s, [campo]: nuevo } : s))
    }
  }
  useEffect(() => { cargarTodo() }, [perfil])

  // Stock inicial: catálogo de la sede + lo que dejó el turno anterior (para detectar mermas)
  useEffect(() => {
    (async () => {
      const lista = prodCat.filter((p) => !p.sede_id || p.sede_id === ap.sede_id)
      let previo = {}
      if (ap.sede_id && ap.fecha) {
        const { data } = await supabase.rpc('stock_esperado_apertura', { p_sede: ap.sede_id, p_fecha: ap.fecha })
        for (const r of data || []) previo[r.producto] = Number(r.cierre_anterior)
      }
      setStockIni(lista.map((p) => ({
        producto: p.nombre,
        esperado: previo[p.nombre] ?? null,     // con cuánto debería abrir
        inicio: previo[p.nombre] != null ? String(previo[p.nombre]) : '',  // se precarga, se puede corregir
        motivo: '',
      })))
    })()
  }, [prodCat, ap.sede_id, ap.fecha])

  const meta = useMemo(() => {
    if (!turno) return null
    const dia = DIAS[new Date(turno.fecha + 'T12:00').getDay()]
    return metas.find((m) => m.sede_id === turno.sede_id && m.dia_semana === dia && m.turno === turno.turno)?.meta
  }, [metas, turno])

  const totGastos = gastos.reduce((a, x) => a + n(x.monto), 0)
  const totDescs = descs.reduce((a, x) => a + n(x.monto), 0)

  // Cruza el stock con lo que el PDF de productos dice que se vendió
  const stockCruzado = useMemo(
    () => prodPdf ? cruzarConStock(prodPdf.items, stock) : stock.map((s) => ({ ...s, vendido_sistema: null })),
    [prodPdf, stock])

  // Los 3 documentos obligatorios para poder cerrar
  const tieneVoucher = adjuntos.some((a) => a.tipo === 'voucher')
  const faltantes = [!arqueo && 'arqueo', !prodPdf && 'productos vendidos', !tieneVoucher && 'foto del POS'].filter(Boolean)
  const listo = faltantes.length === 0

  // Campos del arqueo que se pueden editar, y detección de los que ya no coinciden con el PDF
  const CAMPOS_ARQ = [
    ['venta_sistema', 'Venta del sistema'], ['sis_efectivo', 'Efectivo'],
    ['sis_tarjeta', 'Tarjeta'], ['sis_yape', 'Yape'], ['diferencia_pos', 'Faltante POS'],
  ]
  const editados = useMemo(() => {
    if (!arqueo || !arqueoOrig) return []
    return CAMPOS_ARQ
      .filter(([k]) => n(arqueo[k]) !== n(arqueoOrig[k]))
      .map(([k, label]) => ({ campo: k, label, pdf: n(arqueoOrig[k]), puesto: n(arqueo[k]) }))
  }, [arqueo, arqueoOrig])

  // ---------- FASE 1: APERTURA ----------
  async function abrirCaja() {
    // El cajero se toma del perfil, no del formulario, salvo que sea gerencia
    // registrando por otro. Así no depende de lo que se haya tecleado —ni de que
    // se haya tecleado algo: 25 turnos históricos quedaron sin cajero.
    const cajero = (puedeElegirCajero ? ap.cajero : perfil?.nombre)?.trim()
    if (!ap.sede_id || !cajero) { aviso('err', 'Falta sede o cajero'); return }
    if (!ap.turno) { aviso('err', 'Esta sede no tiene turnos configurados. Configúralos en Sedes.'); return }
    const sinMotivo = stockIni.filter((s) => s.esperado != null && s.inicio !== '' && n(s.inicio) !== s.esperado && !s.motivo)
    if (sinMotivo.length) { aviso('err', 'Indica el motivo de la diferencia en: ' + sinMotivo.map((s) => s.producto).join(', ')); return }
    setOcupado(true)
    const { data, error } = await supabase.from('caja_turno').upsert({
      sede_id: ap.sede_id, fecha: ap.fecha, turno: ap.turno, cajero,
      // El turno queda enlazado a la config de la sede, no solo a la etiqueta.
      turno_id: turnosSede.find((t) => t.codigo === ap.turno)?.id || null,
      base_inicial: n(ap.base_inicial), estado: 'abierto', abierto_en: new Date().toISOString(),
      abierto_por: perfil?.id || null, origen_archivo: 'registro-app',
    }, { onConflict: 'sede_id,fecha,turno' }).select().single()
    if (error) { aviso('err', error.message); setOcupado(false); return }
    const st = stockIni.filter((x) => x.inicio !== '').map((x) => ({
      turno_id: data.id, producto: x.producto, inicio: n(x.inicio),
      esperado_apertura: x.esperado ?? null, adicion: 0, merma: 0, salida: 0,
    }))
    await supabase.from('caja_stock').delete().eq('turno_id', data.id)
    if (st.length) await supabase.from('caja_stock').insert(st)

    // Deja registrada cada diferencia contra lo que dejó el turno anterior
    const ajustes = stockIni
      .filter((x) => x.esperado != null && x.inicio !== '' && n(x.inicio) !== x.esperado)
      .map((x) => ({
        turno_id: data.id, producto: x.producto, tipo: 'ajuste_apertura',
        cantidad: n(x.inicio) - x.esperado, motivo: x.motivo, registrado_por: perfil?.id || null,
      }))
    if (ajustes.length) await supabase.from('caja_stock_mov').insert(ajustes)

    setTurno(data); await cargarHijos(data.id); setOcupado(false)
    aviso('ok', `✅ Caja abierta${ajustes.length ? ` (${ajustes.length} diferencia(s) registrada(s))` : ''}. Ya puedes registrar gastos y adelantos.`)
  }

  // ---------- FASE 2: MOVIMIENTOS ----------
  async function addGasto(g) {
    const { data, error } = await supabase.from('caja_gastos')
      .insert({ turno_id: turno.id, descripcion: g.descripcion, monto: n(g.monto), detalle: g.detalle }).select().single()
    if (error) { aviso('err', error.message); return }
    setGastos((p) => [...p, data])
    // sube frecuencia del tipo de gasto (para que aparezca primero la próxima vez)
    const t = tiposGasto.find((t) => t.nombre === g.descripcion.toUpperCase())
    if (t) await supabase.from('tipos_gasto').update({ veces: (t.veces || 0) + 1 }).eq('id', t.id)
    else { const { data: nt } = await supabase.from('tipos_gasto').insert({ nombre: g.descripcion.toUpperCase(), detalle: g.detalle, veces: 1 }).select().single(); if (nt) setTiposGasto((p) => [...p, nt]) }
  }
  async function addDesc(d) {
    const { data, error } = await supabase.from('caja_descuentos')
      .insert({ turno_id: turno.id, persona: d.persona, monto: n(d.monto), tipo: d.tipo }).select().single()
    if (error) { aviso('err', error.message); return }
    setDescs((p) => [...p, data])
  }
  async function delFila(tabla, id, setter) {
    await supabase.from(tabla).delete().eq('id', id)
    setter((p) => p.filter((x) => x.id !== id))
  }

  // Elimina el turno completo (gastos, adelantos, stock y archivos). Útil para pruebas.
  async function eliminarTurno() {
    if (!confirm('¿Eliminar este turno con TODO lo registrado (gastos, adelantos, stock y archivos)?\nNo se puede deshacer.')) return
    setOcupado(true)
    const { data: adj } = await supabase.from('caja_adjuntos').select('archivo').eq('turno_id', turno.id)
    if (adj?.length) await supabase.storage.from('arqueos').remove(adj.map((a) => a.archivo))
    const { error } = await supabase.from('caja_turno').delete().eq('id', turno.id)   // hijos por cascade
    setOcupado(false)
    if (error) { aviso('err', error.message); return }
    aviso('ok', '🗑️ Turno eliminado')
    setTurno(null); setArqueo(null); setProdPdf(null); setAdjuntos([]); setFase('turno')
    setCi({ clima: '', observaciones: '', efectivo_contado: '' })
    cargarTodo()
  }

  // ---------- FASE 3: CIERRE ----------
  // El PDF de arqueo se lee y llena los montos (que quedan editables)
  async function subirArqueo(file) {
    setOcupado(true)
    try {
      const texto = await textoDePdf(file)
      const d = parseArqueo(texto)
      if (!d.ok) { aviso('err', d.error); setOcupado(false); return }
      setArqueo(d)
      setArqueoOrig(d)   // se guarda lo que dijo el PDF para detectar cambios
      setAdjuntos((p) => [...p.filter((x) => x.tipo !== 'arqueo'), { tipo: 'arqueo', file }])
      if (!ci.efectivo_contado) setCi((c) => ({ ...c, efectivo_contado: d.efectivo_en_cierre ?? '' }))
      aviso('ok', `📄 Arqueo leído: venta del sistema ${soles(d.venta_sistema)} (puedes corregir los montos)`)
    } catch (e) { aviso('err', 'No pude leer el PDF: ' + e.message) }
    setOcupado(false)
  }
  function addAdjunto(tipo, file) {
    if (!file) return
    setAdjuntos((p) => [...p.filter((x) => x.tipo !== tipo || tipo === 'factura'), { tipo, file }])
    aviso('ok', `📎 ${file.name} adjuntado`)
  }

  // PDF "PRODUCTOS VENDIDOS": trae lo que el sistema dice que se vendió de cada producto
  async function subirProductos(file) {
    setOcupado(true)
    try {
      const d = parseProductos(await textoDePdf(file))
      if (!d.ok) { aviso('err', d.error); setOcupado(false); return }
      setProdPdf(d)
      setAdjuntos((p) => [...p.filter((x) => x.tipo !== 'ventas'), { tipo: 'ventas', file }])
      aviso('ok', `📄 ${d.items.length} productos leídos (S/ ${d.total}) — comparando con tu stock`)
    } catch (e) { aviso('err', 'No pude leer el PDF: ' + e.message) }
    setOcupado(false)
  }
  const quitarAdjunto = (i) => setAdjuntos((p) => p.filter((_, j) => j !== i))

  // Mensaje de WhatsApp con el resumen del turno
  function enviarWsp() {
    const txt = [
      `*CIERRE DE CAJA — ${turno.sede?.nombre || ''}*`,
      `${turno.fecha} · ${nombreTurno(turno.turno, turno.sede_id)} · ${turno.cajero}`,
      ``,
      `Venta del sistema: ${soles(arqueo?.venta_sistema)}`,
      `Efectivo: ${soles(arqueo?.sis_efectivo)} | Tarjeta: ${soles(arqueo?.sis_tarjeta)} | Yape: ${soles(arqueo?.sis_yape)}`,
      `Gastos: ${soles(totGastos)} | Adelantos: ${soles(totDescs)}`,
      meta ? `Meta: ${soles(meta)} → ${rendimiento || '—'}` : '',
      `Faltante POS: ${soles(faltantePos)} → ${Math.abs(descuadre) < 0.5 ? '✅ CUADRA' : `⚠️ descuadre ${soles(Math.abs(descuadre))}`}`,
      ci.clima ? `Clima: ${ci.clima}` : '',
      ...(editados.length ? ['', '⚠️ *MONTOS EDITADOS vs PDF:*', ...editados.map((e) => `• ${e.label}: PDF ${soles(e.pdf)} → ${soles(e.puesto)}`)] : []),
      ``,
      `Ver sistema: ${window.location.origin}${window.location.pathname}`,
    ].filter(Boolean).join('\n')
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank')
  }

  async function verClima() {
    const c = await climaDe(turno.fecha)
    if (c) { setClimaAuto(c); setCi((x) => ({ ...x, clima: x.clima || c.clima })) }
    else aviso('err', 'No pude consultar el clima')
  }
  useEffect(() => { if (fase === 'cierre' && turno && !climaAuto) verClima() }, [fase, turno])

  const rendimiento = useMemo(() => {
    if (!arqueo?.venta_sistema || !meta) return null
    const p = (arqueo.venta_sistema / meta) * 100
    return p >= 100 ? 'Buen turno' : p >= 70 ? 'Turno regular' : 'Turno bajo'
  }, [arqueo, meta])

  // el faltante del POS debería explicarse con los gastos + adelantos del turno
  const faltantePos = Math.abs(n(arqueo?.diferencia_pos))
  const explicado = totGastos + totDescs
  const descuadre = faltantePos - explicado

  async function cerrarTurno() {
    if (!listo) { aviso('err', 'Faltan documentos obligatorios: ' + faltantes.join(', ')); return }
    setOcupado(true)
    // sube todos los adjuntos (arqueo, 2º reporte, voucher foto, facturas)
    let primeroArqueo = null
    for (const a of adjuntos) {
      const ext = (a.file.name.split('.').pop() || 'bin').toLowerCase()
      const ruta = `${turno.fecha}/${turno.sede_id}-${turno.turno}-${a.tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const { error: eUp } = await supabase.storage.from('arqueos').upload(ruta, a.file, { contentType: a.file.type || undefined, upsert: true })
      if (eUp) { aviso('err', 'No pude subir ' + a.file.name + ': ' + eUp.message); continue }
      await supabase.from('caja_adjuntos').insert({
        turno_id: turno.id, tipo: a.tipo, archivo: ruta, nombre: a.file.name,
        mime: a.file.type || null, subido_por: perfil?.id || null,
      })
      if (a.tipo === 'arqueo' && !primeroArqueo) primeroArqueo = ruta
    }
    const ventaTotal = n(arqueo.venta_sistema)
    const { error } = await supabase.from('caja_turno').update({
      estado: 'cerrado', cerrado_en: new Date().toISOString(),
      tarjeta: n(arqueo.sis_tarjeta), plin: n(arqueo.sis_plin),
      yape_total: n(arqueo.sis_yape), yape_qr: n(arqueo.sis_yape),
      efectivo: n(ci.efectivo_contado || arqueo.efectivo_en_cierre),
      gastos_tienda: totGastos, venta_sistema: ventaTotal, venta_total: ventaTotal,
      deficit_sobra: -descuadre, meta_turno: meta ?? null,
      rendimiento, clima: ci.clima || null, clima_auto: climaAuto?.clima || null,
      observaciones: ci.observaciones || null, voucher_url: primeroArqueo,
      // evidencia: qué montos se cambiaron respecto al PDF
      montos_editados: editados.length
        ? Object.fromEntries(editados.map((e) => [e.campo, { pdf: e.pdf, puesto: e.puesto }]))
        : null,
    }).eq('id', turno.id)
    if (error) { aviso('err', error.message); setOcupado(false); return }
    // stock: cierre + vendido (descontando merma) + comparación con el sistema
    for (const s of stockCruzado) {
      const vendido = n(s.inicio) + n(s.adicion) - n(s.merma) - n(s.salida) - n(s.cierre)
      await supabase.from('caja_stock').update({
        cierre: n(s.cierre), vendido, adicion: n(s.adicion), salida: n(s.salida),
        venta_sistema: s.vendido_sistema ?? null,
        esperado: s.vendido_sistema ?? null,
        coincide: s.vendido_sistema == null ? null : vendido === s.vendido_sistema,
      }).eq('id', s.id)
    }
    setOcupado(false)
    aviso('ok', '✅ Turno cerrado correctamente')
    setTimeout(() => { setTurno(null); setArqueo(null); setAdjuntos([]); setFase('turno'); setCi({ clima: '', observaciones: '', efectivo_contado: '' }); cargarTodo() }, 1200)
  }

  if (cargando) return <div className="pagina"><h1>Caja</h1><p className="nota">Cargando…</p></div>

  return (
    <div className="pagina">
      <div className="pasos">
        <div className={`paso ${!turno ? 'activo' : 'ok'}`}><b>1</b> Apertura</div>
        <div className={`paso ${turno && fase === 'turno' ? 'activo' : turno ? 'ok' : ''}`}><b>2</b> Turno</div>
        <div className={`paso ${turno && fase === 'cierre' ? 'activo' : ''}`}><b>3</b> Cierre</div>
      </div>

      {msg && <div className={msg.tipo === 'ok' ? 'aviso-ok' : 'alerta'}>{msg.texto}</div>}

      {/* ---------------- FASE 1 ---------------- */}
      {!turno && (<>
        <h1>Apertura de caja<Manual modulo="registro" /></h1>
        <p className="pagina-sub">Abre el turno con tu nombre, la base de caja y el stock inicial.</p>
        <div className="filtros">
          <label className="campo"><span>Sede</span><select value={ap.sede_id} onChange={(e) => setAp({ ...ap, sede_id: e.target.value })}>{sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></label>
          <label className="campo"><span>Fecha</span><input type="date" value={ap.fecha} onChange={(e) => setAp({ ...ap, fecha: e.target.value })} /></label>
          {/* Los turnos salen de la sede (sql/22), no de dos opciones fijas.
              Antes esto ofrecía siempre Mañana/Tarde: en Miraflores, que trabaja
              un turno solo, elegir "Mañana" era elegir un turno inexistente. */}
          <label className="campo"><span>Turno</span>
            <select value={ap.turno} onChange={(e) => setAp({ ...ap, turno: e.target.value })}
              disabled={turnosSede.length <= 1}>
              {turnosSede.map((t, i) => (
                <option key={t.id} value={t.codigo}>
                  {t.nombre}{turnosSede.length > 1 ? ` (${i + 1}º turno)` : ''}
                  {t.hora_inicio ? ` · ${String(t.hora_inicio).slice(0, 5)}` : ''}
                </option>
              ))}
              {!turnosSede.length && <option value="">— sin turnos configurados —</option>}
            </select>
          </label>
          <label className="campo"><span>Cajero</span>
            {puedeElegirCajero ? (
              <input value={ap.cajero} onChange={(e) => setAp({ ...ap, cajero: e.target.value })}
                list="lista-personal" placeholder="Quién cuadra esta caja" />
            ) : (
              // No es un input deshabilitado por capricho: es tu turno y lo
              // firmas tú. Si hace falta que lo firme otro, que lo abra con su
              // usuario — que es justo el punto del PIN.
              <input value={perfil?.nombre || ''} readOnly title="Se firma con tu usuario" />
            )}
          </label>
          <datalist id="lista-personal">
            {personas.map((p) => <option key={p.nombres} value={p.nombres} />)}
          </datalist>
          <label className="campo"><span>Base de caja (S/)</span><input type="number" value={ap.base_inicial} onChange={(e) => setAp({ ...ap, base_inicial: e.target.value })} /></label>
        </div>

        <div className="seccion">
          <h2 className="sub-titulo">📦 Stock inicial <span className="nota">— cuenta y declara si algo no está</span></h2>
          <table className="tabla">
            <thead><tr><th>Producto</th><th>Dejó turno anterior</th><th style={{ width: 120 }}>Cuenta real</th><th>Diferencia</th><th>Motivo</th></tr></thead>
            <tbody>
              {stockIni.map((s, i) => {
                const dif = s.esperado == null || s.inicio === '' ? null : n(s.inicio) - s.esperado
                return (
                  <tr key={s.producto} className={dif ? 'fila-edit' : ''}>
                    <td><strong>{s.producto}</strong></td>
                    <td>{s.esperado ?? <span className="nota">—</span>}</td>
                    <td><input type="number" className="in-num" value={s.inicio}
                      onChange={(e) => setStockIni(stockIni.map((r, j) => j === i ? { ...r, inicio: e.target.value } : r))} /></td>
                    <td style={{ color: dif ? 'var(--rojo)' : 'inherit', fontWeight: dif ? 700 : 400 }}>
                      {dif == null ? '—' : dif === 0 ? '✓' : (dif > 0 ? '+' + dif : dif)}
                    </td>
                    <td>
                      {dif ? (
                        <select value={s.motivo} onChange={(e) => setStockIni(stockIni.map((r, j) => j === i ? { ...r, motivo: e.target.value } : r))}>
                          <option value="">¿Por qué? *</option>
                          <option value="MERMA">Merma (se malogró)</option>
                          <option value="FALTANTE">Faltante (no está)</option>
                          <option value="SOBRANTE">Sobrante (hay de más)</option>
                          <option value="MAL CONTEO ANTERIOR">Mal conteo del turno anterior</option>
                          <option value="OTRO">Otro</option>
                        </select>
                      ) : <span className="nota">—</span>}
                    </td>
                  </tr>
                )
              })}
              {stockIni.length === 0 && <tr><td colSpan="5" className="nota">Sin productos. Agrégalos en Configuración.</td></tr>}
            </tbody>
          </table>
          {stockIni.some((s) => s.esperado != null && s.inicio !== '' && n(s.inicio) !== s.esperado && !s.motivo) &&
            <p className="nota" style={{ color: 'var(--rojo)' }}>⚠️ Hay diferencias sin motivo. Elige el motivo para poder abrir.</p>}
        </div>
        <div style={{ marginTop: 18 }}><button className="btn-guardar" onClick={abrirCaja} disabled={ocupado}>{ocupado ? 'Abriendo…' : '🔓 Abrir caja'}</button></div>
      </>)}

      {/* ---------------- FASE 2 ---------------- */}
      {turno && fase === 'turno' && (<>
        <h1>Turno abierto <span className="titulo-tag">{turno.sede?.nombre}</span></h1>
        <p className="pagina-sub">
          {turno.cajero} · {turno.fecha} · {nombreTurno(turno.turno, turno.sede_id)} · Base {soles(turno.base_inicial)}
          {meta ? ` · Meta ${soles(meta)}` : ''}
        </p>
        <div className="dos-cols">
          <MovBloque titulo="🛒 Gastos de tienda" total={totGastos} onAdd={addGasto} tipos={tiposGasto} modo="gasto"
            filas={gastos.map((g) => ({ id: g.id, a: g.descripcion, b: g.monto, c: g.detalle }))}
            onDel={(id) => delFila('caja_gastos', id, setGastos)} />
          <MovBloque titulo="👥 Adelantos / descuentos" total={totDescs} onAdd={addDesc} personas={personas} modo="desc"
            filas={descs.map((d) => ({ id: d.id, a: d.persona, b: d.monto, c: d.tipo }))}
            onDel={(id) => delFila('caja_descuentos', id, setDescs)} />
        </div>
        {/* Traslados que me enviaron de otra sede */}
        {pendientes.length > 0 && (
          <div className="seccion" style={{ marginTop: 18, borderLeft: '4px solid var(--azul)' }}>
            <h2 className="sub-titulo">📥 Te enviaron de otra sede <span className="nota">— confirma que llegó</span></h2>
            <table className="tabla">
              <tbody>
                {pendientes.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{Math.abs(t.cantidad)} {t.producto}</strong></td>
                    <td className="nota">de {t.origen?.nombre || 'otra sede'}</td>
                    <td className="nota">{new Date(t.created_at).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td><button className="btn-mini" style={{ background: 'var(--azul)', color: '#fff', borderColor: 'var(--azul)' }} onClick={() => aceptarTraslado(t)}>✓ Recibí</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Movimientos de stock durante el turno */}
        <div className="seccion" style={{ marginTop: 18 }}>
          <h2 className="sub-titulo">📦 Movimientos de stock <span className="nota">— llegó más, se malogró o se traslada</span></h2>
          <MovStock productos={stock.map((s) => s.producto)} onAdd={addMov} sedes={sedes.filter((s) => s.id !== turno.sede_id)} />
          {movs.length > 0 && (
            <table className="tabla" style={{ marginTop: 10 }}>
              <tbody>
                {movs.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span className={`chip ${m.tipo === 'adicion' ? 'chip-ok' : 'chip-off'}`}
                        style={m.tipo !== 'adicion' ? { background: '#fff1f1', color: 'var(--rojo)' } : {}}>
                        {m.tipo === 'adicion' ? '+ Adición' : m.tipo === 'merma' ? '− Merma' : m.tipo === 'ajuste_apertura' ? '⚑ Apertura' : '− Salida'}
                      </span>
                    </td>
                    <td><strong>{m.producto}</strong></td>
                    <td>{m.cantidad > 0 ? '+' : ''}{m.cantidad}</td>
                    <td className="nota">
                      {m.motivo || '—'}
                      {m.sede_destino_id && <> → <b>{sedes.find((s) => s.id === m.sede_destino_id)?.nombre}</b>
                        {m.aceptado === false && <span className="chip chip-off" style={{ marginLeft: 6 }}>pendiente</span>}
                        {m.aceptado === true && <span className="chip chip-ok" style={{ marginLeft: 6 }}>recibido</span>}</>}
                    </td>
                    <td>{m.tipo !== 'ajuste_apertura' && m.aceptado !== true && <button className="btn-mini btn-peligro" onClick={() => delMov(m)}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-guardar" onClick={() => setFase('cierre')}>➡️ Ir al cierre</button>
          {puedeBorrar && <button className="btn-mini btn-peligro" onClick={eliminarTurno} disabled={ocupado}>🗑️ Eliminar turno</button>}
        </div>
      </>)}

      {/* ---------------- FASE 3 ---------------- */}
      {turno && fase === 'cierre' && (<>
        <h1>Cierre de turno</h1>
        <p className="pagina-sub">{turno.cajero} · {turno.fecha} · {nombreTurno(turno.turno, turno.sede_id)}</p>

        {/* --- 3 documentos obligatorios --- */}
        <div className="seccion" style={{ marginBottom: 16 }}>
          <h2 className="sub-titulo">📄 Documentos del turno <span className="nota">— los 3 son obligatorios</span></h2>
          <div className="adj-grid">
            <Slot n="1" label="Arqueo de caja (PDF)" ok={!!arqueo} accept="application/pdf"
              onFile={subirArqueo} hint="Jala la venta del sistema y los pagos" />
            <Slot n="2" label="Productos vendidos (PDF)" ok={!!prodPdf} accept="application/pdf"
              onFile={subirProductos} hint="Jala los productos para comparar tu stock" />
            <Slot n="3" label="Foto del voucher POS" ok={tieneVoucher} accept="image/*" capture
              onFile={(f) => addAdjunto('voucher', f)} hint="Toma la foto con la cámara" />
          </div>
          {!listo && <p className="nota" style={{ color: 'var(--rojo)', marginTop: 10 }}>⚠️ Faltan documentos: {faltantes.join(' · ')}</p>}
        </div>

        {/* --- Montos leídos (editables) --- */}
        {arqueo && (
        <div className="seccion" style={{ marginBottom: 16 }}>
          <h2 className="sub-titulo">💰 Montos leídos del arqueo <span className="nota">— puedes corregirlos</span></h2>

          {editados.length > 0 && (
            <div className="alerta-edit">
              <b>⚠️ Ojo: {editados.length === 1 ? 'hay 1 monto que NO coincide' : `hay ${editados.length} montos que NO coinciden`} con el PDF</b>
              <ul>
                {editados.map((e) => (
                  <li key={e.campo}>
                    <b>{e.label}</b>: el PDF dice <b>{soles(e.pdf)}</b> y se puso <b>{soles(e.puesto)}</b>
                    <span className="dif-edit"> ({e.puesto - e.pdf > 0 ? '+' : ''}{soles(e.puesto - e.pdf)})</span>
                  </li>
                ))}
              </ul>
              <span className="nota">Queda registrado en el turno para que administración lo revise.</span>
            </div>
          )}

          <div className="arqueo-box">
            {CAMPOS_ARQ.map(([campo, label]) => {
              const ops = { sis_efectivo: arqueo.sis_efectivo_op, sis_tarjeta: arqueo.sis_tarjeta_op, sis_yape: arqueo.sis_yape_op }[campo]
              const mod = arqueoOrig && n(arqueo[campo]) !== n(arqueoOrig[campo])
              return (
                <label key={campo} className={mod ? 'campo-mod' : ''}>
                  <span className="t-label">{label} {ops != null && <small>({ops} op)</small>}</span>
                  <input type="number" className="in-arq" value={arqueo[campo] ?? ''} onChange={(e) => setArq(campo, e.target.value)} />
                  {mod && <span className="pdf-dice">PDF: {soles(arqueoOrig[campo])} <button className="btn-mini" onClick={() => setArq(campo, arqueoOrig[campo])}>↺</button></span>}
                </label>
              )
            })}
            <div><span className="t-label">Cajero POS</span><small>{arqueo.cajero}</small></div>
          </div>
          {Math.abs(n(arqueo.venta_sistema) - (n(arqueo.sis_efectivo) + n(arqueo.sis_tarjeta) + n(arqueo.sis_yape) + n(arqueo.sis_plin))) > 0.5 &&
            <p className="nota" style={{ color: 'var(--rojo)' }}>⚠️ La suma de los medios de pago no cuadra con la venta del sistema.</p>}
        </div>)}

        {/* --- Adicionales: facturas de gastos --- */}
        <div className="seccion" style={{ marginBottom: 16 }}>
          <h2 className="sub-titulo">📎 Adicionales <span className="nota">— opcional</span></h2>
          <label className="campo"><span>Facturas / boletas de los gastos</span>
            <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => [...e.target.files].forEach((f) => addAdjunto('factura', f))} />
          </label>
          {adjuntos.length > 0 && (
            <div className="sugerencias" style={{ marginTop: 10 }}>
              {adjuntos.map((a, i) => (
                <span key={i} className="chip chip-ok" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  {a.tipo}: {a.file.name.slice(0, 22)}
                  <button className="btn-mini" style={{ padding: '0 5px' }} onClick={() => quitarAdjunto(i)}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="dos-cols">
          <div className="seccion">
            <h2 className="sub-titulo">⚖️ Cuadre</h2>
            <div className="totales" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8, borderTop: 0, marginTop: 0, paddingTop: 0 }}>
              <div>Faltante que reporta el POS: <b>{soles(faltantePos)}</b></div>
              <div>Explicado por gastos ({soles(totGastos)}) + adelantos ({soles(totDescs)}): <b>{soles(explicado)}</b></div>
              <div className={Math.abs(descuadre) < 0.5 ? 'def-pos' : 'def-neg'} style={{ fontSize: 17 }}>
                {Math.abs(descuadre) < 0.5 ? '✅ Cuadra' : (descuadre > 0 ? `⚠️ Descuadre (falta explicar) ${soles(descuadre)}` : `⚠️ Sobra ${soles(-descuadre)}`)}
              </div>
              {meta && arqueo && <div style={{ marginTop: 6 }}>Meta {soles(meta)} → <b>{rendimiento}</b> ({((arqueo.venta_sistema / meta) * 100).toFixed(0)}%)</div>}
            </div>
            <label className="campo" style={{ marginTop: 12 }}><span>Efectivo contado</span><input type="number" value={ci.efectivo_contado} onChange={(e) => setCi({ ...ci, efectivo_contado: e.target.value })} /></label>
            <label className="campo" style={{ marginTop: 10 }}><span>Clima {climaAuto && <em style={{ color: 'var(--gris)', textTransform: 'none' }}>— hoy: {climaAuto.clima}, {climaAuto.temp_max}°C, {climaAuto.lluvia_mm}mm</em>}</span>
              <select value={ci.clima} onChange={(e) => setCi({ ...ci, clima: e.target.value })}>
                <option value="">Elige…</option><option>Soleado</option><option>Nublado</option><option>Lluvioso</option>
              </select>
            </label>
            {climaAuto && ci.clima && ci.clima !== climaAuto.clima && <p className="nota" style={{ color: 'var(--rojo)' }}>⚠️ El clima real fue "{climaAuto.clima}"</p>}
            <label className="campo" style={{ marginTop: 10 }}><span>Observaciones</span><input value={ci.observaciones} onChange={(e) => setCi({ ...ci, observaciones: e.target.value })} /></label>
          </div>

          <div className="seccion">
            <h2 className="sub-titulo">📦 Stock final {prodPdf && <span className="nota">vs sistema</span>}</h2>
            <table className="tabla">
              <thead><tr><th>Producto</th><th>Inicio</th><th>+Adic.</th><th>−Merma</th><th>Cierre</th><th>Vendido</th>{prodPdf && <><th>Sistema</th><th></th></>}</tr></thead>
              <tbody>
                {stockCruzado.map((s, i) => {
                  const vend = n(s.inicio) + n(s.adicion) - n(s.merma) - n(s.salida) - n(s.cierre)
                  const cuadra = s.vendido_sistema == null ? null : vend === s.vendido_sistema
                  return (
                    <tr key={s.id}>
                      <td><strong>{s.producto}</strong></td>
                      <td>{s.inicio}</td>
                      <td>{n(s.adicion) || <span className="nota">—</span>}</td>
                      <td style={{ color: n(s.merma) ? 'var(--rojo)' : 'inherit' }}>{n(s.merma) || <span className="nota">—</span>}</td>
                      <td><input type="number" className="in-num" value={s.cierre ?? ''} onChange={(e) => setStock(stock.map((r, j) => j === i ? { ...r, cierre: e.target.value } : r))} /></td>
                      <td><b>{vend}</b></td>
                      {prodPdf && <>
                        <td>{s.vendido_sistema ?? <span className="nota">—</span>}</td>
                        <td>{cuadra === null ? '' : cuadra ? <span className="chip chip-ok">✓</span> : <span className="chip chip-off" style={{ background: '#fff1f1', color: 'var(--rojo)' }}>≠ {vend - s.vendido_sistema}</span>}</td>
                      </>}
                    </tr>
                  )
                })}
                {stock.length === 0 && <tr><td colSpan="8" className="nota">Sin stock registrado en la apertura.</td></tr>}
              </tbody>
            </table>
            {prodPdf && <p className="nota">Solo se comparan los productos que llevas por stock. El PDF trae {prodPdf.items.length} productos vendidos en total.</p>}
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-mini" onClick={() => setFase('turno')}>⬅️ Volver</button>
          <button className="btn-guardar" onClick={cerrarTurno} disabled={ocupado || !listo} title={listo ? '' : 'Faltan: ' + faltantes.join(', ')}>{ocupado ? 'Cerrando…' : '🔒 Cerrar turno'}</button>
          <button className="btn-mini" onClick={() => window.print()}>🖨️ PDF / Captura</button>
          <button className="btn-wsp" onClick={enviarWsp} disabled={!arqueo}>💬 Enviar por WhatsApp</button>
          {puedeBorrar && <button className="btn-mini btn-peligro" onClick={eliminarTurno} disabled={ocupado} style={{ marginLeft: 'auto' }}>🗑️ Eliminar turno</button>}
        </div>
      </>)}
    </div>
  )
}

// Alta de movimiento de stock: adición (llegó más), merma (se malogró) o salida (traslado)
function MovStock({ productos, onAdd, sedes = [] }) {
  const vacio = { producto: '', tipo: 'adicion', cantidad: '', motivo: '', sede_destino_id: '' }
  const [m, setM] = useState(vacio)
  const MOTIVOS = {
    adicion: ['Llegó pedido', 'Producción nueva', 'Otro'],
    merma: ['Se malogró', 'Se cayó / rompió', 'Vencido', 'Cortesía / degustación', 'Otro'],
    salida: ['Traslado a otra sede', 'Consumo interno', 'Otro'],
  }
  const esTraslado = m.tipo === 'salida' && m.motivo === 'Traslado a otra sede'
  function agregar() {
    if (!m.producto || !Number(m.cantidad)) return
    if (esTraslado && !m.sede_destino_id) return alert('Elige a qué sede se traslada')
    onAdd(m); setM({ ...vacio, tipo: m.tipo })
  }
  return (<>
    <div className="fila-mini">
      <select value={m.producto} onChange={(e) => setM({ ...m, producto: e.target.value })}>
        <option value="">Producto…</option>
        {productos.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select value={m.tipo} onChange={(e) => setM({ ...m, tipo: e.target.value, motivo: '', sede_destino_id: '' })} style={{ maxWidth: 120 }}>
        <option value="adicion">+ Adición</option>
        <option value="merma">− Merma</option>
        <option value="salida">− Salida</option>
      </select>
      <input type="number" placeholder="Cant." value={m.cantidad} onChange={(e) => setM({ ...m, cantidad: e.target.value })} style={{ maxWidth: 80 }} />
      <select value={m.motivo} onChange={(e) => setM({ ...m, motivo: e.target.value })} style={{ maxWidth: 170 }}>
        <option value="">Motivo…</option>
        {(MOTIVOS[m.tipo] || []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {esTraslado && (
        <select value={m.sede_destino_id} onChange={(e) => setM({ ...m, sede_destino_id: e.target.value })} style={{ maxWidth: 150, borderColor: 'var(--azul)' }}>
          <option value="">¿A qué sede? *</option>
          {sedes.map((s) => <option key={s.id} value={s.id}>→ {s.nombre}</option>)}
        </select>
      )}
      <button className="btn-mini" onClick={agregar}>+</button>
    </div>
    {esTraslado && <p className="nota">📤 Queda pendiente hasta que la otra sede confirme que lo recibió.</p>}
  </>)
}

// Recuadro de documento obligatorio: muestra ✓ cuando ya se cargó
function Slot({ n, label, ok, accept, capture, onFile, hint }) {
  return (
    <label className={ok ? 'slot ok' : 'slot'}>
      <div className="slot-cab"><span className="slot-n">{ok ? '✓' : n}</span><b>{label}</b></div>
      <span className="nota">{ok ? 'Listo ✓ — puedes reemplazarlo' : hint}</span>
      <input type="file" accept={accept} {...(capture ? { capture: 'environment' } : {})}
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
    </label>
  )
}

// Bloque de movimientos con búsqueda rápida (gastos o descuentos)
function MovBloque({ titulo, total, filas, onAdd, onDel, tipos = [], personas = [], modo }) {
  const [q, setQ] = useState('')
  const [monto, setMonto] = useState('')
  const [extra, setExtra] = useState(modo === 'gasto' ? 'LOCAL' : 'ADELANTO')
  const opciones = modo === 'gasto' ? tipos.map((t) => t.nombre) : personas.map((p) => p.nombres)
  const sug = q ? opciones.filter((o) => o.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : opciones.slice(0, 6)

  function agregar() {
    if (!q.trim() || !Number(monto)) return
    onAdd(modo === 'gasto' ? { descripcion: q.trim(), monto, detalle: extra } : { persona: q.trim(), monto, tipo: extra })
    setQ(''); setMonto('')
  }
  return (
    <div className="seccion">
      <h2 className="sub-titulo">{titulo} <span style={{ float: 'right', color: 'var(--rojo)' }}>{soles(total)}</span></h2>
      <div className="fila-mini">
        <input placeholder={modo === 'gasto' ? 'Buscar o escribir gasto…' : 'Buscar persona…'} value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="number" placeholder="S/" value={monto} onChange={(e) => setMonto(e.target.value)} style={{ maxWidth: 80 }} onKeyDown={(e) => e.key === 'Enter' && agregar()} />
        <select value={extra} onChange={(e) => setExtra(e.target.value)} style={{ maxWidth: 110 }}>
          {(modo === 'gasto' ? ['LOCAL', 'DELIVERY'] : ['ADELANTO', 'CONSUMO', 'PRESTAMO', 'DESCUENTO']).map((o) => <option key={o}>{o}</option>)}
        </select>
        <button className="btn-mini" onClick={agregar}>+</button>
      </div>
      {q && sug.length > 0 && (
        <div className="sugerencias">
          {sug.map((s) => <button key={s} className="sug" onClick={() => setQ(s)}>{s}</button>)}
        </div>
      )}
      <table className="tabla" style={{ marginTop: 10 }}>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <td>{f.a}</td><td style={{ whiteSpace: 'nowrap' }}>{soles(f.b)}</td>
              <td className="nota">{f.c}</td>
              <td><button className="btn-mini btn-peligro" onClick={() => onDel(f.id)}>✕</button></td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td className="nota">Nada registrado aún.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
