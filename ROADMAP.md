# Sistema Cholao — Hoja de ruta

✅ hecho · 🔨 parcial · ⬜ pendiente · Estado al **17-jul-2026**

**App:** https://softurbis.github.io/cholao/ · **Repo:** `softurbis/cholao` · rama `main`
**Redeploy:** `bash deploy.sh` + commit + push (Pages sirve desde la RAÍZ del repo)
**Supabase:** proyecto `jselojihwryffbukcvdz` · [SQL editor](https://supabase.com/dashboard/project/jselojihwryffbukcvdz/sql/new)
**Login superadmin:** `ing.cesarohiggins@gmail.com` (Cesar)

---

## ⚠️ PENDIENTE INMEDIATO (para retomar)

1. ⬜ **Correr `sql/29_juan_lee_listas.sql`** — arregla un BUG SILENCIOSO: las policies
   de sql/23 daban las listas de cocina a `mi_rol() in ('compras','almacen')`, pero Juan
   es **cajera con `puede_compras`**, no rol 'compras' → **el consolidado le salía vacío**
   (sin error). Probándolo como Cesar funcionaba, por eso no se vio. Ahora usa
   `puede_compras_op()`. Después: `bash deploy.sh` + commit + push.

_(sql/28 corrido y desplegado el 17-jul-2026, commit `50eb37b`.)_

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

**Fase 2 — pendiente:** panel de control de Cesar en soles (compras del día con/sin
comprobante, caja de Juan, y las diferencias pedido vs comprado vs recibido).
**Fase 3 — pendiente:** retirar `Pedidos`/`Entregas` y simplificar la recepción. Se dejan
en pie a propósito hasta que Juan valide la pantalla nueva.

⚠️ **Limitación conocida:** el consolidado **no se limpia solo** — las vistas filtran
`compras_lista_items.comprado = false` y nada pone ese campo en true. Hoy solo desaparece
si se marca la lista como *atendida* en Mi Lista. La pantalla nueva lo disimula (muestra
"compró X · pidieron Y" y marca ✓), pero al día siguiente la lista vieja reaparece. Se
arregla en la fase 3.

## ⬜ Otros pedidos del usuario (24-jul-2026)
- **Gastos en celular**: los paneles de gastos (Víctor/gerencia y Fernanda, que ingresa
  bonos/adelantos/descuentos) deben ser fáciles en celular con subida de voucher directa
  desde la cámara.
- **Asistencia**: hoy `Asistencia.jsx` es una **pantalla vacía** (placeholder, no hay nada).
  Lo pedido: la persona llega, pone su PIN en su celular configurado y se toma una **selfie
  con georreferencia** que registra su asistencia. Es un proyecto aparte; falta decidir si
  se valida la ubicación contra la sede, con qué radio, y qué pasa si el GPS o la cámara
  fallan.
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

**SQL corridos:** 01→28. **Pendiente:** sql/29.
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
