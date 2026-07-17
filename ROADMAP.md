# Sistema Cholao — Hoja de ruta

✅ hecho · 🔨 parcial · ⬜ pendiente

**App:** https://softurbis.github.io/cholao/ (login · datos protegidos con RLS)
**Login superadmin:** `ing.cesarohiggins@gmail.com` · **Repo:** `softurbis/cholao`
**Redeploy:** `bash deploy.sh` + `git push` · **Supabase:** proyecto `jselojihwryffbukcvdz`

---

## ⚠️ PENDIENTE INMEDIATO

**SQL: 01→22 TODOS corridos** (verificado contra la base el 17-jul-2026).

- ⬜ **Desplegar la Edge Function** — sin ella, Personas lista y edita pero el botón
  "Crear login" falla:
  `npx supabase functions deploy admin-usuarios --project-ref jselojihwryffbukcvdz`
  (o pegar `supabase/functions/admin-usuarios/index.ts` en el dashboard → Edge Functions)
- ⬜ **Redeploy de la app**: `bash deploy.sh` + commit + push

Para comprobar que los permisos siguen bien: `cd scripts && node verificar_permisos.js`
— crea una cajera de prueba, entra con ella y comprueba qué puede leer y qué no. Un RLS
mal escrito no da error, solo deja pasar: por eso se prueba entrando, no mirando si las
tablas existen.

⛔ **No volver a correr `sql/10_seguridad_rls.sql`**: le da a cualquier usuario logueado
acceso total y borraría los permisos por rol del 21.

---

## 🧹 Datos: lo que se arregló el 17-jul-2026 (y lo que falta)

**Febrero 2026 estaba contado DOBLE** (~S/ 46.000 inflados). El mes se importó desde dos
Excel: `FEBRERO 2026-AMAZONAS IA` (pestañas M/T) y `FEBRERO BEL` (pestañas con la inicial
de la cajera). Como `turno` es texto libre, el `unique(sede_id,fecha,turno)` no los vio
como el mismo turno. Se comprobó que IA era **subconjunto exacto** de BEL (52 turnos con
venta idéntica; BEL además tenía 2 propios) y se borró IA. Respaldo en
`scripts/data/respaldo_febrero_IA.json`. Febrero: S/ 94.476 → **S/ 48.489 reales**.

**341 turnos tenían la etiqueta cruda del Excel** ('y','n','m','t','j','l','b','ll').
NO eran basura: datos reales con venta, cajero, 1.116 gastos y 1.001 adelantos. Los
generó `import_caja_viejo.js:36`, que volcaba el sufijo de la pestaña sin traducirlo.
Eran **dos convenciones mezcladas**: el libro de marzo rotula por turno (m=Mañana,
t=Tarde) y el resto por quién atendía (y=Yamile, n=Natzumy, j=Juan, l=Laura, b=Bella).
Se repararon **283** con `scripts/reparar_turnos.js` (deja la etiqueta original en
`caja_turno.turno_origen`). La regla se validó por dos vías independientes: la cajera
dominante de cada letra, y la venta promedio (mañanas ~S/ 430 vs tardes ~S/ 1.400).

- ⬜ **6 turnos quedaron sin resolver** (`turno_id is null`) — son "pestañas arrastradas":
  el libro de diciembre trae días de noviembre que el libro de noviembre ya cubre, con
  montos distintos. Hay que mirar el Excel:
  `2025-11-21`, `2025-11-23` (x2), `2025-11-26`, `2025-09-25` y `Miraflores 2025-12-20 "(2)"`.

**Miraflores no estaba muda: sus datos no se habían importado.** `import_caja_diaria.js`
exigía que el nombre de la pestaña llevara el turno (`01-07-2026 Manana`). Miraflores,
que trabaja **un solo turno**, rotula solo la fecha (`04-07-2026`) — y el import se
saltaba esas hojas **en silencio**. Se perdían junio y julio enteros. Arreglado: el turno
es opcional y las hojas sin rótulo entran como `unico`, con salvaguarda anti-duplicado.
Miraflores: 179 → **218 turnos**, y ya llega al 15-jul.

### Huecos que quedan
- ⬜ **Amazonas julio-2025** y **Miraflores agosto-2025**: los Excel existen
  (`C JULIO AMAZONAS 2025.xlsm`) pero son del **layout viejo** — las pestañas se llaman
  `2`, `3`, `4`… (solo el número del día). Necesitan un parser propio.
