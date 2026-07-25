import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { useAuth } from '../context/AuthContext'
import { puedeCompras, puedeEditar } from '../lib/roles'
import Recepcion from '../components/Recepcion'
import ComprasHoy from '../components/ComprasHoy'
import ControlCompras from '../components/ControlCompras'
import ConteoAlmacen from '../components/ConteoAlmacen'

const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// El día anterior a una fecha 'YYYY-MM-DD' (para el efectivo del turno que cerró).
const diaAnterior = (iso) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - 1); return fmt(d) }

// Sube varios archivos al bucket arqueos bajo un prefijo; devuelve las rutas.
async function subirVouchers(files, prefijo) {
  const rutas = []
  for (const f of files) {
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
    const ruta = `${prefijo}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
    const { error } = await supabase.storage.from('arqueos').upload(ruta, f, { contentType: f.type || undefined })
    if (error) throw error
    rutas.push(ruta)
  }
  return rutas
}
async function verArchivo(ruta) {
  const { data } = await supabase.storage.from('arqueos').createSignedUrl(ruta, 3600)
  if (data?.signedUrl) window.open(data.signedUrl, '_blank')
}
// Convierte la cantidad pedida (en su unidad) a la unidad base del producto.
// Si es la unidad de compra y hay factor (1 saco = 25 kg), multiplica; si no, tal cual.
function aUnidadBase(cantidad, unidad, prod) {
  const c = Number(cantidad || 0)
  if (prod?.unidad_compra && unidad === prod.unidad_compra && Number(prod.factor_compra) > 0)
    return c * Number(prod.factor_compra)
  return c
}

function Ranking({ titulo, filas, max, color = 'var(--rojo)' }) {
  return (
    <div>
      <h2 className="sub-titulo">{titulo}</h2>
      <table className="tabla">
        <tbody>
          {filas.map(([nombre, monto], i) => (
            <tr key={nombre}>
              <td style={{ width: 24, color: '#9aa0a6' }}>{i + 1}</td>
              <td><strong>{nombre}</strong></td>
              <td style={{ whiteSpace: 'nowrap' }}>{soles(monto)}</td>
              <td style={{ width: '30%' }}><div className="barra" style={{ background: color, width: `${(monto / max) * 100}%` }} /></td>
            </tr>
          ))}
          {filas.length === 0 && <tr><td className="nota">Sin datos.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// Dropdown que incluye el valor actual (aunque no esté en el catálogo) y una opción para crear
function SelectCat({ value, opciones, onChange, onCrear, placeholder }) {
  return (
    <select value={value || ''} onChange={async (e) => {
      if (e.target.value === '__nuevo__') { const nv = await onCrear(); if (nv) onChange(nv) }
      else onChange(e.target.value)
    }}>
      <option value="">{placeholder || '—'}</option>
      {value && !opciones.includes(value) && <option value={value}>{value} (actual)</option>}
      {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value="__nuevo__">➕ Crear nuevo…</option>
    </select>
  )
}

export default function Compras() {
  const { perfil } = useAuth()
  // Editar compras/entregas y el catálogo: quien opera compras (Juan/admin/super).
  // Antes era `!perfil || rol===superadmin||gerente` → daba acceso sin perfil.
  const esAdmin = puedeCompras(perfil)
  // Cesar (super/admin): reconfirma pedidos e ingresa al almacén. Juan arma/envía.
  const esCesar = puedeEditar(perfil)

  const [compras, setCompras] = useState([])
  const [entregas, setEntregas] = useState([])
  const [fondo, setFondo] = useState([])
  const [sedes, setSedes] = useState([])
  const [catalogo, setCatalogo] = useState([])       // tabla productos (con unidad)
  const [provDetalle, setProvDetalle] = useState([]) // proveedores con contacto
  const [cargando, setCargando] = useState(true)

  const hoy = new Date()
  const [desde, setDesde] = useState(fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1)))
  const [hasta, setHasta] = useState(fmt(hoy))
  const [fSede, setFSede] = useState('')
  const [fProv, setFProv] = useState('')
  const [busca, setBusca] = useState('')
  // Arranca en "Comprar hoy": es la pantalla con la que se trabaja, el resto es consulta.
  const [vista, setVista] = useState('hoy')
  const [edit, setEdit] = useState(null)          // {tabla, id} en edición
  const [borr, setBorr] = useState({})            // borrador de edición
  const [catProd, setCatProd] = useState([])      // catálogo de productos (compras_productos)
  const [catProv, setCatProv] = useState([])      // catálogo de proveedores

  async function cargarCatalogos() {
    const [{ data: prod }, { data: prov }] = await Promise.all([
      supabase.from('productos').select('*').order('nombre'),
      supabase.from('proveedores').select('*').order('nombre'),
    ])
    setCatalogo(prod || []); setProvDetalle(prov || [])
    setCatProd((prod || []).map((x) => x.nombre))
    setCatProv((prov || []).map((x) => x.nombre))
  }

  // Recarga solo las compras (tras registrar una nueva desde el formulario).
  async function cargarCompras() {
    const c = await fetchAll('compras', 'id, fecha, nombre_libre, cantidad, unidad, precio_unitario, total, proveedor, destino_sede_id, comprobante, voucher_url')
    setCompras(c)
  }
  async function verVoucher(ruta) {
    const { data } = await supabase.storage.from('arqueos').createSignedUrl(ruta, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  useEffect(() => {
    (async () => {
      const [c, e, f, { data: s }] = await Promise.all([
        fetchAll('compras', 'id, fecha, nombre_libre, cantidad, unidad, precio_unitario, total, proveedor, destino_sede_id, comprobante, voucher_url'),
        fetchAll('entregas', 'id, fecha, producto, cantidad, presentacion, sede_id, total'),
        fetchAll('fondo_compras_dia', '*'),
        supabase.from('sedes').select('id, nombre').order('nombre'),
      ])
      setCompras(c); setEntregas(e); setFondo(f); setSedes(s || [])
      await cargarCatalogos()
      setCargando(false)
    })()
  }, [])

  async function crearEnCatalogo(tabla, setCat) {
    // MAYÚSCULA + espacios colapsados, como el resto de catálogos. Si no, cada
    // quien lo escribe distinto y se vuelve a llenar de "Plaza  Vea" / "plaza vea".
    const nombre = prompt(`Nombre del nuevo ${tabla === 'proveedores' ? 'proveedor' : 'producto'}:`)
      ?.toUpperCase().replace(/\s+/g, ' ').trim()
    if (!nombre) return null
    // Puede que ya exista (unique en nombre): no reventar, solo reusarlo.
    const { error } = await supabase.from(tabla).insert({ nombre })
    if (error && !/duplicate|unique/i.test(error.message)) { alert(error.message); return null }
    setCat((prev) => prev.includes(nombre) ? prev : [...prev, nombre].sort((a, b) => a.localeCompare(b)))
    return nombre
  }

  const sedeN = useMemo(() => Object.fromEntries(sedes.map((s) => [s.id, s.nombre])), [sedes])
  const provs = useMemo(() => [...new Set(compras.map((x) => x.proveedor))].filter(Boolean).sort(), [compras])
  const productos = useMemo(() => [...new Set([...compras.map((x) => x.nombre_libre), ...entregas.map((x) => x.producto)])].filter(Boolean).sort(), [compras, entregas])

  const enRango = (fecha) => (!desde || fecha >= desde) && (!hasta || fecha <= hasta)
  const matchProd = (p) => !busca || (p || '').toLowerCase().includes(busca.toLowerCase())

  const fil = useMemo(() => compras.filter((x) => enRango(x.fecha)
    && (!fSede || x.destino_sede_id === fSede) && (!fProv || x.proveedor === fProv) && matchProd(x.nombre_libre)
  ), [compras, desde, hasta, fSede, fProv, busca])
  const tot = fil.reduce((a, x) => a + Number(x.total || 0), 0)

  const rankProv = useMemo(() => {
    const m = {}; for (const x of fil) { const k = x.proveedor || '(sin proveedor)'; m[k] = (m[k] || 0) + Number(x.total || 0) }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [fil])
  const rankProd = useMemo(() => {
    const m = {}; for (const x of fil) { const k = (x.nombre_libre || '—').toUpperCase().trim(); m[k] = (m[k] || 0) + Number(x.total || 0) }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [fil])

  const entF = useMemo(() => entregas.filter((x) => enRango(x.fecha) && (!fSede || x.sede_id === fSede) && matchProd(x.producto)), [entregas, desde, hasta, fSede, busca])
  const entPorSede = useMemo(() => {
    const m = {}; for (const x of entF) { const k = sedeN[x.sede_id] || '—'; m[k] = (m[k] || 0) + Number(x.total || 0) }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [entF, sedeN])

  const fondoF = useMemo(() => fondo.filter((x) => enRango(x.fecha) && (Number(x.gasto_total) || Number(x.dinero_total) || Number(x.efectivo_manana))), [fondo, desde, hasta])
  const fondoTot = fondoF.reduce((a, x) => ({
    rec: a.rec + Number(x.efectivo_manana || 0) + Number(x.efectivo_tarde || 0),
    gas: a.gas + Number(x.gasto_total || 0), adm: a.adm + Number(x.entrega_admin || 0),
  }), { rec: 0, gas: 0, adm: 0 })

  function iniciarEdit(tabla, row) {
    setEdit({ tabla, id: row.id })
    setBorr(tabla === 'compras'
      ? { nombre_libre: row.nombre_libre || '', proveedor: row.proveedor || '', destino_sede_id: row.destino_sede_id || '' }
      : { producto: row.producto || '', sede_id: row.sede_id || '' })
  }
  async function guardar() {
    const campos = { ...borr }
    for (const k of ['destino_sede_id', 'sede_id']) if (k in campos && !campos[k]) campos[k] = null
    if (edit.tabla === 'compras') setCompras((p) => p.map((c) => c.id === edit.id ? { ...c, ...campos } : c))
    else setEntregas((p) => p.map((c) => c.id === edit.id ? { ...c, ...campos } : c))
    await supabase.from(edit.tabla).update(campos).eq('id', edit.id)
    setEdit(null)
  }

  if (cargando) return <div className="pagina"><h1>🛒 Compras</h1><p className="nota">Cargando…</p></div>

  const enEdit = (tabla, id) => edit && edit.tabla === tabla && edit.id === id

  return (
    <div className="pagina">
      <h1>Compras <span className="titulo-tag">Juan</span></h1>
      <p className="pagina-sub">Compras diarias con efectivo de caja, entregas a sedes y cuadre del fondo.</p>

      <datalist id="lista-productos">{productos.map((p) => <option key={p} value={p} />)}</datalist>

      {/* Filtros y rankings son de consulta: estorban en la pantalla de trabajo. */}
      {vista !== 'hoy' && (<>
      <div className="filtros">
        <label className="campo"><span>Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="campo"><span>Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="campo"><span>Sede</span>
          <select value={fSede} onChange={(e) => setFSede(e.target.value)}>
            <option value="">Todas</option>{sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <label className="campo"><span>Proveedor</span>
          <select value={fProv} onChange={(e) => setFProv(e.target.value)}>
            <option value="">Todos</option>{provs.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="campo campo-ancho"><span>🔎 Producto</span>
          <input list="lista-productos" placeholder="ej. papa, vaso, chantilly…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
      </div>

      <div className="tarjetas" style={{ marginBottom: 18 }}>
        <div className="tarjeta"><span className="t-label">Total comprado</span><span className="t-valor">{soles(tot)}</span></div>
        <div className="tarjeta"><span className="t-label">Compras</span><span className="t-valor">{fil.length.toLocaleString('es-PE')}</span></div>
        <div className="tarjeta"><span className="t-label">Proveedor top</span><span className="t-valor" style={{ fontSize: 15 }}>{rankProv[0]?.[0] || '—'}</span></div>
        <div className="tarjeta"><span className="t-label">Producto top</span><span className="t-valor" style={{ fontSize: 15 }}>{rankProd[0]?.[0] || '—'}</span></div>
      </div>
      </>)}

      <div className="tab-bar">
        {[['hoy', '🛒 Comprar hoy'], ['fondo', '💵 Caja de Juan'],
          // El panel de revisión es de Cesar/admin: Juan opera, no se audita solo.
          ...(esCesar ? [['control', '🔎 Control']] : []),
          ['pedidos', '📋 Pedidos a Cesar'], ['recepcion', '📥 Recepción'], ['conteo', '🔢 Conteo almacén'], ['kardex', '🏬 Almacén / Kardex'], ['compras', 'Historial'], ['resumen', 'Rankings'], ['entregas', 'Entregas'], ['catalogo', '📦 Catálogo'], ['proveedores', '🚚 Proveedores']].map(([k, l]) => (
          <button key={k} className={vista === k ? 'tab activo' : 'tab'} onClick={() => setVista(k)}>{l}</button>
        ))}
      </div>

      {vista === 'resumen' && (
        <div className="dos-cols">
          <Ranking titulo="Proveedores más comprados" filas={rankProv.slice(0, 15)} max={rankProv[0]?.[1] || 1} />
          <Ranking titulo="Productos más comprados" filas={rankProd.slice(0, 15)} max={rankProd[0]?.[1] || 1} color="var(--azul)" />
        </div>
      )}

      {vista === 'compras' && (<>
        {esAdmin && (
          <FormCompra
            perfil={perfil} catalogo={catalogo} sedes={sedes} catProv={catProv}
            onCrearProv={() => crearEnCatalogo('proveedores', setCatProv)}
            onListo={cargarCompras}
          />
        )}
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Proveedor</th><th>Monto</th><th>Sede</th><th>Comp.</th>{esAdmin && <th></th>}</tr></thead>
          <tbody>
            {fil.slice(0, 300).map((x) => enEdit('compras', x.id) ? (
              <tr key={x.id} className="fila-edit">
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td><SelectCat value={borr.nombre_libre} opciones={catProd} placeholder="Producto…" onChange={(v) => setBorr({ ...borr, nombre_libre: v })} onCrear={() => crearEnCatalogo('productos', setCatProd)} /></td>
                <td>{x.cantidad}</td>
                <td><SelectCat value={borr.proveedor} opciones={catProv} placeholder="Proveedor…" onChange={(v) => setBorr({ ...borr, proveedor: v })} onCrear={() => crearEnCatalogo('proveedores', setCatProv)} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{soles(x.total)}</td>
                <td><select value={borr.destino_sede_id} onChange={(e) => setBorr({ ...borr, destino_sede_id: e.target.value })}><option value="">Oficina</option>{sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></td>
                <td className="nota">{x.comprobante || '—'}</td>
                <td className="acciones"><button className="btn-mini" onClick={guardar}>✓</button><button className="btn-mini" onClick={() => setEdit(null)}>✕</button></td>
              </tr>
            ) : (
              <tr key={x.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td><strong>{x.nombre_libre}</strong> <span className="nota">{x.unidad || ''}</span></td>
                <td>{x.cantidad}</td>
                <td>{x.proveedor || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{soles(x.total)}</td>
                <td>{sedeN[x.destino_sede_id] || 'Oficina'}</td>
                <td className="nota">{x.voucher_url
                  ? <button className="btn-mini" title="Ver voucher" onClick={() => verVoucher(x.voucher_url)}>📎 {x.comprobante || 'Ver'}</button>
                  : (x.comprobante || '—')}</td>
                {esAdmin && <td><button className="btn-mini" title="Editar" onClick={() => iniciarEdit('compras', x)}>✏️</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="lista-prov">{provs.map((p) => <option key={p} value={p} />)}</datalist>
        {fil.length > 300 && <p className="nota">Mostrando 300 de {fil.length} — afina los filtros.</p>}
      </>)}

      {vista === 'entregas' && (<>
        <div className="tarjetas" style={{ marginBottom: 16 }}>
          {entPorSede.map(([n, v]) => (<div className="tarjeta" key={n}><span className="t-label">Entregado a {n}</span><span className="t-valor" style={{ fontSize: 20 }}>{soles(v)}</span></div>))}
        </div>
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Sede</th><th>Total</th>{esAdmin && <th></th>}</tr></thead>
          <tbody>
            {entF.slice(0, 300).map((x) => enEdit('entregas', x.id) ? (
              <tr key={x.id} className="fila-edit">
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td><SelectCat value={borr.producto} opciones={catProd} placeholder="Producto…" onChange={(v) => setBorr({ ...borr, producto: v })} onCrear={() => crearEnCatalogo('productos', setCatProd)} /></td>
                <td>{x.cantidad ?? '—'}</td>
                <td><select value={borr.sede_id} onChange={(e) => setBorr({ ...borr, sede_id: e.target.value })}><option value="">—</option>{sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></td>
                <td>{Number(x.total) ? soles(x.total) : <span className="nota">s/v</span>}</td>
                <td className="acciones"><button className="btn-mini" onClick={guardar}>✓</button><button className="btn-mini" onClick={() => setEdit(null)}>✕</button></td>
              </tr>
            ) : (
              <tr key={x.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}</td>
                <td><strong>{x.producto}</strong> <span className="nota">{x.presentacion || ''}</span></td>
                <td>{x.cantidad ?? '—'}</td>
                <td>{sedeN[x.sede_id] || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{Number(x.total) ? soles(x.total) : <span className="nota">sin valorizar</span>}</td>
                {esAdmin && <td><button className="btn-mini" title="Editar" onClick={() => iniciarEdit('entregas', x)}>✏️</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {entF.length > 300 && <p className="nota">Mostrando 300 de {entF.length}.</p>}
      </>)}

      {vista === 'fondo' && (
        <CajaJuanTab sedes={sedes} perfil={perfil} puedeOperar={esAdmin} historico={fondo} />
      )}

      {vista === 'catalogo' && (
        <CatalogoTab catalogo={catalogo} puedeEditar={esAdmin} onCambio={cargarCatalogos} />
      )}
      {vista === 'proveedores' && (
        <ProveedoresTab proveedores={provDetalle} puedeEditar={esAdmin} onCambio={cargarCatalogos} />
      )}
      {vista === 'kardex' && (
        <KardexTab catalogo={catalogo} sedes={sedes} puedeMover={esAdmin} />
      )}
      {vista === 'pedidos' && (
        <PedidosTab catalogo={catalogo} sedes={sedes} perfil={perfil} esAdmin={esAdmin} esCesar={esCesar} />
      )}
      {vista === 'hoy' && (
        <ComprasHoy perfil={perfil} sedes={sedes} catalogo={catalogo} onCambio={cargarCompras} />
      )}
      {vista === 'control' && esCesar && (
        <ControlCompras sedes={sedes} catalogo={catalogo} />
      )}
      {vista === 'conteo' && (
        <ConteoAlmacen perfil={perfil} puedeContar={esAdmin} />
      )}
      {vista === 'recepcion' && (
        <RecepcionTab sedes={sedes} perfil={perfil} puedeRecibir={esAdmin} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Registrar una compra de Juan. Igual que Gastos: PRIMERO el comprobante
// (voucher o "en efectivo, sin comprobante"), LUEGO los datos. Un solo voucher
// puede cubrir VARIOS productos → cada producto se guarda como una fila de
// `compras`, todas con el mismo voucher/comprobante/proveedor/fecha.
// OJO: `compras.total` es GENERADA (cantidad × precio) — se manda cantidad y
// precio_unitario, NUNCA el total.
const MEDIOS_COMPRA = ['efectivo', 'yape', 'transferencia', 'tarjeta', 'otro']

function FormCompra({ perfil, catalogo, sedes, catProv, onCrearProv, onListo }) {
  const cabVacia = { fecha: fmt(new Date()), proveedor: '', destino_sede_id: '', medio_pago: 'efectivo', comprobante: '' }
  const [cab, setCab] = useState(cabVacia)
  const [file, setFile] = useState(null)
  const [efectivo, setEfectivo] = useState(false)   // sin comprobante
  const [lineas, setLineas] = useState([])           // productos que cubre este voucher
  const [nueva, setNueva] = useState({ producto_id: '', cantidad: '', precio: '' })
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  const prodActivos = useMemo(() => catalogo.filter((p) => p.activo), [catalogo])
  const prodN = useMemo(() => Object.fromEntries(catalogo.map((p) => [p.id, p])), [catalogo])
  // Paso 1 listo: hay voucher o se marcó "en efectivo".
  const paso1 = !!file || efectivo
  const totalCompra = lineas.reduce((a, l) => a + Number(l.cantidad || 0) * Number(l.precio || 0), 0)

  function agregarLinea() {
    setError('')
    const p = prodN[nueva.producto_id]
    if (!p) return setError('Elige un producto.')
    if (!(Number(nueva.cantidad) > 0)) return setError('La cantidad debe ser mayor a 0.')
    if (!(Number(nueva.precio) > 0)) return setError('El precio debe ser mayor a 0.')
    setLineas((L) => [...L, { producto_id: p.id, nombre: p.nombre, unidad: p.unidad, cantidad: Number(nueva.cantidad), precio: Number(nueva.precio) }])
    setNueva({ producto_id: '', cantidad: '', precio: '' })
  }
  function quitarLinea(i) { setLineas((L) => L.filter((_, j) => j !== i)) }

  async function guardar() {
    if (!lineas.length) return setError('Agrega al menos un producto que cubre esta compra.')
    setOcupado(true); setError('')

    let voucher_url = null
    if (file && !efectivo) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const ruta = `compras/${cab.fecha}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const { error: eUp } = await supabase.storage.from('arqueos').upload(ruta, file, { contentType: file.type || undefined })
      if (eUp) { setError('No pude subir el voucher: ' + eUp.message); setOcupado(false); return }
      voucher_url = ruta
    }

    // Una fila por producto — comparten voucher/comprobante/proveedor/fecha.
    const filas = lineas.map((l) => ({
      fecha: cab.fecha,
      producto_id: l.producto_id,
      nombre_libre: l.nombre,
      cantidad: l.cantidad,
      unidad: l.unidad,
      precio_unitario: l.precio,             // total = cantidad × precio (GENERADA)
      proveedor: cab.proveedor || null,
      destino_sede_id: cab.destino_sede_id || null,
      medio_pago: efectivo ? 'efectivo' : cab.medio_pago,
      comprobante: efectivo ? 'EFECTIVO' : (cab.comprobante.trim().toUpperCase() || (voucher_url ? 'VOUCHER' : null)),
      voucher_url,
      registrado_por: perfil?.id || null,
    }))
    const { error: eIns } = await supabase.from('compras').insert(filas)
    setOcupado(false)
    if (eIns) return setError(eIns.message)
    setCab({ ...cabVacia, fecha: cab.fecha }); setFile(null); setEfectivo(false); setLineas([])
    onListo()
  }

  return (
    <div className="panel-detalle">
      <h3>➕ Registrar compra</h3>
      {error && <div className="alerta">{error}</div>}

      {/* PASO 1 — comprobante primero */}
      <div className="paso-voucher">
        <span className="t-label">1 · Comprobante</span>
        {!efectivo && (
          <label className="campo">
            <span>Voucher / foto de la boleta o factura</span>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        )}
        {file && !efectivo && <p className="nota">📎 {file.name}</p>}
        <label className="check-permiso" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={efectivo} onChange={(e) => { setEfectivo(e.target.checked); if (e.target.checked) setFile(null) }} />
          <span><b>Sin comprobante — en efectivo</b>. Se registra sin voucher y marcado como pago en efectivo.</span>
        </label>
      </div>

      {/* PASO 2 — datos de la compra */}
      <div style={{ opacity: paso1 ? 1 : .5, pointerEvents: paso1 ? 'auto' : 'none', marginTop: 6 }}>
        <span className="t-label">2 · Datos de la compra</span>
        <div className="filtros">
          <label className="campo"><span>Fecha</span>
            <input type="date" value={cab.fecha} onChange={(e) => setCab({ ...cab, fecha: e.target.value })} /></label>
          <label className="campo"><span>Proveedor</span>
            <SelectCat value={cab.proveedor} opciones={catProv} placeholder="Proveedor…"
              onChange={(v) => setCab({ ...cab, proveedor: v })} onCrear={onCrearProv} /></label>
          <label className="campo"><span>Destino</span>
            <select value={cab.destino_sede_id} onChange={(e) => setCab({ ...cab, destino_sede_id: e.target.value })}>
              <option value="">Oficina / almacén</option>
              {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select></label>
          {!efectivo && (<>
            <label className="campo"><span>Medio</span>
              <select value={cab.medio_pago} onChange={(e) => setCab({ ...cab, medio_pago: e.target.value })}>
                {MEDIOS_COMPRA.map((m) => <option key={m} value={m}>{m}</option>)}
              </select></label>
            <label className="campo"><span>N° comprobante</span>
              <input value={cab.comprobante} placeholder="F001-123 / boleta…" onChange={(e) => setCab({ ...cab, comprobante: e.target.value })} /></label>
          </>)}
        </div>

        {/* PASO 3 — productos que cubre */}
        <span className="t-label" style={{ marginTop: 10, display: 'block' }}>3 · Productos que cubre</span>
        {lineas.length > 0 && (
          <table className="tabla" style={{ marginBottom: 8 }}>
            <thead><tr><th>Producto</th><th>Cant.</th><th>Precio unit.</th><th>Subtotal</th><th></th></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td><strong>{l.nombre}</strong> <span className="nota">{l.unidad}</span></td>
                  <td>{l.cantidad}</td>
                  <td>{soles(l.precio)}</td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{soles(l.cantidad * l.precio)}</td>
                  <td><button className="btn-mini btn-peligro" onClick={() => quitarLinea(i)}>✕</button></td>
                </tr>
              ))}
              <tr><td colSpan="3"><strong>Total de la compra</strong></td><td style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{soles(totalCompra)}</td><td></td></tr>
            </tbody>
          </table>
        )}
        <div className="form-inline">
          <select value={nueva.producto_id} onChange={(e) => setNueva({ ...nueva, producto_id: e.target.value })} style={{ minWidth: 180 }}>
            <option value="">Producto…</option>
            {prodActivos.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.unidad})</option>)}
          </select>
          <input type="number" step="0.001" placeholder="Cant." className="in-num" value={nueva.cantidad} onChange={(e) => setNueva({ ...nueva, cantidad: e.target.value })} style={{ maxWidth: 90 }} />
          <input type="number" step="0.01" placeholder="Precio unit." className="in-num" value={nueva.precio} onChange={(e) => setNueva({ ...nueva, precio: e.target.value })} style={{ maxWidth: 110 }} />
          <button className="btn-mini" onClick={agregarLinea}>+ Añadir producto</button>
        </div>
      </div>

      <div className="acciones" style={{ marginTop: 12 }}>
        <button className="btn-guardar" onClick={guardar} disabled={ocupado || !paso1 || !lineas.length}>
          {ocupado ? 'Guardando…' : !paso1 ? 'Primero el comprobante o marca "en efectivo"' : !lineas.length ? 'Agrega los productos' : `Guardar compra (${soles(totalCompra)})`}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Recepción desde Compras: Juan/almacén elige una sede y valida su entrega.
