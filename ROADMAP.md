# Sistema Cholao — Hoja de ruta

Estado al cierre de sesión (jul 2026). ✅ hecho · 🔨 parcial · ⬜ pendiente

App en vivo: **https://softurbis.github.io/cholao/** (requiere login · datos protegidos con RLS)
Login superadmin: `ing.cesarohiggins@gmail.com`
Repo: `softurbis/cholao` · Redeploy: `bash deploy.sh` + `git push`

---

## ✅ LO QUE YA ESTÁ (no tocar salvo mejora)

### Infraestructura
- Base de datos completa: **13 migraciones SQL corridas** (01→13)
- **Seguridad RLS activa** (solo usuarios logueados ven datos)
- App desplegada, login funcionando, marca oficial aplicada

### Datos cargados
- **Ventas: 40,856 tickets** — 2025 completo + 2026 (ene→15 jul). *(Amazonas)*
- **Gastos gerencia: 574** (S/200,441) — con sede auto-asignada donde aplica
- **Compras de Juan: 7,187** (S/81,560) + **4,166 entregas** + **210 cuadres de fondo** (2026)
- **Caja diaria: 811 turnos** (may-2025 → jul-2026): cuadre, gastos, descuentos, stock
- **Productos por mes**: Amazonas mar24→abr26, Miraflores jun→dic25
- **Personas: 18** · **Catálogo compras: 151** · **Proveedores**: sembrados

### Módulos funcionando
- **Panel/Flujo** (ingresos − gastos − gastos de caja, por año/mes)
- **Registrar Caja** (formulario tipo Excel: cuadre + gastos + descuentos + stock)
- **Caja Diaria** (ver turnos + gastos de caja vs adelantos separados)
- **Compras** (rankings proveedor/producto, detalle, entregas, fondo Juan, edición con dropdowns)
- **Productos** (ranking con filtro sede + rango de meses)
- **Gastos** · **Sedes** · **Configuración** (productos stock, metas, días inventario)

---

## ⬜ PENDIENTES

### A · Datos por completar
1. ⬜ **Ventas de Miraflores** (ticket a ticket) — solo Amazonas está cargado; falta el export del POS de Miraflores
2. ⬜ **Productos**: Miraflores ene-2026+ · Amazonas may-jun 2026
3. ⬜ **Compras de Juan 2025** — solo 2026 cargado (la carpeta 2025 tiene snapshots por consolidar)
4. ⬜ **Julio 2025 caja** (archivo con layout distinto, salió 0 turnos)
5. ⬜ **May–jun 2025 caja** (turnos sin venta, layout muy temprano)
6. ⬜ **Uploads semanales** en adelante (ventas + ventas por producto)
7. 🔵 *Opcional:* CUENTAS 2020-2024 (flujo histórico, solo referencia)

### B · Módulos/pantallas por construir
8. ⬜ **Planilla** — sueldos + descuentos que vienen de la caja → sueldo neto por persona/mes
9. ⬜ **Asistencia + Horarios en tiempo real** — ver personal en tienda por hora según turnos
10. ⬜ **Personas** — alta/edición de empleados y **crear los logins del personal** (roles)
11. ⬜ **Obligaciones** — panel editable (fijos/variables) + calendario de vencimientos
12. ⬜ **Comparativo de ventas** — venta contada vs venta sistema (cajero) vs venta real (POS)
13. ⬜ **Control de inventario** — registrar el conteo físico en los días configurados
14. ⬜ **Registro de Compras** — formulario para que Juan cargue compras/entregas desde el sistema
15. ⬜ **Corregir en masa** productos/proveedores mal escritos + administrador de catálogos

### C · Calidad y cierre
16. ⬜ **Reconciliar doble conteo**: los gastos-gerencia categoría "compras" (~S/75k) probablemente
    se solapan con las compras de Juan (~S/81k). Decidir cuál cuenta en el flujo para no duplicar.
17. ⬜ **Normalizar productos** mal escritos (para que agrupen bien en rankings)
18. ⬜ **Rotar la secret key** de Supabase (se compartió en chat durante la carga)

---

## 🔧 Cómo continuar (operación)
- **Redeploy web:** `bash deploy.sh` y luego `git push`
- **Cargar más ventas (POS):** `node scripts/import_ventas_historico.js "<archivo.xlsx>" <Sede>`
- **Cargar caja nueva:** `node scripts/import_caja_diaria.js <carpeta>` (formato nuevo) o `import_caja_viejo.js` (.xlsm)
- **Cargar compras Juan:** `node scripts/import_cye.js "<Reporte CyE ...>"`
- **Cargar productos x mes:** `node scripts/import_productos_mes.js "<carpeta>" <Sede>`

## Prioridad sugerida para la próxima sesión
1. Reconciliar el doble conteo (#16) → que el flujo sea 100% real
2. Ventas de Miraflores (#1) → dividir bien las dos sedes
3. Planilla (#8) — conecta con los descuentos de caja ya cargados
4. Personas + logins del personal (#10) → que cada quien entre con su usuario