- ⬜ `Caja Agosto/Septiembre/Octubre.xlsx`: pestañas `19-08` (sin año) y **sin sede en el
  nombre**, así que el import no sabe de qué local son. `Caja Agosto` mezcla agosto y junio.
- ⬜ Amazonas may–jun 2025: hay turnos pero con **venta en S/ 0,00**.
- ⬜ Miraflores feb-2026 solo tiene 11 de 28 días.
- Días sueltos: muchos son descansos, no datos perdidos. Ahora se pueden declarar como
  **Cerrado** en Sedes → Turnos y horario, y dejan de ser ambiguos.

---

## ✅ LO QUE YA FUNCIONA

### Datos cargados
- **Ventas: 40,856 tickets** (2025 completo + 2026 hasta jul) · **Productos por mes** (Amazonas mar24→abr26, Miraflores jun–dic25)
- **Gastos gerencia: 574** (S/200,441) · **Compras de Juan: 7,187** (S/81,560) + 4,166 entregas + 210 cuadres de fondo
- **Caja diaria: 811 turnos** (may-2025 → jul-2026) · **Personas: 18** · **Catálogo: 151** · **582 tipos de gasto**

### Caja Diaria — proceso en 3 fases
1. **Apertura**: cajero, base de caja, stock inicial. Muestra **lo que dejó el turno anterior** y exige motivo si no coincide (merma/faltante/sobrante).
2. **Turno**: gastos con **búsqueda rápida**, adelantos/descuentos por persona, **movimientos de stock** (adición/merma/salida), **traslados entre sedes** con confirmación de recepción.
3. **Cierre**: **lee los 2 PDF del POS** (arqueo + productos vendidos) y jala los montos; compara **stock físico vs sistema**; **clima automático**; rendimiento vs meta; **3 documentos obligatorios** (arqueo, productos, foto POS) + facturas opcionales; **PDF/print** y **botón de WhatsApp**.

### Controles anti-error
- **Montos editados**: si cambian un valor del PDF → se marca, alerta, va al WhatsApp y **queda la evidencia**.
- **Validación del admin**: el turno queda *⏳ por validar*; admin/gerencia revisa los comprobantes y da **✓ OK**.
- **Cuadre**: el faltante del POS debe explicarse con gastos + adelantos.

### Otros módulos
- **Panel/Flujo** (ingresos − gastos − gastos de caja, por año/mes)
- **Compras** (rankings, detalle, entregas, fondo de Juan, edición con catálogos)
- **Productos** (ranking con filtro sede + rango de meses) · **Gastos** · **Sedes** · **Configuración**

---

## ⬜ PENDIENTES

### A · Módulos por construir
1. ⬜ **Panel de archivos** — ver todos los PDF/vouchers/facturas subidos, filtrable *(parcial: ya se ven dentro de cada turno)*
2. ⬜ **Inventario de activos** — conteo de mesas, sillas, tenedores, maceteros, cremeros… *(tablas y 11 activos ya sembrados en sql/16; falta la pantalla)*
3. 🔨 **Usuarios del personal** — código listo; falta correr `sql/21` y **desplegar la Edge Function**:
   `npx supabase functions deploy admin-usuarios --project-ref jselojihwryffbukcvdz`
   (o pegar `supabase/functions/admin-usuarios/index.ts` en el dashboard → Edge Functions).
   Sin ella, la pantalla Personas lista y edita, pero el botón "Crear login" falla.
4. ⬜ **Planilla** — sueldos + descuentos que vienen de la caja → neto por persona/mes
5. ⬜ **Asistencia + Horarios** — personal en tienda en tiempo real por hora
6. ⬜ **Obligaciones** — panel editable (fijos/variables) + calendario de vencimientos
7. ⬜ **Comparativo de ventas** — venta contada vs sistema (cajero) vs POS real
8. ⬜ **Registro de Compras** — formulario para que Juan cargue desde el sistema
9. ⬜ **Corregir en masa** productos/proveedores mal escritos

### B · Datos por completar
10. ⬜ **Ventas de Miraflores** (ticket a ticket) — solo Amazonas está cargado
11. ⬜ **Productos**: Miraflores ene-2026+ · Amazonas may-jun 2026
12. ⬜ **Compras de Juan 2025** (solo 2026 cargado)
13. ⬜ **Caja julio 2025** (layout distinto) y may–jun 2025 (sin venta)
14. ⬜ **Uploads semanales** de ventas en adelante

