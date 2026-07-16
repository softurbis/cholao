-- =====================================================================
-- Sistema Cholao — Validación del cierre por administración (v20)
-- La cajera cierra su turno -> queda PENDIENTE DE VALIDAR.
-- El admin/gerencia/superusuario revisa los comprobantes subidos (PDF del
-- arqueo, productos vendidos, foto del voucher) y le da el OK.
-- Ejecutar después de 19_traslados.sql
-- =====================================================================

alter table caja_turno add column if not exists validado        boolean not null default false;
alter table caja_turno add column if not exists validado_por    uuid references perfiles(id);
alter table caja_turno add column if not exists validado_en     timestamptz;
alter table caja_turno add column if not exists nota_validacion text;

comment on column caja_turno.validado is 'true = administración revisó los comprobantes y dio el OK';

-- Los turnos históricos (cargados de los Excel) se dan por validados:
-- no tienen comprobantes que revisar.
update caja_turno set validado = true
where validado = false and origen_archivo is not null and origen_archivo <> 'registro-app';

create index if not exists caja_turno_pend_validar on caja_turno (validado, fecha)
  where validado = false;

-- Vista: turnos cerrados esperando el OK de administración
create or replace view vista_por_validar as
select
  t.id, t.fecha, t.turno, t.cajero, s.nombre as sede,
  t.venta_sistema, t.deficit_sobra, t.gastos_tienda,
  t.montos_editados is not null as tiene_montos_editados,
  (select count(*) from caja_adjuntos a where a.turno_id = t.id) as adjuntos,
  t.cerrado_en
from caja_turno t
left join sedes s on s.id = t.sede_id
where t.estado = 'cerrado' and t.validado = false
order by t.fecha desc, t.cerrado_en desc;

alter view vista_por_validar set (security_invoker = true);
