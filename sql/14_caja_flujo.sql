-- =====================================================================
-- Sistema Cholao — Caja por FASES: apertura → turno → cierre (v14)
-- La caja deja de ser un formulario único: se abre, se van registrando
-- movimientos durante el turno, y se cierra cuadrando.
-- Ejecutar después de 13_proveedores.sql
-- =====================================================================

-- Estado y datos de apertura/cierre del turno
alter table caja_turno add column if not exists estado       text default 'cerrado';  -- abierto | cerrado
alter table caja_turno add column if not exists base_inicial numeric(12,2) default 0; -- efectivo con que abre
alter table caja_turno add column if not exists abierto_en   timestamptz;
alter table caja_turno add column if not exists cerrado_en   timestamptz;
alter table caja_turno add column if not exists abierto_por  uuid references perfiles(id);
alter table caja_turno add column if not exists voucher_url  text;   -- foto del ticket/voucher del POS
alter table caja_turno add column if not exists clima_auto   text;   -- clima consultado automáticamente

-- Los turnos históricos ya cargados quedan como cerrados
update caja_turno set estado = 'cerrado' where estado is null;

-- Stock: marcar si el conteo de cierre coincidió con lo esperado
alter table caja_stock add column if not exists esperado   numeric(12,2);
alter table caja_stock add column if not exists coincide   boolean;

-- ---------------------------------------------------------------------
-- Catálogo de tipos de gasto (búsqueda rápida al registrar + crear nuevos)
-- ---------------------------------------------------------------------
create table if not exists tipos_gasto (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  detalle    text default 'LOCAL',    -- LOCAL | DELIVERY
  veces      int default 0,           -- frecuencia de uso -> ordena la búsqueda
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Semilla: los gastos que más se repiten en la caja histórica
insert into tipos_gasto (nombre, veces)
select upper(trim(descripcion)) as nombre, count(*) as veces
from caja_gastos
where descripcion is not null and trim(descripcion) <> ''
group by 1
on conflict (nombre) do nothing;

-- RLS
alter table tipos_gasto enable row level security;
drop policy if exists auth_all on tipos_gasto;
create policy auth_all on tipos_gasto for all to authenticated using (true) with check (true);

-- Índice para encontrar rápido el turno abierto
create index if not exists caja_turno_estado on caja_turno (estado, sede_id, fecha);
