-- =====================================================================
-- Sistema Cholao — Ajustes v3 (para cargar histórico de compras/planilla)
-- Ejecutar en el SQL Editor de Supabase DESPUÉS de setup_completo.sql
-- =====================================================================

-- 1) Categoría en el catálogo de compras (FRUTAS, INSUMOS, PULPAS, ...)
alter table compras_productos add column if not exists categoria text;

-- 2) Planilla mensual por persona (por NOMBRE: el personal cambia mes a mes)
create table if not exists planilla_mensual (
  id               uuid primary key default gen_random_uuid(),
  anio             int not null,
  mes              int not null,
  persona_nombre   text not null,
  persona_id       uuid references personas(id),   -- si matchea con el maestro
  contrato         boolean,
  horas            numeric(6,2),
  pago_hora        numeric(8,2),
  sueldo_base      numeric(10,2),
  bonos            numeric(10,2),
  total_descuentos numeric(10,2),
  sueldo_neto      numeric(10,2),
  created_at       timestamptz not null default now(),
  unique (anio, mes, persona_nombre)
);

-- 3) Detalle de adelantos/descuentos por día (historial de cada uno)
create table if not exists descuentos_mov (
  id             uuid primary key default gen_random_uuid(),
  anio           int not null,
  mes            int not null,
  persona_nombre text not null,
  persona_id     uuid references personas(id),
  fecha          date,                 -- día del movimiento (si se puede mapear)
  monto          numeric(10,2) not null,
  tipo           text not null default 'descuento',  -- descuento|adelanto
  created_at     timestamptz not null default now()
);
create index if not exists descuentos_mov_persona on descuentos_mov (anio, mes, persona_nombre);
