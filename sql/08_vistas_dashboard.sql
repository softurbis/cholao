-- =====================================================================
-- Sistema Cholao — Vistas de agregado para el Dashboard (v8)
-- Suman en la base (rápido) en vez de traer miles de filas al navegador.
-- Ejecutar después de 07_obligaciones.sql
-- =====================================================================

-- Ventas por mes y sede (excluye anuladas)
create or replace view vista_ventas_mensual as
select
  to_char(fecha, 'YYYY-MM') as ym,
  sede_id,
  count(*)     as tickets,
  sum(total)   as monto
from ventas
where coalesce(estado, '') not ilike '%anulado%'
group by 1, 2;

-- Gastos por mes, categoría y sede
create or replace view vista_gastos_mensual as
select
  to_char(fecha, 'YYYY-MM') as ym,
  categoria,
  sede_id,
  sum(monto)   as monto
from gastos
group by 1, 2, 3;
