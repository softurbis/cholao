# Sistema Cholao — Hoja de ruta

✅ hecho · 🔨 parcial · ⬜ pendiente

**App:** https://softurbis.github.io/cholao/ (login · datos protegidos con RLS)
**Login superadmin:** `ing.cesarohiggins@gmail.com` · **Repo:** `softurbis/cholao`
**Redeploy:** `bash deploy.sh` + `git push` · **Supabase:** proyecto `jselojihwryffbukcvdz`

---

## ⚠️ PENDIENTE INMEDIATO — correr en el SQL Editor
Del proyecto correcto: https://supabase.com/dashboard/project/jselojihwryffbukcvdz/sql/new

- ⬜ `sql/17_montos_editados.sql` — auditoría de montos cambiados vs PDF
- ⬜ `sql/18_stock_movimientos.sql` — mermas, adiciones y ajuste de apertura
- ⬜ `sql/19_traslados.sql` — traslados de stock entre sedes
- ⬜ `sql/20_validacion.sql` — el OK de administración sobre el cierre

*(01→16 ya están corridos.)*

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
3. ⬜ **Usuarios del personal** — crear logins con sus roles (que cada cajera entre con lo suyo)
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

## 🎯 Prioridad sugerida
1. Correr los SQL 17–20 y probar el circuito completo de caja
2. **Usuarios del personal** (#3) → que cada quien entre con su cuenta
3. **Inventario de activos** (#2) y **Panel de archivos** (#1)
4. **Planilla** (#4) — ya está conectada a los descuentos de caja
5. Reconciliar el doble conteo (#15) → flujo 100% real