// (La cocina de cada sede hace lo mismo desde "Mi Lista".)
function RecepcionTab({ sedes, perfil, puedeRecibir }) {
  const [sedeSel, setSedeSel] = useState(sedes[0]?.id || '')
  const sede = sedes.find((s) => s.id === sedeSel)
  return (
    <div>
      <div className="form-inline" style={{ marginBottom: 10 }}>
        <label className="campo"><span>Sede</span>
          <select value={sedeSel} onChange={(e) => setSedeSel(e.target.value)}>
            <option value="">Elige…</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
      </div>
      <Recepcion sedeId={sedeSel} sedeNombre={sede?.nombre} perfil={perfil} puedeRecibir={puedeRecibir} />
    </div>
  )
}

// ---------------------------------------------------------------------
// CAJA DIARIA DE JUAN. Su dinero sale SOLO de Amazonas. Cada día:
//   vuelto anterior + efec. Amazonas mañana + efec. Amazonas tarde + adicionales
//   − compras del día − entregas a gerencia = saldo (base del día siguiente).
// El efectivo de Amazonas se auto-sugiere desde caja_turno del día que cerró
// (día anterior); Juan puede corregirlo. Las entregas a gerencia NO son gasto,
// pero salen de su caja. Adicionales y entregas llevan su(s) comprobante(s).
function CajaJuanTab({ sedes, perfil, puedeOperar, historico }) {
  const [fecha, setFecha] = useState(fmt(new Date()))
  const [cuadre, setCuadre] = useState(null)       // fila fondo_compras_dia de esta fecha
  const [base, setBase] = useState('')             // base_inicial (vuelto anterior)
  const [manana, setManana] = useState('')
  const [tarde, setTarde] = useState('')
  const [movs, setMovs] = useState([])             // fondo_movimientos del día
  const [comprasDia, setComprasDia] = useState(0)  // suma de compras del día
  const [contado, setContado] = useState('')       // efectivo FÍSICO contado al cerrar
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState('')

  const amazonas = useMemo(() => sedes.find((s) => /AMAZONAS/i.test(s.nombre)), [sedes])

  async function cargar() {
    setCargando(true); setMsg('')
    const prev = diaAnterior(fecha)
    const [dia, movR, cmp, turnos, cuadrePrev] = await Promise.all([
      supabase.from('fondo_compras_dia').select('*').eq('fecha', fecha).maybeSingle(),
      supabase.from('fondo_movimientos').select('*').eq('fecha', fecha).order('created_at'),
      supabase.from('compras').select('total').eq('fecha', fecha),
      amazonas ? supabase.from('caja_turno').select('turno, efectivo').eq('sede_id', amazonas.id).eq('fecha', prev)
        : Promise.resolve({ data: [] }),
      supabase.from('fondo_compras_dia').select('vuelto_saldo').lt('fecha', fecha).order('fecha', { ascending: false }).limit(1).maybeSingle(),
    ])
    const row = dia.data
    setCuadre(row); setMovs(movR.data || [])
    setComprasDia((cmp.data || []).reduce((a, x) => a + Number(x.total || 0), 0))
    const tMan = (turnos.data || []).find((t) => t.turno === 'manana')?.efectivo
    const tTar = (turnos.data || []).find((t) => t.turno === 'tarde')?.efectivo
    // Si ya hay cuadre guardado, muestra lo guardado; si no, auto-sugiere.
    setBase(row ? row.base_inicial : (cuadrePrev.data?.vuelto_saldo ?? ''))
    setManana(row ? row.efectivo_manana : (tMan ?? ''))
    setTarde(row ? row.efectivo_tarde : (tTar ?? ''))
    setContado(row?.efectivo_contado != null ? String(row.efectivo_contado) : '')
    setCargando(false)
  }
  useEffect(() => { cargar() }, [fecha])   // eslint-disable-line react-hooks/exhaustive-deps

  const adicionales = movs.filter((m) => m.tipo === 'adicional').reduce((a, m) => a + Number(m.monto || 0), 0)
  const entregas = movs.filter((m) => m.tipo === 'entrega_gerencia').reduce((a, m) => a + Number(m.monto || 0), 0)
  const disponible = Number(base || 0) + Number(manana || 0) + Number(tarde || 0) + adicionales
  const saldo = disponible - comprasDia - entregas
  const bloqueado = cuadre?.cerrado || !puedeOperar

  async function guardarCuadre(cerrar) {
    setMsg('')
    const { error } = await supabase.from('fondo_compras_dia').upsert({
      fecha, base_inicial: Number(base || 0), efectivo_manana: Number(manana || 0), efectivo_tarde: Number(tarde || 0),
      adicionales, dinero_total: disponible, gasto_total: comprasDia, entrega_admin: entregas,
      vuelto_saldo: saldo, efectivo_contado: contado === '' ? null : Number(contado),
      cerrado: !!cerrar, cerrado_por: cerrar ? (perfil?.id || null) : null,
    }, { onConflict: 'fecha' })
    if (error) return setMsg(error.message)
    setMsg(cerrar ? '✅ Día cerrado. El saldo es la base de mañana.' : '💾 Cuadre guardado.')
    cargar()
  }

  const hist = (historico || []).filter((x) => x.fecha !== fecha).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 30)

  return (
    <div>
      <p className="pagina-sub">La caja de Juan: arranca con el vuelto de ayer más el efectivo de Amazonas (mañana y tarde), registra sus compras y entregas a gerencia, y cierra con el saldo — que es la base del día siguiente.</p>

      <div className="form-inline" style={{ marginBottom: 8 }}>
        <label className="campo"><span>Día</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        {cuadre?.cerrado && <span className="chip chip-ok" style={{ alignSelf: 'flex-end' }}>Día cerrado</span>}
        {!amazonas && <span className="nota" style={{ alignSelf: 'flex-end' }}>⚠ No encuentro la sede Amazonas — digita el efectivo a mano.</span>}
      </div>
      {msg && <div className="alerta">{msg}</div>}

      {cargando ? <p className="nota">Cargando…</p> : (<>
        {/* El cuadre: entra − sale = saldo */}
        <div className="panel-detalle">
          <h3>Cuadre del día</h3>
          <table className="tabla">
            <tbody>
              <tr><td>Vuelto de ayer (base)</td><td style={{ textAlign: 'right' }}>
                {puedeOperar && !bloqueado ? <input type="number" step="0.01" className="in-num" value={base} onChange={(e) => setBase(e.target.value)} style={{ maxWidth: 120 }} /> : soles(base)}</td></tr>
              <tr><td>+ Efectivo Amazonas mañana <span className="nota">({diaAnterior(fecha)})</span></td><td style={{ textAlign: 'right' }}>
                {puedeOperar && !bloqueado ? <input type="number" step="0.01" className="in-num" value={manana} onChange={(e) => setManana(e.target.value)} style={{ maxWidth: 120 }} /> : soles(manana)}</td></tr>
              <tr><td>+ Efectivo Amazonas tarde</td><td style={{ textAlign: 'right' }}>
                {puedeOperar && !bloqueado ? <input type="number" step="0.01" className="in-num" value={tarde} onChange={(e) => setTarde(e.target.value)} style={{ maxWidth: 120 }} /> : soles(tarde)}</td></tr>
              <tr><td>+ Adicionales <span className="nota">(depósitos/efectivo extra)</span></td><td style={{ textAlign: 'right' }}>{soles(adicionales)}</td></tr>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--linea, #ccc)' }}><td>Dinero disponible</td><td style={{ textAlign: 'right' }}>{soles(disponible)}</td></tr>
              <tr><td>− Compras del día</td><td style={{ textAlign: 'right', color: 'var(--rojo)' }}>{soles(comprasDia)}</td></tr>
              <tr><td>− Entregas a gerencia <span className="nota">(sale de caja, no es gasto)</span></td><td style={{ textAlign: 'right', color: 'var(--rojo)' }}>{soles(entregas)}</td></tr>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--linea, #ccc)' }}><td>Debería quedarte</td><td style={{ textAlign: 'right', fontSize: 18 }}>{soles(saldo)}</td></tr>
              {/* El saldo de arriba es aritmética: cuadra solo. El control real es contar. */}
              <tr><td>Efectivo contado <span className="nota">(cuenta lo que te quedó)</span></td><td style={{ textAlign: 'right' }}>
                {puedeOperar && !bloqueado
                  ? <input type="number" step="0.01" className="in-num" value={contado} onChange={(e) => setContado(e.target.value)} placeholder={saldo.toFixed(2)} style={{ maxWidth: 120 }} />
                  : (contado === '' ? '—' : soles(contado))}</td></tr>
              {contado !== '' && (
                <tr style={{ fontWeight: 700 }}><td>Diferencia</td><td style={{ textAlign: 'right' }}>
                  {Number(contado) - saldo === 0
                    ? <span className="chip chip-ok">Cuadra</span>
                    : Number(contado) - saldo < 0
                      ? <span className="chip" style={{ background: '#fee2e2', color: '#991b1b' }}>Falta {soles(saldo - Number(contado))}</span>
                      : <span className="chip" style={{ background: '#fef9c3', color: '#854d0e' }}>Sobra {soles(Number(contado) - saldo)}</span>}
                </td></tr>
              )}
            </tbody>
          </table>
          {puedeOperar && (
            <div className="acciones" style={{ marginTop: 10 }}>
              <button className="btn-mini" onClick={() => guardarCuadre(false)} disabled={bloqueado}>💾 Guardar</button>
              {!cuadre?.cerrado
                ? <button className="btn-guardar" onClick={() => guardarCuadre(true)}>🔒 Cerrar el día</button>
                : <button className="btn-mini" onClick={() => guardarCuadre(false)}>🔓 Reabrir</button>}
            </div>
          )}
        </div>

        <div className="dos-cols">
          <MovBloque tipo="adicional" titulo="Adicionales que le dieron" fecha={fecha} perfil={perfil} puedeOperar={puedeOperar && !bloqueado} movs={movs} onCambio={cargar} />
          <MovBloque tipo="entrega_gerencia" titulo="Entregas a gerencia" fecha={fecha} perfil={perfil} puedeOperar={puedeOperar && !bloqueado} movs={movs} onCambio={cargar} />
        </div>

        {hist.length > 0 && (<>
          <h2 className="sub-titulo" style={{ marginTop: 18 }}>Días anteriores</h2>
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Base</th><th>Efec. mañana</th><th>Efec. tarde</th><th>Compras</th><th>A gerencia</th><th>Saldo</th></tr></thead>
            <tbody>
              {hist.map((x) => (
                <tr key={x.fecha} style={{ cursor: 'pointer' }} onClick={() => setFecha(x.fecha)}>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.fecha}{x.cerrado && ' 🔒'}</td>
                  <td>{soles(x.base_inicial)}</td><td>{soles(x.efectivo_manana)}</td><td>{soles(x.efectivo_tarde)}</td>
                  <td style={{ color: 'var(--rojo)' }}>{soles(x.gasto_total)}</td><td>{soles(x.entrega_admin)}</td>
                  <td style={{ fontWeight: 700 }}>{soles(x.vuelto_saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>)}
      </>)}
    </div>
  )
}

// Bloque de movimientos del fondo (adicionales o entregas a gerencia), cada uno
// con su monto, medio, nota y 1 o varios comprobantes.
const MEDIOS_FONDO = ['efectivo', 'deposito', 'yape', 'transferencia']
function MovBloque({ tipo, titulo, fecha, perfil, puedeOperar, movs, onCambio }) {
  const [monto, setMonto] = useState('')
  const [medio, setMedio] = useState(tipo === 'adicional' ? 'deposito' : 'efectivo')
  const [nota, setNota] = useState('')
  const [files, setFiles] = useState([])
  const [ocupado, setOcupado] = useState(false)
  const lista = movs.filter((m) => m.tipo === tipo)
  const total = lista.reduce((a, m) => a + Number(m.monto || 0), 0)

  async function agregar() {
    if (!(Number(monto) > 0)) return alert('Monto mayor a 0.')
    setOcupado(true)
    let vouchers = []
    try { if (files.length) vouchers = await subirVouchers(files, `fondo/${fecha}`) }
    catch (e) { setOcupado(false); return alert('No pude subir el comprobante: ' + e.message) }
    const { error } = await supabase.from('fondo_movimientos').insert({
      fecha, tipo, monto: Number(monto), medio, nota: nota.trim() || null, vouchers, registrado_por: perfil?.id || null,
    })
    setOcupado(false)
    if (error) return alert(error.message)
    setMonto(''); setNota(''); setFiles([]); onCambio()
  }
  async function quitar(m) {
    if (!confirm('¿Quitar este movimiento?')) return
    if (m.vouchers?.length) await supabase.storage.from('arqueos').remove(m.vouchers)
    await supabase.from('fondo_movimientos').delete().eq('id', m.id); onCambio()
  }

  return (
    <div className="panel-detalle">
      <h3>{titulo} <span className="nota">{soles(total)}</span></h3>
      {lista.map((m) => (
        <div key={m.id} className="form-inline" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--linea, #eee)', padding: '4px 0' }}>
          <span><strong>{soles(m.monto)}</strong> <span className="nota">{m.medio}{m.nota ? ` · ${m.nota}` : ''}</span></span>
          <span>
            {(m.vouchers || []).map((v, i) => <button key={i} className="btn-mini" onClick={() => verArchivo(v)}>📎</button>)}
            {puedeOperar && <button className="btn-mini btn-peligro" onClick={() => quitar(m)}>✕</button>}
          </span>
        </div>
      ))}
      {lista.length === 0 && <p className="nota">Ninguno hoy.</p>}
      {puedeOperar && (
        <div className="form-inline" style={{ marginTop: 8 }}>
          <input type="number" step="0.01" placeholder="Monto" className="in-num" value={monto} onChange={(e) => setMonto(e.target.value)} style={{ maxWidth: 100 }} />
          <select value={medio} onChange={(e) => setMedio(e.target.value)}>{MEDIOS_FONDO.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <input placeholder="Nota" value={nota} onChange={(e) => setNota(e.target.value)} style={{ maxWidth: 130 }} />
          <label className="btn-mini" style={{ cursor: 'pointer' }}>📎 Comprob.{files.length ? ` (${files.length})` : ''}
            <input type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }} onChange={(e) => setFiles(Array.from(e.target.files || []))} /></label>
          <button className="btn-mini" onClick={agregar} disabled={ocupado}>{ocupado ? '…' : '+ Añadir'}</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Catálogo de productos (el maestro con unidad). De aquí elige la cocina.
const UNIDADES = ['kg', 'unidad', 'caja', 'litro', 'atado', 'paquete', 'bolsa', 'docena']

function CatalogoTab({ catalogo, puedeEditar, onCambio }) {
  const [nuevo, setNuevo] = useState({ nombre: '', unidad: 'kg', categoria: '' })
  const [busca, setBusca] = useState('')
  const fil = catalogo.filter((p) => !busca || p.nombre.toLowerCase().includes(busca.toLowerCase()))

  async function agregar() {
    const nombre = nuevo.nombre.toUpperCase().replace(/\s+/g, ' ').trim()
    if (!nombre) return
    const { error } = await supabase.from('productos').insert({ nombre, unidad: nuevo.unidad, categoria: nuevo.categoria.trim().toUpperCase() || null })
    if (error) return alert(/duplicate|unique/i.test(error.message) ? 'Ese producto ya existe.' : error.message)
    setNuevo({ nombre: '', unidad: 'kg', categoria: '' }); onCambio()
  }
  async function editar(id, campo, valor) {
    await supabase.from('productos').update({ [campo]: valor }).eq('id', id); onCambio()
  }
  async function subirFoto(p, file) {
    if (!file) return
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const ruta = `productos/${p.id}.${ext}`
    const { error } = await supabase.storage.from('arqueos').upload(ruta, file, { contentType: file.type || undefined, upsert: true })
    if (error) return alert('No pude subir la foto: ' + error.message)
    await editar(p.id, 'foto_url', ruta)
  }
  async function verFoto(ruta) {
    const { data } = await supabase.storage.from('arqueos').createSignedUrl(ruta, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div>
      <p className="pagina-sub">El catálogo de productos: unidad, ubicación en el almacén y foto. De aquí elige la cocina su lista.</p>
      {puedeEditar && (
        <div className="form-inline">
          <input placeholder="Producto (ej: PAPA)" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && agregar()} style={{ minWidth: 180 }} />
          <select value={nuevo.unidad} onChange={(e) => setNuevo({ ...nuevo, unidad: e.target.value })}>
            {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <input placeholder="Categoría (opcional)" value={nuevo.categoria} onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })} />
          <button onClick={agregar}>+ Añadir producto</button>
        </div>
      )}
      <div className="form-inline"><input placeholder="🔎 Buscar producto…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 220 }} /><span className="nota" style={{ alignSelf: 'center' }}>{fil.length} de {catalogo.length}</span></div>
      <table className="tabla">
        <thead><tr><th>Producto</th><th>Unidad</th><th>Compra x mayor</th><th>Categoría</th><th>Ubicación</th><th>Foto</th><th>Estado</th></tr></thead>
        <tbody>
          {fil.map((p) => (
            <tr key={p.id} className={p.activo ? '' : 'fila-inactiva'}>
              <td><strong>{p.nombre}</strong></td>
              <td>{puedeEditar
                ? <select value={p.unidad} onChange={(e) => editar(p.id, 'unidad', e.target.value)}>{UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}{!UNIDADES.includes(p.unidad) && <option value={p.unidad}>{p.unidad}</option>}</select>
                : p.unidad}</td>
              <td>{puedeEditar ? (
                <span className="nota" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  1 <input defaultValue={p.unidad_compra || ''} placeholder="saco" onBlur={(e) => e.target.value.trim().toLowerCase() !== (p.unidad_compra || '') && editar(p.id, 'unidad_compra', e.target.value.trim().toLowerCase() || null)} style={{ maxWidth: 70 }} />
                  = <input type="number" step="0.001" defaultValue={p.factor_compra || ''} placeholder="25" onBlur={(e) => Number(e.target.value) !== Number(p.factor_compra || 0) && editar(p.id, 'factor_compra', Number(e.target.value) || null)} style={{ maxWidth: 60 }} /> {p.unidad}
                </span>
              ) : (p.unidad_compra ? `1 ${p.unidad_compra} = ${p.factor_compra || '?'} ${p.unidad}` : '—')}</td>
              <td>{p.categoria || '—'}</td>
              <td>{puedeEditar
                ? <input defaultValue={p.ubicacion || ''} placeholder="Estante A2…" onBlur={(e) => e.target.value !== (p.ubicacion || '') && editar(p.id, 'ubicacion', e.target.value.trim().toUpperCase() || null)} style={{ maxWidth: 120 }} />
                : (p.ubicacion || '—')}</td>
              <td>
                {p.foto_url && <button className="btn-mini" onClick={() => verFoto(p.foto_url)}>📷 Ver</button>}
                {puedeEditar && <label className="btn-mini" style={{ cursor: 'pointer' }}>{p.foto_url ? 'Cambiar' : '+ Foto'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => subirFoto(p, e.target.files?.[0])} /></label>}
              </td>
              <td>{puedeEditar
                ? <button className={`chip ${p.activo ? 'chip-ok' : 'chip-off'}`} onClick={() => editar(p.id, 'activo', !p.activo)}>{p.activo ? 'Activo' : 'Inactivo'}</button>
                : <span className={`chip ${p.activo ? 'chip-ok' : 'chip-off'}`}>{p.activo ? 'Activo' : 'Inactivo'}</span>}</td>
            </tr>
          ))}
          {catalogo.length === 0 && <tr><td colSpan="7" className="nota">Catálogo vacío. Añade productos arriba (o se siembra desde las compras).</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------
// Proveedores con su contacto (número y ubicación).
function ProveedoresTab({ proveedores, puedeEditar, onCambio }) {
  const [nuevo, setNuevo] = useState({ nombre: '', telefono: '', ubicacion: '' })
  const [edit, setEdit] = useState(null)
  const [b, setB] = useState({})

  async function agregar() {
    const nombre = nuevo.nombre.toUpperCase().replace(/\s+/g, ' ').trim()
    if (!nombre) return
    const { error } = await supabase.from('proveedores').insert({ nombre, telefono: nuevo.telefono.trim() || null, ubicacion: nuevo.ubicacion.trim() || null })
    if (error) return alert(/duplicate|unique/i.test(error.message) ? 'Ese proveedor ya existe.' : error.message)
    setNuevo({ nombre: '', telefono: '', ubicacion: '' }); onCambio()
  }
  async function guardar(id) {
    await supabase.from('proveedores').update({ telefono: b.telefono?.trim() || null, ubicacion: b.ubicacion?.trim() || null, nota: b.nota?.trim() || null }).eq('id', id)
    setEdit(null); onCambio()
  }

  return (
    <div>
      <p className="pagina-sub">Los proveedores con su número y ubicación, para tenerlos a la mano.</p>
      {puedeEditar && (
        <div className="form-inline">
          <input placeholder="Proveedor" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} style={{ minWidth: 160 }} />
          <input placeholder="Teléfono" value={nuevo.telefono} onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} style={{ maxWidth: 130 }} />
          <input placeholder="Ubicación" value={nuevo.ubicacion} onChange={(e) => setNuevo({ ...nuevo, ubicacion: e.target.value })} />
          <button onClick={agregar}>+ Añadir proveedor</button>
        </div>
      )}
      <table className="tabla">
        <thead><tr><th>Proveedor</th><th>Teléfono</th><th>Ubicación</th>{puedeEditar && <th></th>}</tr></thead>
        <tbody>
          {proveedores.map((p) => edit === p.id ? (
            <tr key={p.id} className="fila-edit">
              <td><strong>{p.nombre}</strong></td>
              <td><input value={b.telefono ?? ''} onChange={(e) => setB({ ...b, telefono: e.target.value })} placeholder="Teléfono" style={{ maxWidth: 120 }} /></td>
              <td><input value={b.ubicacion ?? ''} onChange={(e) => setB({ ...b, ubicacion: e.target.value })} placeholder="Ubicación" /></td>
              <td className="acciones"><button className="btn-mini btn-ok" onClick={() => guardar(p.id)}>✓</button><button className="btn-mini" onClick={() => setEdit(null)}>✕</button></td>
            </tr>
          ) : (
            <tr key={p.id} className={p.activo === false ? 'fila-inactiva' : ''}>
              <td><strong>{p.nombre}</strong></td>
              <td>{p.telefono ? <a href={`tel:${p.telefono}`}>{p.telefono}</a> : '—'}</td>
              <td>{p.ubicacion || '—'}</td>
              {puedeEditar && <td><button className="btn-mini" onClick={() => { setEdit(p.id); setB({ telefono: p.telefono || '', ubicacion: p.ubicacion || '', nota: p.nota || '' }) }}>✎</button></td>}
            </tr>
          ))}
          {proveedores.length === 0 && <tr><td colSpan="4" className="nota">Sin proveedores.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------
// Almacén central + Kardex. Cesar INGRESA la compra al por mayor; se reparte a
// las sedes (SALIDA). El kardex muestra, por producto, cada movimiento con el
// saldo corriendo.
function KardexTab({ catalogo, sedes, puedeMover }) {
  const [stock, setStock] = useState([])
  const [movs, setMovs] = useState([])
  const [prodSel, setProdSel] = useState('')
  const [cargando, setCargando] = useState(true)
  const [mov, setMov] = useState({ tipo: 'ingreso', producto_id: '', cantidad: '', sede_id: '', nota: '', fecha: fmt(new Date()) })

  async function cargar() {
    setCargando(true)
    const [{ data: s }, { data: m }] = await Promise.all([
      supabase.from('vista_almacen_stock').select('*'),
      supabase.from('almacen_movimientos').select('*').order('fecha', { ascending: false }).limit(3000),
    ])
    setStock(s || []); setMovs(m || []); setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const prodN = useMemo(() => Object.fromEntries(catalogo.map((p) => [p.id, p])), [catalogo])
  const sedeN = useMemo(() => Object.fromEntries(sedes.map((s) => [s.id, s.nombre])), [sedes])

  // Kardex del producto elegido: movimientos en orden cronológico con saldo.
  const kardex = useMemo(() => {
    if (!prodSel) return []
    const suyos = movs.filter((m) => m.producto_id === prodSel)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (a.created_at || '').localeCompare(b.created_at || ''))
    let saldo = 0
    return suyos.map((m) => { saldo += m.tipo === 'ingreso' ? Number(m.cantidad || 0) : -Number(m.cantidad || 0); return { ...m, saldo } })
  }, [movs, prodSel])

  async function registrar() {
    if (!mov.producto_id) return alert('Elige el producto.')
    if (!(Number(mov.cantidad) > 0)) return alert('Cantidad mayor a 0.')
    if (mov.tipo === 'salida' && !mov.sede_id) return alert('Elige a qué sede sale.')
    const { error } = await supabase.from('almacen_movimientos').insert({
      producto_id: mov.producto_id, tipo: mov.tipo, cantidad: Number(mov.cantidad),
      sede_id: mov.tipo === 'salida' ? mov.sede_id : null, nota: mov.nota.trim() || null, fecha: mov.fecha,
    })
    if (error) return alert(error.message)
    setMov({ ...mov, cantidad: '', nota: '' }); cargar()
  }

  return (
    <div>
      <p className="pagina-sub">El almacén central: Cesar ingresa la compra al por mayor y se reparte a las sedes. El kardex lleva el saldo de cada producto.</p>

      {puedeMover && (
        <div className="panel-detalle">
          <h3>Registrar movimiento</h3>
          <div className="form-inline">
            <select value={mov.tipo} onChange={(e) => setMov({ ...mov, tipo: e.target.value })}>
              <option value="ingreso">⬆ Ingreso (compra al por mayor)</option>
              <option value="salida">⬇ Salida (repartir a sede)</option>
            </select>
            <select value={mov.producto_id} onChange={(e) => setMov({ ...mov, producto_id: e.target.value })} style={{ minWidth: 180 }}>
              <option value="">Producto…</option>
              {catalogo.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.unidad})</option>)}
            </select>
            <input type="number" placeholder="Cant." className="in-num" value={mov.cantidad} onChange={(e) => setMov({ ...mov, cantidad: e.target.value })} style={{ maxWidth: 90 }} />
            {mov.tipo === 'salida' && (
              <select value={mov.sede_id} onChange={(e) => setMov({ ...mov, sede_id: e.target.value })}>
                <option value="">¿A qué sede?</option>
                {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            )}
            <input type="date" value={mov.fecha} onChange={(e) => setMov({ ...mov, fecha: e.target.value })} />
            <input placeholder="Nota" value={mov.nota} onChange={(e) => setMov({ ...mov, nota: e.target.value })} />
            <button onClick={registrar}>+ Registrar</button>
          </div>
        </div>
      )}

      <h2 className="sub-titulo" style={{ marginTop: 18 }}>Stock del almacén</h2>
      {cargando ? <p className="nota">Cargando…</p> : (
        <table className="tabla">
          <thead><tr><th>Producto</th><th>Stock</th><th>Ubicación</th><th></th></tr></thead>
          <tbody>
            {stock.filter((s) => s.stock !== 0 || movs.some((m) => m.producto_id === s.producto_id)).map((s) => (
              <tr key={s.producto_id} className={prodSel === s.producto_id ? 'fila-edit' : ''}>
                <td><strong>{s.nombre}</strong></td>
                <td style={{ fontWeight: 700, color: Number(s.stock) < 0 ? 'var(--rojo)' : undefined }}>{Number(s.stock).toLocaleString('es-PE')} {s.unidad}</td>
                <td>{prodN[s.producto_id]?.ubicacion || '—'}</td>
                <td><button className="btn-mini" onClick={() => setProdSel(prodSel === s.producto_id ? '' : s.producto_id)}>{prodSel === s.producto_id ? 'Cerrar' : '📖 Kardex'}</button></td>
              </tr>
            ))}
            {stock.every((s) => s.stock === 0) && !movs.length && <tr><td colSpan="4" className="nota">El almacén está vacío. Registra un ingreso arriba.</td></tr>}
          </tbody>
        </table>
      )}

      {prodSel && (
        <div className="panel-detalle">
          <h3>Kardex — {prodN[prodSel]?.nombre}</h3>
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th>Entra</th><th>Sale</th><th>Saldo</th><th>Detalle</th></tr></thead>
            <tbody>
              {kardex.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{m.fecha}</td>
                  <td><span className={`chip ${m.tipo === 'ingreso' ? 'chip-ok' : 'chip-off'}`}>{m.tipo}</span></td>
                  <td>{m.tipo === 'ingreso' ? Number(m.cantidad).toLocaleString('es-PE') : ''}</td>
                  <td>{m.tipo === 'salida' ? Number(m.cantidad).toLocaleString('es-PE') : ''}</td>
                  <td style={{ fontWeight: 700 }}>{Number(m.saldo).toLocaleString('es-PE')}</td>
                  <td className="nota">{m.sede_id ? `→ ${sedeN[m.sede_id] || '—'}` : ''}{m.nota ? ` ${m.nota}` : ''}</td>
                </tr>
              ))}
              {kardex.length === 0 && <tr><td colSpan="6" className="nota">Sin movimientos de este producto.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Consolidado POR SEDE + Pedidos de Juan a Cesar.
// Circuito: cocina envía su lista → Juan ve el consolidado (total y por sede) →
// arma SU pedido (puede pedir en otra unidad, ej. sacos) y lo ENVÍA → Cesar
// reconfirma, ajusta lo que realmente entra (unidad base del catálogo), pone
// comprobantes y al ACEPTAR recién ingresa al almacén.
const EST_LABEL = { pendiente: 'Armando', enviado: 'Enviado a Cesar', comprado: 'Comprado', recibido: 'Recibido', anulado: 'Anulado' }

function PedidosTab({ catalogo, sedes, perfil, esAdmin, esCesar }) {
  const [consol, setConsol] = useState([])   // vista_consolidado_sede (producto × sede)
  const [pedidos, setPedidos] = useState([])
  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(true)
  const [add, setAdd] = useState({})          // {pedidoId: {producto_id, cantidad, unidad}}
  const [ing, setIng] = useState({})          // {itemId: cantidad_ingreso} — edición de Cesar
  const [conf, setConf] = useState({})        // {pedidoId: {comprobante, files}}

  async function cargar() {
    setCargando(true)
    const [{ data: c }, { data: p }, { data: it }] = await Promise.all([
      supabase.from('vista_consolidado_sede').select('*'),
      supabase.from('pedidos').select('*').order('fecha', { ascending: false }).limit(200),
      supabase.from('pedido_items').select('*'),
    ])
    setConsol(c || []); setPedidos(p || []); setItems(it || []); setCargando(false)
  }
  useEffect(() => { cargar() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const prodN = useMemo(() => Object.fromEntries(catalogo.map((p) => [p.id, p])), [catalogo])
  const itemsDe = (pid) => items.filter((x) => x.pedido_id === pid)

  // Consolidado pivotado: por producto, cantidad por sede + total.
  const sedeNombres = useMemo(() => [...new Set(consol.map((c) => c.sede).filter(Boolean))].sort(), [consol])
  const consolPivot = useMemo(() => {
    const m = {}
    for (const c of consol) {
      const k = c.clave
      m[k] = m[k] || { clave: k, producto: c.producto, unidad: c.unidad, porSede: {}, total: 0, libre: String(k).startsWith('libre:') }
      m[k].porSede[c.sede] = (m[k].porSede[c.sede] || 0) + Number(c.cantidad || 0)
      m[k].total += Number(c.cantidad || 0)
    }
    return Object.values(m).sort((a, b) => a.producto.localeCompare(b.producto))
  }, [consol])

  // Unidades para pedir un producto: la base + la de compra (si tiene).
  const unidadesDe = (prod) => [prod?.unidad, prod?.unidad_compra].filter(Boolean)

  async function nuevoPedido() {
    const { data, error } = await supabase.from('pedidos').insert({ estado: 'pendiente', creado_por: perfil?.id || null }).select().single()
    if (error) return alert(error.message)
    setPedidos((p) => [data, ...p])
  }
  async function armarConConsolidado(pid) {
    const filas = consolPivot.filter((c) => !c.libre).map((c) => ({
      pedido_id: pid, producto_id: c.clave, cantidad: c.total, unidad: prodN[c.clave]?.unidad || c.unidad, comprado: false,
    }))
    if (!filas.length) return alert('El consolidado no tiene productos del catálogo (solo texto libre).')
    const { error } = await supabase.from('pedido_items').insert(filas)
    if (error) return alert(error.message)
    cargar()
  }
  async function addItem(pid) {
    const a = add[pid] || {}
    if (!a.producto_id || !(Number(a.cantidad) > 0)) return
    const p = prodN[a.producto_id]
    const { error } = await supabase.from('pedido_items').insert({ pedido_id: pid, producto_id: a.producto_id, cantidad: Number(a.cantidad), unidad: a.unidad || p?.unidad, comprado: false })
    if (error) return alert(error.message)
    setAdd((s) => ({ ...s, [pid]: {} })); cargar()
  }
  async function editarItem(it, campo, valor) {
    await supabase.from('pedido_items').update({ [campo]: valor }).eq('id', it.id); cargar()
  }
  async function quitarItem(id) { await supabase.from('pedido_items').delete().eq('id', id); cargar() }
  async function setEstado(ped, estado) { await supabase.from('pedidos').update({ estado }).eq('id', ped.id); cargar() }

  // Cesar acepta: fija lo que entra al almacén (unidad base), sube comprobantes,
  // crea los ingresos y marca recibido. SOLO aquí se toca el stock.
  async function aceptarEIngresar(ped) {
    const all = itemsDe(ped.id).filter((x) => x.producto_id)
    if (!all.length) return alert('El pedido no tiene productos del catálogo.')
    // Solo se ingresa lo que AÚN no entró (cantidad_ingreso null): así reabrir un
    // pedido ya recibido y añadirle algo no duplica lo anterior en el almacén.
    const nuevos = all.filter((x) => x.cantidad_ingreso == null)
    const movs = nuevos.map((x) => {
      const sug = aUnidadBase(x.cantidad, x.unidad, prodN[x.producto_id])
      const cant = ing[x.id] !== undefined && ing[x.id] !== '' ? Number(ing[x.id]) : sug
      return { it: x, cant }
    })
    if (movs.some((m) => !(m.cant > 0))) return alert('Cada producto nuevo debe entrar con una cantidad mayor a 0.')
    if (!confirm(movs.length
      ? `¿Ingresar al almacén ${movs.length} producto(s)? Se descuenta luego al repartir a las sedes.`
      : 'No hay productos nuevos por ingresar. ¿Marcar el pedido como recibido?')) return
    const cc = conf[ped.id] || {}
    let vouchers = ped.vouchers || []
    try { if (cc.files?.length) vouchers = [...vouchers, ...await subirVouchers(cc.files, `pedidos/${ped.id.slice(0, 8)}`)] }
    catch (e) { return alert('No pude subir el comprobante: ' + e.message) }
    for (const m of movs) await supabase.from('pedido_items').update({ cantidad_ingreso: m.cant, comprado: true }).eq('id', m.it.id)
    if (movs.length) {
      const { error: eMov } = await supabase.from('almacen_movimientos').insert(movs.map((m) => ({
        producto_id: m.it.producto_id, tipo: 'ingreso', cantidad: m.cant, nota: 'Pedido ' + ped.id.slice(0, 6), fecha: fmt(new Date()),
      })))
      if (eMov) return alert(eMov.message)
    }
    await supabase.from('pedidos').update({ estado: 'recibido', confirmado_por: perfil?.id || null, vouchers,
      comprobante: cc.comprobante?.trim().toUpperCase() || ped.comprobante || null }).eq('id', ped.id)
    setConf((s) => ({ ...s, [ped.id]: {} }))
    alert(movs.length ? '✅ Ingresado al almacén. Ya puedes repartir a las sedes desde Almacén / Kardex.' : '✅ Pedido marcado como recibido.')
    cargar()
  }

  if (cargando) return <p className="nota">Cargando…</p>

  return (
    <div>
      <p className="pagina-sub">Lo que piden las sedes, por sede y sumado. Juan arma su pedido (puede pedir en otra unidad) y lo envía; Cesar reconfirma, pone comprobantes y al aceptar ingresa al almacén.</p>

      <div className="panel-detalle">
        <h3>📊 Consolidado — lo que piden las sedes</h3>
        {consolPivot.length === 0 ? <p className="nota">Ninguna sede tiene listas enviadas pendientes.</p> : (
          <table className="tabla">
            <thead><tr><th>Producto</th>{sedeNombres.map((s) => <th key={s}>{s}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {consolPivot.map((c) => (
                <tr key={c.clave}>
                  <td><strong>{c.producto}</strong>{c.libre && <span className="chip chip-off" style={{ marginLeft: 6 }}>texto libre</span>}</td>
                  {sedeNombres.map((s) => <td key={s}>{c.porSede[s] ? `${Number(c.porSede[s]).toLocaleString('es-PE')}` : '—'}</td>)}
                  <td style={{ fontWeight: 700 }}>{Number(c.total).toLocaleString('es-PE')} {c.unidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {esAdmin && <button className="btn-guardar" style={{ margin: '4px 0 14px' }} onClick={nuevoPedido}>+ Nuevo pedido a Cesar</button>}

      {pedidos.map((ped) => {
        const its = itemsDe(ped.id)
        const armando = ped.estado === 'pendiente'
        const enviado = ped.estado === 'enviado'
        const cerrado = ped.estado === 'recibido' || ped.estado === 'anulado'
        const juanEdita = esAdmin && armando
        const cesarConfirma = esCesar && enviado
        return (
          <div key={ped.id} className="panel-detalle">
            <h3>Pedido {ped.fecha} <span className={`chip ${ped.estado === 'recibido' ? 'chip-ok' : ped.estado === 'anulado' ? 'chip-off' : ''}`}>{EST_LABEL[ped.estado] || ped.estado}</span>
              {(ped.vouchers?.length > 0 || ped.comprobante) && <span className="nota" style={{ marginLeft: 8 }}>{ped.comprobante || ''} {(ped.vouchers || []).map((v, i) => <button key={i} className="btn-mini" onClick={() => verArchivo(v)}>📎</button>)}</span>}
            </h3>

            {juanEdita && (
              <div className="form-inline" style={{ marginBottom: 8 }}>
                <button className="btn-mini" onClick={() => armarConConsolidado(ped.id)}>⤵ Armar con el consolidado</button>
              </div>
            )}

            <table className="tabla">
              <thead><tr><th>Producto</th><th>Pide Juan</th>{(cesarConfirma || ped.estado === 'recibido') && <th>Entra al almacén</th>}{juanEdita && <th></th>}</tr></thead>
              <tbody>
                {its.map((it) => {
                  const prod = prodN[it.producto_id]
                  const sug = aUnidadBase(it.cantidad, it.unidad, prod)
                  return (
                    <tr key={it.id}>
                      <td><strong>{prod?.nombre || it.nombre_libre || '—'}</strong></td>
                      <td>
                        {juanEdita ? (
                          <span className="form-inline" style={{ gap: 4 }}>
                            <input type="number" step="0.001" defaultValue={it.cantidad} className="in-num" style={{ maxWidth: 80 }}
                              onBlur={(e) => Number(e.target.value) !== Number(it.cantidad) && editarItem(it, 'cantidad', Number(e.target.value) || 0)} />
                            <select value={it.unidad || prod?.unidad || ''} onChange={(e) => editarItem(it, 'unidad', e.target.value)}>
                              {unidadesDe(prod).map((u) => <option key={u} value={u}>{u}</option>)}
                              {it.unidad && !unidadesDe(prod).includes(it.unidad) && <option value={it.unidad}>{it.unidad}</option>}
                            </select>
                          </span>
                        ) : <span>{Number(it.cantidad).toLocaleString('es-PE')} {it.unidad || ''}</span>}
                      </td>
                      {cesarConfirma && (
                        <td>
                          {it.cantidad_ingreso != null
                            ? <span className="nota">{Number(it.cantidad_ingreso).toLocaleString('es-PE')} {prod?.unidad} <span className="chip chip-ok">ya entró</span></span>
                            : (<><input type="number" step="0.001" placeholder={String(sug)} className="in-num" style={{ maxWidth: 90 }}
                                value={ing[it.id] ?? (sug || '')} onChange={(e) => setIng((s) => ({ ...s, [it.id]: e.target.value }))} />
                              <span className="nota"> {prod?.unidad}</span></>)}
                        </td>
                      )}
                      {ped.estado === 'recibido' && <td>{it.cantidad_ingreso != null ? `${Number(it.cantidad_ingreso).toLocaleString('es-PE')} ${prod?.unidad || ''}` : '—'}</td>}
                      {juanEdita && <td><button className="btn-mini btn-peligro" onClick={() => quitarItem(it.id)}>✕</button></td>}
                    </tr>
                  )
                })}
                {its.length === 0 && <tr><td colSpan={4} className="nota">Sin productos. Arma con el consolidado o añade abajo.</td></tr>}
              </tbody>
            </table>

            {/* Juan: añadir productos + enviar a Cesar */}
            {juanEdita && (<>
              <div className="form-inline" style={{ marginTop: 8 }}>
                <select value={add[ped.id]?.producto_id || ''} onChange={(e) => { const pid = e.target.value; setAdd((s) => ({ ...s, [ped.id]: { producto_id: pid, cantidad: s[ped.id]?.cantidad || '', unidad: prodN[pid]?.unidad || '' } })) }} style={{ minWidth: 170 }}>
                  <option value="">Añadir producto…</option>
                  {catalogo.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.unidad})</option>)}
                </select>
                <input type="number" placeholder="Cant." className="in-num" value={add[ped.id]?.cantidad || ''} onChange={(e) => setAdd((s) => ({ ...s, [ped.id]: { ...s[ped.id], cantidad: e.target.value } }))} style={{ maxWidth: 80 }} />
                {add[ped.id]?.producto_id && (
                  <select value={add[ped.id]?.unidad || ''} onChange={(e) => setAdd((s) => ({ ...s, [ped.id]: { ...s[ped.id], unidad: e.target.value } }))}>
                    {unidadesDe(prodN[add[ped.id].producto_id]).map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                )}
                <button className="btn-mini" onClick={() => addItem(ped.id)}>+ Añadir</button>
              </div>
              <div className="acciones" style={{ marginTop: 10 }}>
                <button className="btn-guardar" onClick={() => its.length ? setEstado(ped, 'enviado') : alert('Agrega productos primero.')}>📨 Enviar a Cesar</button>
                <button className="btn-mini" onClick={() => setEstado(ped, 'anulado')}>Anular</button>
              </div>
            </>)}

            {/* Enviado, esperando a Cesar: Juan lo ve pero no lo toca */}
            {enviado && !esCesar && <p className="nota" style={{ marginTop: 8 }}>📨 Enviado. Esperando que Cesar lo reciba e ingrese al almacén.{esAdmin && ' Puedes reabrirlo si hay que corregir.'} {esAdmin && <button className="btn-mini" onClick={() => setEstado(ped, 'pendiente')}>🔓 Reabrir</button>}</p>}

            {/* Cesar: reconfirma, comprobante y acepta */}
            {cesarConfirma && (
              <div style={{ marginTop: 10 }}>
                <div className="form-inline">
                  <input placeholder="N° comprobante mayorista (opcional)" value={conf[ped.id]?.comprobante || ''} onChange={(e) => setConf((s) => ({ ...s, [ped.id]: { ...s[ped.id], comprobante: e.target.value } }))} style={{ minWidth: 200 }} />
                  <label className="btn-mini" style={{ cursor: 'pointer' }}>📎 Comprobantes{conf[ped.id]?.files?.length ? ` (${conf[ped.id].files.length})` : ''}
                    <input type="file" accept="image/*,application/pdf" multiple style={{ display: 'none' }} onChange={(e) => setConf((s) => ({ ...s, [ped.id]: { ...s[ped.id], files: Array.from(e.target.files || []) } }))} /></label>
                </div>
                <div className="acciones" style={{ marginTop: 8 }}>
                  <button className="btn-guardar" onClick={() => aceptarEIngresar(ped)}>✅ Aceptar e ingresar al almacén</button>
                  <button className="btn-mini" onClick={() => setEstado(ped, 'pendiente')}>🔓 Devolver a Juan</button>
                  <button className="btn-mini" onClick={() => setEstado(ped, 'anulado')}>Anular</button>
                </div>
              </div>
            )}

            {/* Cerrado (recibido/anulado): reabrir para añadir o corregir */}
            {cerrado && esAdmin && (
              <div className="acciones" style={{ marginTop: 8 }}>
                <button className="btn-mini" onClick={() => setEstado(ped, 'pendiente')}>🔓 Reabrir para añadir/corregir</button>
                {ped.estado === 'recibido' && <span className="nota">Lo que ya entró al almacén se queda; al re-aceptar solo entra lo nuevo.</span>}
              </div>
            )}
          </div>
        )
      })}
      {pedidos.length === 0 && <div className="bloque-vacio"><p>No hay pedidos todavía.{esAdmin ? ' Crea uno arriba.' : ''}</p></div>}
    </div>
  )
}
