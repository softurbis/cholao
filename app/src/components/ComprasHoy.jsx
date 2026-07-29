import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { comprimirVoucher } from '../lib/comprimirImagen'

// "Compras de hoy" — la pantalla ÚNICA de quien opera compras, en el celular.
//
// Cuando una sede pide algo hay TRES salidas, y las tres están aquí:
//   1. DEL ALMACÉN  → si ya hay stock, se lo entrega y sale del almacén.
//   2. COMPRAR      → lo compra en el mercado con la plata de su caja.
//   3. ABASTECIMIENTO→ al por mayor; administración lo compra e ingresa el
//                     stock al almacén (eso NO lo hace quien compra a diario).
// Antes cada una vivía en una pestaña distinta y había que saltar entre ellas.
//
// Lo demás que sostiene la pantalla:
//   · el saldo del día EN VIVO arriba (los tres riesgos del negocio son de dinero);
//   · el comprobante se toma UNA vez al llegar al proveedor y queda "activo";
//   · +/− grandes, un solo campo con teclado (el precio), destino en pastillas.
//
// Al comprar: destino ALMACÉN → ingreso al kardex. Destino SEDE → entrega directa,
// NO toca el stock central (esa mercadería nunca pasó por el almacén; descontarla
// lo dejaba en negativo).
//
// La lista de las sedes es GUÍA, no contrato: si pidieron 10 y compró 8, se guarda
// 8 y la diferencia queda registrada sola.
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const diaAnterior = (iso) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - 1); return fmt(d) }
const num = (v) => Number(v || 0)

