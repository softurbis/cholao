-- =====================================================================
-- Sistema Cholao — Auditoría de montos editados (v17)
-- Si el cajero cambia un monto que se leyó del PDF (ej: PDF 500 -> pone 430),
-- se guarda qué cambió, de cuánto a cuánto. Queda la evidencia.
-- Ejecutar después de 16_adjuntos_activos.sql
-- =====================================================================

alter table caja_turno add column if not exists montos_editados jsonb;

comment on column caja_turno.montos_editados is
  'Montos que el cajero cambió respecto al PDF de arqueo. Formato: {"campo": {"pdf": 500, "puesto": 430}}';

-- Vista para que el admin revise rápido los turnos con montos alterados
create or replace view vista_montos_editados as
select
  t.id, t.fecha, t.turno, t.cajero, s.nombre as sede,
  t.venta_sistema, t.montos_editados,
  jsonb_object_keys(t.montos_editados) as campo_editado
from caja_turno t
left join sedes s on s.id = t.sede_id
where t.montos_editados is not null and t.montos_editados <> '{}'::jsonb;

alter view vista_montos_editados set (security_invoker = true);
