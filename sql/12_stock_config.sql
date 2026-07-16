-- =====================================================================
-- Sistema Cholao — Catálogo de stock, metas, inventario, config (v12)
-- Apoya el REGISTRO de caja diaria (formulario del Excel).
-- Ejecutar después de 11_compras_juan.sql
-- =====================================================================

-- Productos que se controlan en el stock diario de exhibición (configurable)
create table if not exists productos_stock (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  sede_id       uuid references sedes(id),      -- null = para todas las sedes
  stock_minimo  numeric(10,2) default 0,
  orden         int default 0,
  activo        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Conteo físico de inventario (en los días configurados)
create table if not exists inventario (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null,
  sede_id     uuid references sedes(id),
  producto    text not null,
  contado     numeric(12,2),         -- lo que se contó físicamente
  sistema     numeric(12,2),         -- lo que debería haber (cierre esperado)
  diferencia  numeric(12,2),
  nota        text,
  created_at  timestamptz not null default now()
);
create index if not exists inventario_fecha on inventario (fecha, sede_id);

-- Config general clave-valor (días de inventario, etc.)
create table if not exists config (
  clave       text primary key,
  valor       jsonb,
  updated_at  timestamptz not null default now()
);

-- Vista: gastos de caja (tienda) por mes y sede -> para sumarlos a gastos generales
create or replace view vista_caja_gastos_mensual as
select to_char(t.fecha, 'YYYY-MM') as ym, t.sede_id, sum(t.gastos_tienda) as monto
from caja_turno t
group by 1, 2;

-- Vista: venta contada de caja por mes y sede
create or replace view vista_caja_venta_mensual as
select to_char(fecha, 'YYYY-MM') as ym, sede_id, sum(venta_total) as monto, count(*) as turnos
from caja_turno group by 1, 2;

-- RLS en las tablas nuevas
do $$ declare t text;
begin
  for t in select unnest(array['productos_stock','inventario','config'])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists auth_all on public.%I', t);
    execute format('create policy auth_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
alter view vista_caja_gastos_mensual set (security_invoker = true);
alter view vista_caja_venta_mensual set (security_invoker = true);

-- ---------------------------------------------------------------------
-- Semillas
-- ---------------------------------------------------------------------
-- Productos de exhibición (de la hoja CONFIGURACION) — para todas las sedes
insert into productos_stock (nombre, orden, stock_minimo) values
  ('Coca Cola', 1, 2), ('Inca Kola', 2, 2), ('Agua', 3, 2),
  ('Tres Leches Clásico', 4, 2), ('Tres Leches Chocolate', 5, 2),
  ('Crema Volteada', 6, 2), ('Torta Temporada', 7, 2)
on conflict do nothing;

-- Config: días de la semana para inventario (por defecto: martes y viernes)
insert into config (clave, valor) values
  ('inventario_dias', '["martes","viernes"]')
on conflict (clave) do nothing;

-- Metas por defecto (de la hoja CONFIGURACION de Amazonas) para ambas sedes
insert into caja_metas (sede_id, dia_semana, turno, meta)
select s.id, d.dia, t.turno, t.monto
from sedes s
cross join (values
  ('Domingo', 791.48, 1469.88), ('Lunes', 615.59, 1143.24), ('Martes', 439.71, 816.60),
  ('Miércoles', 615.59, 1143.24), ('Jueves', 615.59, 1143.24), ('Viernes', 615.59, 1143.24),
  ('Sábado', 791.48, 1469.88)
) as d(dia, m_manana, m_tarde)
cross join lateral (values ('manana', d.m_manana), ('tarde', d.m_tarde)) as t(turno, monto)
on conflict (sede_id, dia_semana, turno) do nothing;
