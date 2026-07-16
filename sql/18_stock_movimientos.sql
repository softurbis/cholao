-- =====================================================================
-- Sistema Cholao — Movimientos de stock: mermas, adiciones y ajustes (v18)
-- Casos reales:
--   * El turno anterior dejó 5 tortas pero al abrir solo 4 están buenas -> merma
--   * A media tarde llegan 6 tortas más -> adición
--   * Se malogra algo en el turno -> merma
-- Cada movimiento queda con su motivo y quién lo registró.
-- Ejecutar después de 17_montos_editados.sql
-- =====================================================================

-- Detalle de cada movimiento de stock del turno
create table if not exists caja_stock_mov (
  id             uuid primary key default gen_random_uuid(),
  turno_id       uuid references caja_turno(id) on delete cascade,
  producto       text not null,
  tipo           text not null,          -- ajuste_apertura | adicion | merma | salida
  cantidad       numeric(12,2) not null, -- + entra / − sale (en ajuste_apertura es la diferencia)
  motivo         text,
  registrado_por uuid references perfiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists caja_stock_mov_turno on caja_stock_mov (turno_id);

-- Campos de apoyo en el stock del turno
alter table caja_stock add column if not exists esperado_apertura numeric(12,2); -- lo que dejó el turno anterior
alter table caja_stock add column if not exists merma             numeric(12,2) default 0;

comment on column caja_stock.esperado_apertura is 'Cierre del turno anterior: con cuánto DEBERÍA haber abierto';
comment on column caja_stock.merma is 'Producto perdido/malogrado en el turno (no se vendió)';
-- Fórmula del vendido: inicio + adicion − merma − salida − cierre

-- RLS
alter table caja_stock_mov enable row level security;
drop policy if exists auth_all on caja_stock_mov;
create policy auth_all on caja_stock_mov for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Función: con cuánto debería abrir cada producto (cierre del último turno
-- cerrado de esa sede, antes de la fecha/turno indicados)
-- ---------------------------------------------------------------------
create or replace function stock_esperado_apertura(p_sede uuid, p_fecha date)
returns table (producto text, cierre_anterior numeric)
language sql stable as $$
  select cs.producto, cs.cierre
  from caja_stock cs
  join caja_turno ct on ct.id = cs.turno_id
  where ct.sede_id = p_sede
    and ct.estado = 'cerrado'
    and ct.fecha <= p_fecha
    and cs.cierre is not null
    and ct.id = (
      select ct2.id from caja_turno ct2
      join caja_stock cs2 on cs2.turno_id = ct2.id and cs2.producto = cs.producto
      where ct2.sede_id = p_sede and ct2.estado = 'cerrado' and ct2.fecha <= p_fecha
        and cs2.cierre is not null
      order by ct2.fecha desc, ct2.cerrado_en desc nulls last
      limit 1
    );
$$;

-- Vista de mermas (para que administración vea cuánto se pierde y por qué)
create or replace view vista_mermas as
select
  ct.fecha, ct.turno, ct.cajero, s.nombre as sede,
  m.producto, m.cantidad, m.motivo, m.tipo, m.created_at
from caja_stock_mov m
join caja_turno ct on ct.id = m.turno_id
left join sedes s on s.id = ct.sede_id
where m.tipo in ('merma', 'ajuste_apertura')
order by ct.fecha desc;

alter view vista_mermas set (security_invoker = true);
