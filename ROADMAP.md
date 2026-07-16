# Sistema Cholao — Checklist maestro

Estado a la fecha. ✅ hecho · 🔨 en curso · ⬜ pendiente

## Base ya lista
- ✅ Base de datos completa (v1–v9): sedes, personas, ventas, gastos, compras/stock, flujo, deudas, obligaciones, caja diaria por turno
- ✅ Código en GitHub (`softurbis/cholao`) · llaves seguras (`.env` fuera del repo)
- ✅ Marca aplicada (rojo/azul/amarillo, Trebuchet)

## Datos cargados
- ✅ Ventas 2025 (27,172 tickets Amazonas) + julio 2026 (1,049)
- ✅ Ventas por producto — julio 2026 (215)
- ✅ Personas (18) · Catálogo compras categorizado (151)
- ✅ Gastos 2026 (574 movimientos, S/200,441.93)
- ✅ Obligaciones fijas sembradas (7, para editar)
- ✅ Caja diaria abr–jul 2026 (228 turnos: cuadre + gastos + descuentos + stock)

---

## FASE 1 — Ver lo que ya está cargado
1. ✅ **Panel Caja Diaria** — ver cuadres por turno (venta, pagos, gastos, descuentos, stock)
2. ✅ **Dashboard de productos** — más vendidos, venta por sede, monto por producto/sede
3. ⬜ **Comparativo de ventas** — venta contada vs venta sistema (cajero) vs venta real (POS)

## FASE 2 — Completar cargas de datos
4. ✅ **Caja diaria formato viejo** — 2025 + ene–mar 2026 (811 turnos, may-2025→jul-2026)
5. ✅ **Ventas ene–may 2026** — 9,514 tickets (falta solo junio; export llegaba hasta 17-may)
6. ⬜ **Ventas por producto** — subidas semanales (para el dashboard de productos)

## FASE 3 — Paneles operativos (captura)
7. ⬜ **Compras** — registro con precio real, contado/crédito, stock valorizado, cuentas por pagar
8. ⬜ **Compras móvil** — listas rápidas por sede (las señoras desde el celu)
9. ⬜ **Obligaciones** — fijos/variables con calendario de vencimientos
10. ⬜ **Planilla** — sueldos + descuentos que vienen de la caja diaria
11. ⬜ **Asistencia + Horarios** — personal en tienda en tiempo real por hora
12. ⬜ **Personas** — alta/edición de empleados y usuarios
13. ⬜ **Importación** — subir los exportados del POS desde la app (sin scripts)

## FASE 4 — Integración y cierre
14. ⬜ **Descuentos caja → planilla** (enlace automático)
15. ⬜ **Ajustar flujo** — egresos del ledger, sin doble conteo
16. ⬜ **Login / usuarios + roles** — crear superadmin y accesos
17. ⬜ **Seguridad (RLS)** — políticas por rol/sede
18. ⬜ **Rotar secret key** de Supabase (al terminar la carga)

---

**Orden de trabajo:** Fase 1 → 2 → 3 → 4. Primero que VEAS lo que ya está cargado
(panel de caja, productos), luego completar datos viejos, luego los paneles de captura
diaria, y al final integración, login y seguridad.
