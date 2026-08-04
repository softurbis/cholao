import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { puedeEditar } from '../lib/roles'
import { comprimirVoucher } from '../lib/comprimirImagen'
import Manual from '../components/Manual'

// Recetario: cómo se prepara cada producto.
//
// ⚠️ SOLO GERENCIA Y ADMINISTRACIÓN (decisión del usuario). La cocina no entra:
// son las recetas del negocio. Lo protege la policy `recetas_ver` de sql/35, no
// solo esconder el módulo del menú.
//
// Gerencia MIRA, administración y superusuario EDITAN — el mismo corte que en
// todo el sistema.

// La hoja de cálculo donde estaban las recetas antes del sistema. Se deja a mano
// para consultarla mientras se van pasando. Abre en Google con los permisos de
// Google: acá no se copia nada, así que quien no tenga acceso allá no la ve.
const HOJA_GOOGLE = 'https://docs.google.com/spreadsheets/d/1Apvd9vALfZzYWA9iIDBegNbekNj3Z_8JzQDh1rglouk/edit'

const VACIA = { nombre: '', categoria: '', rendimiento: '', ingredientes: '', preparacion: '', notas: '' }

export default function Recetario() {
  const { perfil } = useAuth()
  const edita = puedeEditar(perfil)

  const [recetas, setRecetas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [busca, setBusca] = useState('')
  const [cat, setCat] = useState('')
  const [abierta, setAbierta] = useState(null)     // id de la receta desplegada
  const [editando, setEditando] = useState(null)   // id en edición, o 'nueva'
  const [bor, setBor] = useState(VACIA)
  const [msg, setMsg] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function cargar() {
    setCargando(true)
    const { data, error } = await supabase.from('recetas').select('*').order('nombre')
    if (error) setMsg(error.message)
    setRecetas(data || []); setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const categorias = useMemo(
    () => [...new Set(recetas.map((r) => r.categoria).filter(Boolean))].sort(),
    [recetas])

  const fil = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return recetas.filter((r) =>
      (!cat || r.categoria === cat)
      // Busca también dentro de los ingredientes: "¿en qué uso la leche condensada?"
      && (!q || `${r.nombre} ${r.categoria || ''} ${r.ingredientes || ''}`.toLowerCase().includes(q))
    )
  }, [recetas, busca, cat])

  function abrirEditor(r) {
    setMsg('')
    if (r) { setEditando(r.id); setBor({ ...VACIA, ...r }) }
    else { setEditando('nueva'); setBor(VACIA) }
  }

  async function guardar() {
    if (!bor.nombre.trim()) return setMsg('Ponle nombre a la receta.')
    setOcupado(true); setMsg('')
    const campos = {
      nombre: bor.nombre.trim().toUpperCase(),
      categoria: bor.categoria.trim().toUpperCase() || null,
      rendimiento: bor.rendimiento.trim() || null,
      ingredientes: bor.ingredientes.trim() || null,
      preparacion: bor.preparacion.trim() || null,
      notas: bor.notas.trim() || null,
    }
    const { error } = editando === 'nueva'
      ? await supabase.from('recetas').insert({ ...campos, creado_por: perfil?.id || null })
      : await supabase.from('recetas').update(campos).eq('id', editando)
    setOcupado(false)
    if (error) return setMsg(/duplicate|unique/i.test(error.message)
      ? 'Ya existe una receta con ese nombre.' : error.message)
    setEditando(null); cargar()
  }

  async function borrar(r) {
    if (!confirm(`¿Borrar la receta de ${r.nombre}? No se puede deshacer.`)) return
    if (r.foto_url) await supabase.storage.from('arqueos').remove([r.foto_url])
    const { error } = await supabase.from('recetas').delete().eq('id', r.id)
    if (error) return setMsg(error.message)
    cargar()
  }

  async function subirFoto(r, file) {
    if (!file) return
    const foto = await comprimirVoucher(file)
    const ext = (foto.name.split('.').pop() || 'jpg').toLowerCase()
    const ruta = `recetas/${r.id}.${ext}`
    const { error } = await supabase.storage.from('arqueos').upload(ruta, foto, { contentType: foto.type || undefined, upsert: true })
    if (error) return setMsg('No pude subir la foto: ' + error.message)
    await supabase.from('recetas').update({ foto_url: ruta }).eq('id', r.id)
    cargar()
  }
  async function verFoto(ruta) {
    const { data } = await supabase.storage.from('arqueos').createSignedUrl(ruta, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="pagina">
      <h1>📖 Recetario<Manual modulo="recetario" /></h1>
      <p className="pagina-sub">
        Cómo se prepara cada producto. Solo lo ven gerencia y administración.
      </p>

      {msg && <div className="alerta">{msg}</div>}

      <div className="form-inline">
        <input placeholder="🔎 Buscar por nombre o ingrediente…" value={busca}
          onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 240 }} />
        {categorias.length > 0 && (
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Todas las categorías</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {edita && <button onClick={() => abrirEditor(null)}>+ Nueva receta</button>}
        <a className="btn-mini" href={HOJA_GOOGLE} target="_blank" rel="noreferrer"
          style={{ alignSelf: 'center', textDecoration: 'none' }}>
          📄 Abrir la hoja de Google
        </a>
      </div>

      {editando && (
        <EditorReceta bor={bor} setBor={setBor} ocupado={ocupado}
          esNueva={editando === 'nueva'} onGuardar={guardar} onCancelar={() => setEditando(null)} />
      )}

      {cargando ? <p className="nota">Cargando…</p> : fil.length === 0 ? (
        <div className="bloque-vacio">
          <p>
            {recetas.length === 0
              ? 'Todavía no hay recetas cargadas. Mientras tanto, la hoja de Google sigue a la mano con el botón de arriba; puedes ir pasando las recetas de a poco.'
              : 'Ninguna receta coincide con la búsqueda.'}
          </p>
        </div>
      ) : (
        <div className="ch">
          {fil.map((r) => (
            <div key={r.id} className={abierta === r.id ? 'ch-fila ch-abierta' : 'ch-fila'}>
              <div className="ch-cab" onClick={() => setAbierta(abierta === r.id ? null : r.id)}>
                <div className="ch-info">
                  <strong>{r.nombre}</strong>
                  <span className="ch-sub">
                    {r.categoria || 'Sin categoría'}
                    {r.rendimiento ? ` · rinde ${r.rendimiento}` : ''}
                  </span>
                </div>
                <button type="button" className="ch-btn-comprar">{abierta === r.id ? 'Cerrar' : 'Ver'}</button>
              </div>

              {abierta === r.id && (
                <div className="ch-form">
                  <div className="rec-cuerpo">
                    <div>
                      <h4 className="rec-titulo">Ingredientes</h4>
                      <pre className="rec-texto">{r.ingredientes || 'Sin ingredientes cargados.'}</pre>
                    </div>
                    <div>
                      <h4 className="rec-titulo">Preparación</h4>
                      <pre className="rec-texto">{r.preparacion || 'Sin preparación cargada.'}</pre>
                    </div>
                  </div>
                  {r.notas && (<>
                    <h4 className="rec-titulo">Notas</h4>
                    <pre className="rec-texto rec-notas">{r.notas}</pre>
                  </>)}

                  <div className="acciones" style={{ marginTop: 12 }}>
                    {r.foto_url && <button className="btn-mini" onClick={() => verFoto(r.foto_url)}>📷 Ver foto</button>}
                    {edita && (
                      <label className="btn-mini" style={{ cursor: 'pointer' }}>
                        {r.foto_url ? 'Cambiar foto' : '+ Foto'}
                        <input type="file" accept="image/*" style={{ display: 'none' }}
                          onChange={(e) => subirFoto(r, e.target.files?.[0])} />
                      </label>
                    )}
                    {edita && <button className="btn-mini" onClick={() => abrirEditor(r)}>✏️ Editar</button>}
                    {edita && <button className="btn-mini btn-peligro" onClick={() => borrar(r)}>Borrar</button>}
                    {r.actualizado_en && (
                      <span className="nota" style={{ alignSelf: 'center' }}>
                        Actualizada el {String(r.actualizado_en).slice(0, 10)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!cargando && recetas.length > 0 && (
        <p className="nota">{fil.length} de {recetas.length} recetas.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Los ingredientes y la preparación son campos de texto largo a propósito: lo
// que hay hoy es una hoja de cálculo, y así se pega tal cual sin tener que
// normalizar 80 recetas antes de guardar la primera.
function EditorReceta({ bor, setBor, ocupado, esNueva, onGuardar, onCancelar }) {
  const set = (k) => (e) => setBor({ ...bor, [k]: e.target.value })
  return (
    <div className="panel-detalle">
      <h3>{esNueva ? '➕ Nueva receta' : '✏️ Editar receta'}</h3>
      <div className="filtros">
        <label className="campo"><span>Nombre *</span>
          <input value={bor.nombre} onChange={set('nombre')} placeholder="CHOLAO CLÁSICO" autoFocus /></label>
        <label className="campo"><span>Categoría</span>
          <input value={bor.categoria} onChange={set('categoria')} placeholder="CHOLAOS, JUGOS, SALSAS…" /></label>
        <label className="campo"><span>Rendimiento</span>
          <input value={bor.rendimiento} onChange={set('rendimiento')} placeholder="1 litro · 10 porciones" /></label>
      </div>

      <label className="ch-lbl">Ingredientes <span className="nota">(uno por línea)</span></label>
      <textarea className="rec-area" rows={7} value={bor.ingredientes} onChange={set('ingredientes')}
        placeholder={'250 g de fresa\n100 ml de leche condensada\n1 cda de azúcar'} />

      <label className="ch-lbl">Preparación</label>
      <textarea className="rec-area" rows={9} value={bor.preparacion} onChange={set('preparacion')}
        placeholder={'1. Lavar y cortar la fresa.\n2. Licuar con la leche.\n3. Reposar 10 minutos en frío.'} />

      <label className="ch-lbl">Notas <span className="nota">(trucos, errores comunes, variantes)</span></label>
      <textarea className="rec-area" rows={4} value={bor.notas} onChange={set('notas')} />

      <div className="acciones" style={{ marginTop: 12 }}>
        <button className="btn-guardar" onClick={onGuardar} disabled={ocupado || !bor.nombre.trim()}>
          {ocupado ? 'Guardando…' : 'Guardar receta'}
        </button>
        <button className="btn-mini" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}
