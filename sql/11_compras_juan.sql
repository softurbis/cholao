-- =====================================================================
-- Sistema Cholao — Módulo Compras de Juan (v11)
-- Estructura del dinero, SEPARADA para no mezclar ni contar doble:
--   1) GASTOS GERENCIA  -> tabla `gastos` (ledger del gerente, ya cargado)
--   2) COMPRAS DE JUAN  -> tabla `compras` (financiadas con efectivo de caja)
--      + su cuadre diario (fondo) + ENTREGAS valorizadas a cada sede
-- Flujo del efectivo: cajas -> Juan (fondo) -> compras -> entregas a sedes
--                      -> vuelto/saldo o entrega a administración.
-- Ejecutar después de 10_seguridad_rls.sql
-- =====================================================================

-- Compras: campos extra del formato real de Juan (Reporte CyE)
alter table compras add column if not exists comprobante text;   -- factura/boleta o '-'

-- ---------------------------------------------------------------------
-- Cuadre diario del fondo de compras (hoja "DD-MM C", lado derecho)
-- ---------------------------------------------------------------------
create table if not exists fondo_compras_dia (
  id               uuid primary key default gen_random_uuid(),
  fecha            date not null unique,
  responsable      text,
  base_inicial     numeric(12,2) default 0,   -- con lo que amanece
  efectivo_manana  numeric(12,2) default 0,   -- recogido de cajas turno mañana
  efectivo_tarde   numeric(12,2) default 0,   -- recogido de cajas turno tarde
  yape             numeric(12,2) default 0,
  transferencia    numeric(12,2) default 0,
  dinero_total     numeric(12,2) default 0,
  gasto_total      numeric(12,2) default 0,   -- suma de compras del día
  entrega_admin    numeric(12,2) default 0,   -- efectivo entregado a administración
  vuelto_saldo     numeric(12,2) default 0,   -- con lo que cierra
  origen_archivo   text,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Entregas de Juan a las sedes (hoja "DD-MM E"), valorizadas
-- ---------------------------------------------------------------------
create table if not exists entregas (
  id             uuid primary key default gen_random_uuid(),
  fecha          date not null,
  producto       text,
  presentacion   text,
  cantidad       numeric(12,3),
  sede_id        uuid references sedes(id),
  precio_unit    numeric(12,2),
  total          numeric(14,2),
  origen_archivo text,
  created_at     timestamptz not null default now()
);
create index if not exists entregas_fecha on entregas (fecha);
create index if not exists entregas_sede on entregas (sede_id, fecha);

-- RLS igual que el resto
alter table fondo_compras_dia enable row level security;
alter table entregas enable row level security;
drop policy if exists auth_all on fondo_compras_dia;
create policy auth_all on fondo_compras_dia for all to authenticated using (true) with check (true);
drop policy if exists auth_all on entregas;
create policy auth_all on entregas for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- Vistas de análisis: compras y entregas por sede y mes
-- ---------------------------------------------------------------------
create or replace view vista_compras_mensual as
select to_char(fecha,'YYYY-MM') as ym, destino_sede_id as sede_id,
       count(*) as items, sum(total) as monto
from compras group by 1,2;

create or replace view vista_entregas_mensual as
select to_char(fecha,'YYYY-MM') as ym, sede_id,
       count(*) as items, sum(total) as monto
from entregas group by 1,2;