export default function ComprasHoy({ perfil, sedes, catalogo, onCambio }) {
  const hoy = fmt(new Date())
  const [cargando, setCargando] = useState(true)
  const [consol, setConsol] = useState([])
  const [compras, setCompras] = useState([])
  const [stock, setStock] = useState({})            // {producto_id: cantidad en almacén}
  const [pedItems, setPedItems] = useState([])      // lo ya pedido para abastecimiento
  const [caja, setCaja] = useState({ base: 0, manana: 0, tarde: 0, adic: 0, entregas: 0 })
  const [proveedores, setProveedores] = useState([])
  const [refPrecios, setRefPrecios] = useState({})

  const [comp, setComp] = useState(null)            // comprobante activo
  const [panelComp, setPanelComp] = useState(false)
  const [abierto, setAbierto] = useState(null)
  const [bor, setBor] = useState({ modo: 'comprar', cantidad: '', precio: '', destino: '' })
  const [otro, setOtro] = useState('')
  const [msg, setMsg] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const amazonas = useMemo(() => sedes.find((s) => /AMAZONAS/i.test(s.nombre)), [sedes])
  const prodN = useMemo(() => Object.fromEntries(catalogo.map((p) => [p.id, p])), [catalogo])

  async function cargar() {
    setCargando(true)
    const ayer = diaAnterior(hoy)
    const hace30 = new Date(hoy + 'T12:00:00'); hace30.setDate(hace30.getDate() - 30)
    const [cs, cp, dia, prev, movs, turnos, prov, hist, st, peds] = await Promise.all([
      supabase.from('vista_consolidado_sede').select('*'),
      supabase.from('compras').select('*').eq('fecha', hoy),
      supabase.from('fondo_compras_dia').select('*').eq('fecha', hoy).maybeSingle(),
      supabase.from('fondo_compras_dia').select('vuelto_saldo').lt('fecha', hoy).order('fecha', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('fondo_movimientos').select('tipo, monto').eq('fecha', hoy),
      amazonas ? supabase.from('caja_turno').select('turno, efectivo').eq('sede_id', amazonas.id).eq('fecha', ayer) : Promise.resolve({ data: [] }),
      supabase.from('proveedores').select('nombre').order('nombre'),
      supabase.from('compras').select('producto_id, precio_unitario').gte('fecha', fmt(hace30)).lt('fecha', hoy),
      supabase.from('vista_almacen_stock').select('*'),
      supabase.from('pedidos').select('id, estado').eq('estado', 'pendiente').order('fecha', { ascending: false }).limit(1),
    ])
    // Precio de referencia: para avisarle si se le fue un dedo (35 en vez de 3.50).
    const ref = {}
    for (const h of (hist.data || [])) {
      if (!h.producto_id || !num(h.precio_unitario)) continue
      ref[h.producto_id] = ref[h.producto_id] || { s: 0, n: 0 }
      ref[h.producto_id].s += num(h.precio_unitario); ref[h.producto_id].n++
    }
    setRefPrecios(Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, v.s / v.n])))
    setStock(Object.fromEntries((st.data || []).map((x) => [x.producto_id, num(x.stock)])))

    const ped = (peds.data || [])[0]
    setPedItems(ped ? ((await supabase.from('pedido_items').select('*').eq('pedido_id', ped.id)).data || []) : [])

    const row = dia.data
    const tMan = (turnos.data || []).find((t) => t.turno === 'manana')?.efectivo
    const tTar = (turnos.data || []).find((t) => t.turno === 'tarde')?.efectivo
    setConsol(cs.data || []); setCompras(cp.data || [])
    setProveedores((prov.data || []).map((x) => x.nombre))
    setCaja({
      base: num(row ? row.base_inicial : prev.data?.vuelto_saldo),
      manana: num(row ? row.efectivo_manana : tMan),
      tarde: num(row ? row.efectivo_tarde : tTar),
      adic: (movs.data || []).filter((m) => m.tipo === 'adicional').reduce((a, m) => a + num(m.monto), 0),
      entregas: (movs.data || []).filter((m) => m.tipo === 'entrega_gerencia').reduce((a, m) => a + num(m.monto), 0),
    })
    setCargando(false)
  }
  useEffect(() => { cargar() }, [amazonas?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  const gastado = compras.reduce((a, c) => a + num(c.total), 0)
  const teQueda = caja.base + caja.manana + caja.tarde + caja.adic - gastado - caja.entregas

  const pedidos = useMemo(() => {
    const m = {}
    for (const c of consol) {
      if (String(c.clave).startsWith('libre:')) continue
      m[c.clave] = m[c.clave] || { clave: c.clave, producto: c.producto, unidad: c.unidad, sedes: [], total: 0 }
      m[c.clave].sedes.push({ id: c.sede_id, nombre: c.sede, cantidad: num(c.cantidad) })
      m[c.clave].total += num(c.cantidad)
    }
    return Object.values(m).sort((a, b) => a.producto.localeCompare(b.producto))
  }, [consol])

  const compradoDe = useMemo(() => {
    const m = {}
    for (const c of compras) {
      if (!c.producto_id) continue
      m[c.producto_id] = m[c.producto_id] || { cantidad: 0, monto: 0 }
      m[c.producto_id].cantidad += num(c.cantidad)
      m[c.producto_id].monto += num(c.total)
    }
    return m
  }, [compras])

  const pedidoDe = useMemo(() => {
    const m = {}
    for (const it of pedItems) if (it.producto_id) m[it.producto_id] = (m[it.producto_id] || 0) + num(it.cantidad)
    return m
  }, [pedItems])

  const extras = useMemo(() => {
    const enLista = new Set(pedidos.map((p) => p.clave))
    return Object.keys(compradoDe).filter((pid) => !enLista.has(pid))
  }, [compradoDe, pedidos])

  function abrir(p) {
    setMsg('')
    if (abierto === p.clave) return setAbierto(null)
    setAbierto(p.clave)
    const ya = compradoDe[p.clave]?.cantidad || 0
    const falta = Math.max(0, p.total - ya)
    const hay = stock[p.clave] || 0
    setBor({
      // Si hay en el almacén, esa es la primera opción: no gastar plata en algo que ya está.
      modo: hay > 0 ? 'almacen' : 'comprar',
      cantidad: String(falta || p.total || 1),
      precio: '',
      destino: p.sedes.length === 1 ? p.sedes[0].id : (hay > 0 ? '' : 'almacen'),
    })
  }
  const paso = (delta) => setBor((b) => ({ ...b, cantidad: String(Math.max(0, Math.round((num(b.cantidad) + delta) * 1000) / 1000)) }))

  async function guardar(p) {
    const cant = num(bor.cantidad)
    if (!(cant > 0)) return setMsg('La cantidad debe ser mayor a 0.')
    setMsg(''); setOcupado(true)
    try {
      if (bor.modo === 'almacen') {
        if (!bor.destino || bor.destino === 'almacen') { setOcupado(false); return setMsg('¿A qué sede se lo entregas?') }
        const hay = stock[p.clave] || 0
        if (cant > hay) { setOcupado(false); return setMsg(`En el almacén solo hay ${hay} ${p.unidad}.`) }
        const { error } = await supabase.from('almacen_movimientos').insert({
          producto_id: p.clave, tipo: 'salida', cantidad: cant, sede_id: bor.destino, nota: 'Entrega', fecha: hoy,
        })
        if (error) throw error

      } else if (bor.modo === 'pedir') {
        // El abastecimiento al por mayor: se pide, y administración lo compra e ingresa.
        let ped = (await supabase.from('pedidos').select('id').eq('estado', 'pendiente').order('fecha', { ascending: false }).limit(1)).data?.[0]
        if (!ped) ped = (await supabase.from('pedidos').insert({ estado: 'pendiente', creado_por: perfil?.id || null }).select().single()).data
        const { error } = await supabase.from('pedido_items').insert({
          pedido_id: ped.id, producto_id: p.clave, cantidad: cant,
          unidad: prodN[p.clave]?.unidad || p.unidad, comprado: false,
        })
        if (error) throw error

      } else {
        if (!(num(bor.precio) > 0)) { setOcupado(false); return setMsg('Falta el precio.') }
        if (!bor.destino) { setOcupado(false); return setMsg('Elige a dónde va.') }
        if (!comp) { setOcupado(false); setPanelComp(true); return setMsg('Primero dime dónde estás comprando.') }
        const alAlmacen = bor.destino === 'almacen'
        const { error } = await supabase.from('compras').insert({
          fecha: hoy, producto_id: p.clave, nombre_libre: p.producto, cantidad: cant,
          unidad: prodN[p.clave]?.unidad || p.unidad, precio_unitario: num(bor.precio),
          proveedor: comp.proveedor || null, destino_sede_id: alAlmacen ? null : bor.destino,
          medio_pago: comp.efectivo ? 'efectivo' : 'otro',
          comprobante: comp.efectivo ? 'EFECTIVO' : (comp.comprobante || 'VOUCHER'),
          voucher_url: comp.voucher_url || null, registrado_por: perfil?.id || null,
        })
        if (error) throw error
        // Solo lo que se guarda entra al kardex; lo que va directo a la sede no.
        if (alAlmacen) {
          await supabase.from('almacen_movimientos').insert({
            producto_id: p.clave, tipo: 'ingreso', cantidad: cant, nota: 'Compra ' + (comp.proveedor || ''), fecha: hoy,
          })
        }
      }
      setAbierto(null); setOtro('')
      await cargar(); onCambio?.()
    } catch (e) { setMsg(e.message || String(e)) }
    setOcupado(false)
  }

  if (cargando) return <p className="nota">Cargando…</p>

  const filas = [...pedidos, ...extras.map((pid) => ({
    clave: pid, producto: prodN[pid]?.nombre || '—', unidad: prodN[pid]?.unidad || '', sedes: [], total: 0, extra: true,
  }))]

  const formProps = { bor, setBor, sedes, paso, ocupado, refPrecios, msg }

  return (
    <div className="ch">
      <div className="ch-saldo">
        <span className="ch-saldo-lbl">Te queda hoy</span>
        <strong className={teQueda < 0 ? 'ch-saldo-val ch-neg' : 'ch-saldo-val'}>{soles(teQueda)}</strong>
        <span className="ch-saldo-det">
          Recibió {soles(caja.base + caja.manana + caja.tarde + caja.adic)} · gastado {soles(gastado)}
          {caja.entregas > 0 && ` · a gerencia ${soles(caja.entregas)}`}
        </span>
      </div>

      <ComprobanteActivo
        comp={comp} abierto={panelComp} proveedores={proveedores} fecha={hoy}
        nCompras={compras.filter((c) => comp && c.proveedor === comp.proveedor).length}
        onAbrir={() => setPanelComp(true)} onCerrar={() => setPanelComp(false)}
        onListo={(c) => { setComp(c); setPanelComp(false); setMsg('') }}
      />

      {msg && <div className="alerta">{msg}</div>}

      {filas.length === 0 && (
        <div className="bloque-vacio"><p>Ninguna sede ha enviado su lista todavía. Igual puedes registrar algo con “Otro producto”.</p></div>
      )}

      {filas.map((p) => {
        const ya = compradoDe[p.clave]
        const hay = stock[p.clave] || 0
        const pedidoAbast = pedidoDe[p.clave] || 0
        const listo = ya && (p.extra || ya.cantidad >= p.total)
        return (
          <div key={p.clave} className={`ch-fila ${abierto === p.clave ? 'ch-abierta' : ''} ${listo ? 'ch-listo' : ''}`}>
            <div className="ch-cab" onClick={() => abrir(p)}>
              <div className="ch-info">
                <strong>{p.producto}</strong>
                {ya ? (
                  <span className="ch-sub ch-ok">
                    Compró {ya.cantidad} {p.unidad} · {soles(ya.monto)}
                    {!p.extra && ya.cantidad < p.total && ` · pidieron ${p.total}`}
                  </span>
                ) : (
                  <span className="ch-sub">Pidieron {p.total} {p.unidad} · {p.sedes.map((s) => `${s.nombre} ${s.cantidad}`).join(' · ')}</span>
                )}
                <span className="ch-sub2">
                  {hay > 0 ? <span className="ch-hay">Almacén: {hay} {p.unidad}</span> : <span className="ch-nohay">Sin stock</span>}
                  {pedidoAbast > 0 && <span className="ch-ped"> · pedido al por mayor: {pedidoAbast}</span>}
                </span>
              </div>
              {listo
                ? <span className="ch-check">✓</span>
                : <button type="button" className="ch-btn-comprar">{abierto === p.clave ? 'Cerrar' : 'Atender'}</button>}
            </div>
            {abierto === p.clave && <FormLinea {...formProps} p={p} hay={hay} onGuardar={() => guardar(p)} />}
          </div>
        )
      })}

      <div className="ch-otro">
        <select value={otro} onChange={(e) => {
          const pid = e.target.value; setOtro(pid)
          if (pid) {
            const hay = stock[pid] || 0
            setAbierto(pid)
            setBor({ modo: hay > 0 ? 'almacen' : 'comprar', cantidad: '1', precio: '', destino: hay > 0 ? '' : 'almacen' })
          }
        }}>
          <option value="">+ Otro producto (fuera de la lista)</option>
          {catalogo.filter((x) => x.activo).map((x) => <option key={x.id} value={x.id}>{x.nombre} ({x.unidad})</option>)}
        </select>
      </div>

      {otro && abierto === otro && !filas.some((f) => f.clave === otro) && (
        <div className="ch-fila ch-abierta">
          <div className="ch-cab"><div className="ch-info">
            <strong>{prodN[otro]?.nombre}</strong>
            <span className="ch-sub">No estaba en la lista</span>
            <span className="ch-sub2">{(stock[otro] || 0) > 0
              ? <span className="ch-hay">Almacén: {stock[otro]} {prodN[otro]?.unidad}</span>
              : <span className="ch-nohay">Sin stock</span>}</span>
          </div></div>
          <FormLinea {...formProps} hay={stock[otro] || 0}
            p={{ clave: otro, producto: prodN[otro]?.nombre, unidad: prodN[otro]?.unidad, total: 0, sedes: [] }}
            onGuardar={() => guardar({ clave: otro, producto: prodN[otro]?.nombre, unidad: prodN[otro]?.unidad, total: 0, sedes: [] })} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// El formulario de una línea, con las tres salidas. Se usa igual para un producto
// de la lista y para uno suelto, así no hay dos formularios que mantener.
function FormLinea({ p, hay, bor, setBor, sedes, paso, ocupado, refPrecios, onGuardar }) {
  const total = num(bor.cantidad) * num(bor.precio)
  const modos = [
    ...(hay > 0 ? [['almacen', 'Del almacén']] : []),
    ['comprar', 'Comprar'],
    ['pedir', 'Pedir al por mayor'],
  ]
  return (
    <div className="ch-form">
      <div className="ch-modos">
        {modos.map(([k, l]) => (
          <button type="button" key={k} className={bor.modo === k ? 'ch-modo act' : 'ch-modo'}
            onClick={() => setBor({ ...bor, modo: k })}>{l}</button>
        ))}
      </div>

      <div className="ch-stepper">
        <button type="button" className="li-btn" onClick={() => paso(-1)}>−</button>
        <div className="ch-cant">
          <input inputMode="decimal" value={bor.cantidad} onChange={(e) => setBor({ ...bor, cantidad: e.target.value })} />
          <span>{p.unidad}</span>
        </div>
        <button type="button" className="li-btn li-mas" onClick={() => paso(+1)}>+</button>
      </div>

      {bor.modo === 'comprar' && (<>
        <label className="ch-lbl">Precio por {p.unidad}</label>
        <input className="ch-precio" inputMode="decimal" placeholder="0.00"
          value={bor.precio} onChange={(e) => setBor({ ...bor, precio: e.target.value })} />
        <AvisoPrecio promedio={refPrecios[p.clave]} precio={bor.precio} unidad={p.unidad} />
      </>)}

      {bor.modo === 'pedir' && (
        <p className="ch-aviso">Se pide a administración para que lo compre al por mayor e ingrese al almacén. No sale plata de tu caja.</p>
      )}

      {bor.modo !== 'pedir' && (<>
        <label className="ch-lbl">{bor.modo === 'almacen' ? 'Se lo entregas a' : 'Va a'}</label>
        <div className="ch-pills">
          {sedes.map((s) => (
            <button type="button" key={s.id} className={bor.destino === s.id ? 'ch-pill act' : 'ch-pill'}
              onClick={() => setBor({ ...bor, destino: s.id })}>{s.nombre}</button>
          ))}
          {bor.modo === 'comprar' && (
            <button type="button" className={bor.destino === 'almacen' ? 'ch-pill act' : 'ch-pill'}
              onClick={() => setBor({ ...bor, destino: 'almacen' })}>Almacén</button>
          )}
        </div>
      </>)}

      <button type="button" className="ch-guardar" disabled={ocupado} onClick={onGuardar}>
        {ocupado ? 'Guardando…'
          : bor.modo === 'almacen' ? `Entregar ${bor.cantidad || 0} ${p.unidad}`
          : bor.modo === 'pedir' ? `Pedir ${bor.cantidad || 0} ${p.unidad} al por mayor`
          : `Guardar · ${soles(total)}`}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------
// Aviso cuando el precio se sale de lo que se venía pagando. NO bloquea: el precio
// lo pone quien compra según lo que consiguió, y él manda. Sirve para dos cosas: pescar el dedo
// de más (35 en vez de 3.50, que le descuadra la caja y nadie lo nota hasta fin de
// mes) y enterarse de que el mercado se movió.
// OJO: la prop NO puede llamarse `ref` — React la trata distinto y no llegaría.
function AvisoPrecio({ promedio, precio, unidad }) {
  const p = num(precio)
  if (!promedio || !p) return null
  const v = (p - promedio) / promedio
  if (Math.abs(v) < 0.2) return null
  const alto = v > 0
  return (
    <p className={alto ? 'ch-aviso ch-aviso-alto' : 'ch-aviso'}>
      {alto ? '▲' : '▼'} Venías pagando {soles(promedio)} por {unidad} — esto es{' '}
      {Math.abs(Math.round(v * 100))}% {alto ? 'más caro' : 'más barato'}. ¿Está bien?
    </p>
  )
}

// ---------------------------------------------------------------------
// El comprobante que está "activo": se define UNA vez al llegar al proveedor y
// se le engancha a todo lo que registre ahí. Cuando se mueve, toca "Cambiar".
function ComprobanteActivo({ comp, abierto, proveedores, fecha, nCompras, onAbrir, onCerrar, onListo }) {
  const [prov, setProv] = useState('')
  const [file, setFile] = useState(null)
  const [nDoc, setNDoc] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [err, setErr] = useState('')

  async function usar(efectivo) {
    const nombre = prov.trim().toUpperCase()
    if (!nombre) return setErr('¿Dónde estás comprando?')
    if (!efectivo && !file) return setErr('Toma la foto del comprobante, o marca “sin comprobante”.')
    setSubiendo(true); setErr('')
    let voucher_url = null
    if (!efectivo && file) {
      const foto = await comprimirVoucher(file)
      const ext = (foto.name.split('.').pop() || 'jpg').toLowerCase()
      const ruta = `compras/${fecha}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const { error } = await supabase.storage.from('arqueos').upload(ruta, foto, { contentType: foto.type || undefined })
      if (error) { setSubiendo(false); return setErr('No pude subir la foto: ' + error.message) }
      voucher_url = ruta
    }
    setSubiendo(false); setFile(null); setNDoc(''); setProv('')
    onListo({ proveedor: nombre, voucher_url, comprobante: nDoc.trim().toUpperCase() || null, efectivo })
  }

  if (!abierto) {
    return comp ? (
      <div className="ch-comp ch-comp-ok">
        <div className="ch-info">
          <strong>{comp.proveedor}</strong>
          <span className="ch-sub">{comp.efectivo ? 'Sin comprobante · efectivo' : 'Con comprobante'}{nCompras > 0 && ` · ${nCompras} compra${nCompras > 1 ? 's' : ''}`}</span>
        </div>
        <button type="button" className="ch-btn-comprar" onClick={onAbrir}>Cambiar</button>
      </div>
    ) : (
      <button type="button" className="ch-comp ch-comp-vacio" onClick={onAbrir}>
        📷 ¿Dónde estás comprando? Toca aquí
      </button>
    )
  }

  return (
    <div className="ch-comp-panel">
      <label className="ch-lbl">¿Dónde estás comprando?</label>
      <input list="ch-provs" value={prov} onChange={(e) => setProv(e.target.value)} placeholder="Mercado central, Makro…" />
      <datalist id="ch-provs">{proveedores.map((p) => <option key={p} value={p} />)}</datalist>

      <label className="ch-lbl">Foto del comprobante</label>
      <label className="ch-foto">
        {file ? `✓ ${file.name}` : '📷 Tomar foto'}
        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </label>

      <label className="ch-lbl">N° de comprobante (si tiene)</label>
      <input value={nDoc} onChange={(e) => setNDoc(e.target.value)} placeholder="F001-123" />

      {err && <div className="alerta">{err}</div>}
      <button type="button" className="ch-guardar" disabled={subiendo} onClick={() => usar(false)}>
        {subiendo ? 'Subiendo…' : 'Usar este comprobante'}
      </button>
      <button type="button" className="ch-sec" disabled={subiendo} onClick={() => usar(true)}>Sin comprobante — en efectivo</button>
      {comp && <button type="button" className="ch-sec" onClick={onCerrar}>Cancelar</button>}
    </div>
  )
}
