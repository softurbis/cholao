-- =====================================================================
-- Sistema Cholao — Traslados de stock entre sedes (v19)
-- Caso real: Amazonas saca 5 tortas y se las manda a Miraflores.
--   Amazonas registra una SALIDA con sede destino  -> queda pendiente
--   Miraflores la ve en su turno y la ACEPTA       -> le entra como adición
-- Así el producto no se pierde en el camino y se sabe quién lo recibió.
-- Ejecutar después de 18_stock_movimientos.sql
-- =====================================================================

alter table caja_stock_mov add column if not exists sede_destino_id uuid references sedes(id);
alter table caja_stock_mov add column if not exists sede_origen_id  uuid references sedes(id);
alter table caja_stock_mov add column if not exists aceptado        boolean;      -- null = no aplica
alter table caja_stock_mov add column if not exists aceptado_en     timestamptz;
alter table caja_stock_mov add column if not exists mov_origen_id   uuid references caja_stock_mov(id);

comment on column caja_stock_mov.sede_destino_id is 'A qué sede se envía (solo en salidas por traslado)';
comment on column caja_stock_mov.aceptado is 'false = enviado y pendiente de recibir · true = ya lo recibieron';
comment on column caja_stock_mov.mov_origen_id is 'En la adición del destino: apunta a la salida que la originó';

create index if not exists mov_traslados_pend on caja_stock_mov (sede_destino_id, aceptado)
  where aceptado = false;

-- Vista de traslados entre sedes (para administración)
create or replace view vista_traslados as
select
  m.id, ct.fecha, ct.turno, ct.cajero,
  so.nombre as sede_origen, sd.nombre as sede_destino,
  m.producto, abs(m.cantidad) as cantidad, m.motivo,
  m.aceptado, m.aceptado_en, m.created_at
from caja_stock_mov m
join caja_turno ct on ct.id = m.turno_id
left join sedes so on so.id = coalesce(m.sede_origen_id, ct.sede_id)
left join sedes sd on sd.id = m.sede_destino_id
where m.sede_destino_id is not null and m.tipo = 'salida'
order by m.created_at desc;

alter view vista_traslados set (security_invoker = true);
