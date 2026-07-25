# Sistema Cholao — Hoja de ruta

✅ hecho · 🔨 parcial · ⬜ pendiente · Estado al **17-jul-2026**

**App:** https://softurbis.github.io/cholao/ · **Repo:** `softurbis/cholao` · rama `main`
**Redeploy:** `bash deploy.sh` + commit + push (Pages sirve desde la RAÍZ del repo)
**Supabase:** proyecto `jselojihwryffbukcvdz` · [SQL editor](https://supabase.com/dashboard/project/jselojihwryffbukcvdz/sql/new)
**Login superadmin:** `ing.cesarohiggins@gmail.com` (Cesar)

---

## ⚠️ PENDIENTE INMEDIATO (para retomar)

1. ⬜ **Poner la ubicación de cada sede** — Sedes → 📍 Ubicación → "Usar mi ubicación actual",
   **parado DENTRO del local**. **Sin esto nadie puede marcar asistencia**: la pantalla avisa
   "tu sede todavía no tiene su ubicación configurada". Es el único paso que falta para que
   asistencia quede operativa.

_Nada pendiente de SQL (01→32 corridos). Todo desplegado._

## 🛒 Rediseño de compras (en curso) — "Comprar hoy"

Se analizó el flujo y se encontró que **la misma cantidad se escribía 5 veces** en dos
sistemas sin nexo (`compras` = dinero, `pedido_items`/`almacen_movimientos` = mercadería;
la tabla `compras` no tiene FK a la lista ni al pedido). Decisión del usuario: simplificar
a 4 pasos manteniendo el control, que es **de dinero** (los 3 riesgos son plata).

**Fase 1 — HECHA, falta correr sql/29 + desplegar:** `components/ComprasHoy.jsx`, primera
pestaña de Compras y vista por defecto. Pantalla única para celular:
- Saldo del día EN VIVO arriba (vuelto + Amazonas + adicionales − compras − entregas).
- **Comprobante activo**: la foto se toma UNA vez al llegar al proveedor (`capture` abre la
  cámara) y se engancha a todo lo que registre ahí. Antes era una foto por producto.
- Cada producto pedido = una fila; al abrirla: **+/− de 44px** (reusa `.li-btn` de la lista
  de cocina), precio (único campo con teclado) y destino en **pastillas**, no desplegable.
- Guardar = 1 toque: registra en `compras`, descuenta de su caja y define el destino.
  **Almacén → ingreso al kardex. Sede → entrega directa, NO toca el stock central**
  (descontarlo dejaba el almacén en negativo, porque esa mercadería nunca entró).
- La lista es GUÍA: pidieron 10, compra 8, se guarda 8 y la diferencia queda sola.
- Filtros y rankings se ocultan en esta vista (son de consulta, estorban al trabajar).

**Fase 2 — HECHA, falta correr sql/30 + desplegar:** `components/ControlCompras.jsx`,
pestaña **🔎 Control** visible solo para Cesar/admin (`puedeEditar`). Revisión posterior,
no bloquea. Responde 4 preguntas, todas en soles:
1. **¿La plata cuadra?** — contra el **efectivo CONTADO** (sql/30), no contra la aritmética.
   Falta / sobra / cuadra. "Sobra" suele ser una compra sin registrar.
2. **¿Hay comprobantes?** — cuánto del día se gastó sin voucher, con el detalle.
3. **¿Los precios son sanos?** — lo pagado hoy vs. el promedio de los 30 días previos;
   marca lo que se sale del ±20%.
4. **¿Se cubrió lo pedido?** — qué pidieron las sedes y no se compró.
Más el detalle completo del día con sus vouchers. El conteo también se puede hacer desde
💵 Caja de Juan al cerrar (que es cuando corresponde).

**Ajustes pedidos por el usuario (24-jul, ya desplegados):**
- El **aviso de precio ahora también le sale a Juan** en su pantalla, antes de guardar
  (`AvisoPrecio` en ComprasHoy). No bloquea: el precio lo pone él. Sirve para pescar el dedo
  de más (35 en vez de 3.50) y ver cuándo se movió el mercado.
- La **cadena pidieron → compró → llegó va en los dos lados**: en 📥 Recepción (con lo que
  Juan compró PARA esa sede desde que se envió la lista) y en 🔎 Control con columna "Falta".
**Fase 3 — HECHA, falta correr sql/31 + desplegar.** ⚠️ Corrección del usuario: **el pedido
al por mayor Juan→Cesar SE QUEDA** (Juan pide, **Cesar** compra al por mayor e ingresa el
stock; Juan NO ingresa stock). Y cuando falta algo, **primero se mira el almacén**. Entonces
cada producto tiene **3 salidas**, y ahora las tres están en la misma pantalla:
1. **Del almacén** — si hay stock, se entrega (modo por defecto cuando hay: no gastar plata
   en algo que ya está guardado). Crea la salida hacia la sede.
2. **Comprar** — con la plata de su caja.
3. **Pedir a Cesar** — el abastecimiento al por mayor; entra a `pedido_items`. No toca su caja.
La fila muestra cuánto hay en almacén y cuánto ya se pidió a Cesar.

**🔢 Conteo almacén** (`ConteoAlmacen.jsx`): Juan cuenta lo que hay de verdad; se guarda en
`almacen_conteos` (sistema / contado / diferencia) y se ajusta el kardex con nota `CONTEO`.
Muestra el último conteo por producto y el historial — las diferencias que se repiten en el
mismo producto no son casualidad.

**Sigue pendiente:** `Entregas` (tabla muerta, no la escribe nadie) y el consolidado que no
se limpia solo.

⚠️ **Limitación conocida:** el consolidado **no se limpia solo** — las vistas filtran
`compras_lista_items.comprado = false` y nada pone ese campo en true. Hoy solo desaparece
si se marca la lista como *atendida* en Mi Lista. La pantalla nueva lo disimula (muestra
"compró X · pidieron Y" y marca ✓), pero al día siguiente la lista vieja reaparece. Se
arregla en la fase 3.

## ⬜ Otros pedidos del usuario (24-jul-2026)
- ✅ **Gastos en celular** — HECHO (commit `9160cef`). Mismo patrón que compras: cámara
  directa (`capture`), tipo y medio en pastillas, monto con teclado numérico, y fecha/sede/
  nota escondidas tras "+ cambiar" porque casi nunca se tocan. La tabla se desliza de lado
  en el celular con la clase `.tabla-movil` (reutilizable en otras pantallas).
- ✅ **Asistencia** — HECHA y desplegada (commit `021676e`). Falta ponerle la ubicación a
  cada sede. Reglas que eligió el
  usuario (**estrictas a propósito, no cambiar sin preguntar**): marca **entrada y salida**,
  siempre con **selfie** · la ubicación **se valida y BLOQUEA** (fuera del radio no marca) ·
  **sin cámara o sin GPS no se puede marcar**.
  · Orden del flujo: **primero ubicación, después foto** — al revés sería hacerle tomar la
    selfie para recién decirle que no puede marcar.
  · **Válvula de escape** (la agregué yo, avisado): super/admin registran una marca a mano
    con motivo obligatorio, y queda señalada. Sin eso, un celular viejo o un local sin señal
    deja a alguien sin poder marcar un lunes a las 7am y el negocio se traba.
  · La **distancia la calcula un trigger en la base**, no el navegador, así nadie manda
    metros inventados. Pero ojo: las coordenadas sí las reporta el celular y un teléfono se
    puede configurar para mentir — lo que de verdad disuade es la selfie con hora.
  · Índice único `(perfil_id, fecha, tipo)`: tocar dos veces no duplica la marca.
  · Ubicación de la sede en **Sedes → 📍 Ubicación**, con "usar mi ubicación actual" (parado
    en el local; copiar coordenadas de un mapa a mano es donde se cometen los errores).
    Tolerancia por defecto **120 m**: el GPS de un celular yerra de 10 a 50 m y peor en
    interiores, así que un radio chico deja fuera a gente que sí está en la tienda.
- **Gerencia ve las listas**: ✅ hecho (se agregó 'lista' a `ROLE_ACCESS.gerente`;
  `Lista.jsx` ya da el editor solo al rol cocina, al resto la vista de lectura).

Verificar en producción cuando entre Juan/cocina:
- **Cocina → Mi Lista**: arma lista (+/−, comentario, "Enviar a Juan" → bloquea) y abajo la
  **RECEPCIÓN**: conforme llega, marca cuánto recibió de cada ítem (parcial) → descuenta del
  almacén. Puede agregar recepciones de emergencia.
- **Juan → Compras**: formulario de registro (voucher/efectivo → datos → productos con
  cantidad+precio); 📎 abre el voucher.
- **Juan → 💵 Caja de Juan**: el cuadre diario (vuelto ayer + efec. Amazonas mañana/tarde
  auto-sugeridos, adicionales y entregas a gerencia con comprobantes, − compras del día =
  saldo). Cerrar el día → el saldo es la base de mañana.
- **Juan → 📋 Pedidos**: consolidado POR SEDE; arma su pedido (puede pedir en otra unidad,
  ej. sacos) y "Enviar a Cesar".
- **Cesar → 📋 Pedidos**: reconfirma, ajusta lo que entra (unidad base, sugerido por el
  factor), pone comprobantes y "Aceptar e ingresar al almacén" (recién ahí toca el stock).
- **Juan → 📥 Recepción**: elige una sede y valida su entrega igual que la cocina.
- **Juan → 📦 Catálogo**: define la unidad de compra + factor (1 saco = 25 kg).

**SQL corridos:** 01→32. **Pendiente:** ninguno.
**Edge Function `admin-usuarios`:** desplegada con slug **`quick-api`** (así se creó en el
dashboard). `app/src/lib/adminUsuarios.js` apunta a `quick-api`.

---

## ✅ LO QUE YA FUNCIONA (en vivo)

### Usuarios, roles y accesos (sql/21, 23; Edge Function)
- **Roles:** superadmin (Cesar) · admin · gerente (Víctor, solo ve) · cajera · cocina ·
  compras (histórico). **Corte:** gerente LEE, admin EDITA/valida. RLS real por rol y sede.
- **Login sin correo:** entran con usuario simple (`marcelo` → `marcelo@cholao.local`).
  **PIN de 6 números** (cajera/cocina/compras) o **contraseña** (admin/gerencia/super). El
  celular recuerda el usuario. El turno se firma con quien inició sesión (cajero ya no es
  campo libre).
- **Permisos especiales** (casilla en el usuario, para cajera): `puede_gastos` (Fernanda →
  abre Gastos) · `puede_compras` (Juan → abre Compras).
- **Personas** (solo super): CRUD del personal + crear/gestionar logins. Desactivados abajo.
- **"👁 Ver como"** (solo super, en el sidebar): prueba las ventanas de cada rol sin cerrar
  sesión (cambia menús/accesos, no los datos).

### Caja Diaria (sql 09→20) — el módulo central, ya existía
- Registrar Caja en 3 fases (apertura/turno/cierre), lee los PDF del POS, valida montos,
  3 documentos obligatorios, WhatsApp. Validación del admin. Traslados entre sedes.

### Turnos y horario por sede (sql/22)
- Cada sede define sus turnos (Amazonas 2, Miraflores 1) y su horario por día en **Sedes →
  🕒 Turnos y horario**. Turnos históricos quedan inactivos (no se borran). La app
  preselecciona el turno por la hora.

### Gastos unificado (sql/25) — un solo módulo
- Gastos de tienda + adelantos/descuentos/bonos por persona, con voucher (o **"en
  efectivo"**). **Formulario al revés**: comprobante primero, luego datos.
- Víctor/Cesar/admin ven TODO (lo nuevo + histórico 2026 mezclado) + consolidado PDF.
- **Fernanda solo ingresa y ve lo suyo.**

### Compras y almacén (sql/24, 26) — módulo de Juan, con pestañas
- **📦 Catálogo**: productos con unidad, ubicación y foto. Sembrado con 80 productos.
- **🚚 Proveedores**: con teléfono y ubicación.
- **📋 Pedidos**: consolidado de lo que piden las sedes → Juan arma pedido → Cesar
  "Ingresa al almacén".
- **🏬 Almacén / Kardex**: ingreso (compra al por mayor) / salida (reparto a sede); kardex
  por producto con saldo corriendo.
- Circuito verificado end-to-end: cocina pide 5+3 → consolidado 8 → ingreso 8 → reparto 5
  → saldo 3.

### Cocina — Mi Lista (sql/24; rebuild en sql/27 pendiente de deploy)
- Cocina elige productos del catálogo (la unidad sale sola). **Rebuild interactivo (móvil,
  +/−, comentario, enviar/bloquear) YA construido, esperando sql/27 + deploy.**

### Datos limpiados (jul-2026)
- Febrero 2026 estaba **contado doble** (~S/46k): se borró el Excel duplicado. Respaldo en
  `scripts/data/`.
- **341 turnos** con etiqueta de cajera ('y','n','m'…) **reparados** a su turno real (283).
- Todo el texto a **MAYÚSCULA** (personas, cajero, productos, proveedores) + normalización
  al escribir. Respaldo en `scripts/data/`.
- Miraflores no estaba muda: sus datos de **junio y julio no se habían importado** (el
  import se saltaba las hojas sin turno). Cargados: 179 → 218 turnos.

---

## ⬜ PENDIENTES

### A · Lo próximo (compras de Juan)
1. ✅ **Formulario de compras de Juan** con voucher + selección de productos que cubre —
   HECHO y desplegado (commit `ddb9b6e`). Falta la verificación en producción con Juan.
2. ⬜ Al usar el +/− de la lista de cocina en celular con señal mala puede sentirse lento
   (guarda por toque). Si molesta, optimizar a guardado en lote.

### B · Módulos por construir / completar
3. ⬜ **Ventas** — hoy es un placeholder que documenta lo que falta (detalle ticket a
   ticket, comparativo contada/sistema/POS). Ver la propia pantalla del módulo.
4. ⬜ **Inventario de activos** — tablas y 11 activos sembrados en sql/16; falta pantalla.
5. ⬜ **Planilla** — sueldos + descuentos de caja → neto por persona/mes.
6. ⬜ **Asistencia · Horarios** — se ocultó del menú por ahora (muy complejo).
7. ⬜ **Panel de archivos** — ver todos los PDF/vouchers subidos, filtrable.

### C · Datos e integración
8. ⬜ **Ventas de Miraflores** (0 tickets) y **Amazonas feb–jul 2026** (solo enero en la
   tabla de tickets). Y **julio 2025 / agosto Miraflores** (layout viejo, parser aparte).
9. ⬜ **Integrar el consolidado de gastos al Panel de flujo** general (hoy son vistas
   separadas).
10. ⬜ **Reconciliar el doble conteo**: gastos-gerencia "compras" (~S/75k) vs compras de
    Juan (~S/81k) — decidir cuál cuenta en el flujo.
11. ⬜ **Rotar la secret key** de Supabase (se compartió en chat) y **borrar el proyecto
    Supabase vacío** (`eiyxzucmanjpgorjdanx`).

---

## 📘 Manuales por módulo — REGLA AL TOCAR EL CÓDIGO

Cada pantalla lleva su botón **❓ Manual** junto al título (`components/Manual.jsx`), y el
contenido de los 11 módulos vive en **`app/src/manuales/index.js`**.

**Si cambias cómo funciona un módulo, actualiza su manual EN EL MISMO CAMBIO** y agrega una
línea a su `novedades` con la fecha. El manual vive junto al código a propósito: así se
actualiza cuando se actualiza la pantalla, y no queda un instructivo suelto que nadie
mantiene. Cada manual tiene: `paraQuien` · `resumen` · `pasos` (en el orden real de uso) ·
`ojo` (lo que cuesta entender) · `novedades` (qué cambió y cuándo).

## 🧭 Menú agrupado

El panel izquierdo agrupa en **Día a día · Revisión · Ajustes** (`GRUPOS` en `lib/roles.js`),
con desplegables; arranca abierto el grupo donde estás parado. Si a alguien le tocan **3
módulos o menos** (la cajera ve uno) el menú va **plano**: agrupar tan poco estorba.
Un módulo que no esté en ningún grupo cae en **"Otros"** en vez de desaparecer en silencio —
si agregas un módulo nuevo, ponlo en su grupo.

## 🧰 Scripts útiles (`scripts/`, usan service_role)
- `verificar_roles_v23.js` · `verificar_compras_v24.js` — prueban permisos entrando como
  cada rol (crean usuarios de prueba, entran con la anon key, comprueban y los borran).
- `verificar_permisos.js` — la cajera de sql/21.
- `seed_productos.js` — siembra el catálogo desde las compras.
- `import_caja_diaria.js` — carga caja (turno opcional en la hoja). `import_ventas_pos.js`,
  `import_cye.js`, etc.
- `check_estado.js` — chequeo rápido.

## 📌 Gotchas que cuestan encontrar
- **Edge Function = slug `quick-api`**, no `admin-usuarios`. Probar: fetch a
  `/functions/v1/quick-api` → 401 = ok, 404 = no desplegada.
- **`compras.total` es GENERADA** — no insertarla.
- **`producto_id`**: `almacen_movimientos`, `compras_lista_items` y `compras` apuntaban a la
  tabla vieja `compras_productos`; sql/26 los reapuntó a `productos`.
- **No re-correr `sql/10`** (da acceso total a todo authenticated; lo reemplaza sql/21).
- Agregar una columna al `.select()` de una tabla que no la tiene **revienta el query
  entero** (panel vacío sin error). Por eso se usa `select('*')` y se corre el SQL antes de
  desplegar.
- **El flujo de caja apertura/cierre NUNCA se usó en producción** (todo son imports de
  Excel): el primer día de uso real pueden salir bugs juntos.