### C · Calidad y cierre
15. ⬜ **Reconciliar doble conteo**: gastos-gerencia "compras" (~S/75k) se solapa con compras de Juan (~S/81k)
16. ⬜ **Limpiar catálogo de gastos**: hay nombres de personas (MARCELO, MILAGROS…) que deberían ser adelantos
17. ⬜ **Rotar la secret key** de Supabase (se compartió en chat)
18. ⬜ **Borrar el proyecto Supabase vacío** (`eiyxzucmanjpgorjdanx`) para no confundirse

---

## 🕒 Turnos y horario por sede (sql/22)

Cada sede define **cuántos turnos trabaja** y **a qué hora abre y cierra cada día**, en
Sedes → 🕒 Turnos y horario. Los datos mandaron el diseño: Amazonas tiene 2 turnos (218
días con dos) y Miraflores 1 (204 días con uno).

- **Un turno que se deja de usar NO se borra**: queda `activo=false`. Sostiene el
  histórico — Miraflores tiene 153 turnos de mañana y 25 de tarde que deben seguir
  leyéndose aunque hoy trabaje un turno único de tarde.
- `caja_turno.turno` **se queda como etiqueta cruda** y al lado va `turno_id` → `sede_turnos`.
  Un FK sobre `turno` obligaría a inventar un turno por cada basura histórica.
- La app **preselecciona el turno según la hora** (`hora_inicio`/`hora_fin`). Antes el
  default era siempre `manana`, que en Miraflores es un turno que no existe.
- **`cerrado` en el horario** es lo que más va a servir: hoy un día sin caja es ambiguo
  —nadie sabe si no abrieron o si no lo cargaron— y hay ~100 días así solo en Miraflores.
- Las metas (Configuración) generan **una columna por turno real** de la sede, ya no dos fijas.

## 🔐 Cómo entra el personal (desde jul-2026)

- **Sin correo.** Entran con un usuario simple (`marcelo`); por dentro se guarda
  `marcelo@cholao.local`, un buzón que no existe ni hace falta. Se crean confirmados.
  No hay "recuperar clave por correo": la resetea el superadmin desde Personas.
- **PIN de 6 números, no 4.** GoTrue (el auth de Supabase) rechaza cualquier clave de
  menos de 6 caracteres: está en su código, no es una opción del panel. El PIN **lo pone
  el sistema**, no la persona (si lo eligieran, sería 123456), y se rechazan los obvios.
- **El celular recuerda el usuario** (`localStorage`, jamás el PIN): en la tienda solo se
  teclean los 6 números. Teclado numérico (`inputMode`) y fuente ≥16px para que iOS no
  haga zoom al tocar el campo.
- **El turno lo firma quien inició sesión.** `caja_turno.cajero` era un campo libre y
  quedaron **33 nombres distintos para 18 personas** (Yamile firmó de 8 formas; 25 turnos
  sin cajero). Ahora la cajera no lo edita: sale de su perfil. Solo gerencia puede
  escribirlo, porque a veces registra por otro. Sin esto, endurecer el login sería teatro.
- **Los roles y sus módulos** viven en `app/src/lib/roles.js`. Eso es la comodidad;
  la seguridad son las policies de `sql/21`. Si abres un módulo a un rol allí pero no
  le das permiso en la base, verá la pantalla **vacía** y parecerá que la app se rompió.
- **Quién trabaja en una sede:** solo encargado y cajera. Gerencia ve todo; Juan
  (compras) y almacén son transversales — compran y reparten para las dos sedes.
- **La cajera no borra evidencia:** puede subir y reemplazar los comprobantes del
  cierre, pero no borrarlos, ni borrar turnos. Eso es de gerencia; si no, validar
  no significaría nada.

## 🎯 Prioridad sugerida
1. **Desplegar la Edge Function** + redeploy de la app → ya se pueden crear los logins
2. Crear los logins reales del personal y **probar el circuito de caja con una cajera**.
   ⚠️ Ojo: el flujo apertura/cierre **NUNCA se ha usado en producción** (0 turnos con
   `origen_archivo='registro-app'`, 0 adjuntos subidos). Los 811 turnos son todos
   importaciones de Excel. El primer día de uso real van a salir bugs juntos.
3. Resolver los **6 turnos ambiguos** y los huecos de datos de arriba
4. **Inventario de activos** (#2) y **Panel de archivos** (#1)
5. **Planilla** (#4) — ya está conectada a los descuentos de caja
6. Reconciliar el doble conteo gastos-gerencia vs compras de Juan (#15) → flujo 100% real
