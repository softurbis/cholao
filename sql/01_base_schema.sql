-- =====================================================================
-- Sistema Cholao — Esquema base (sedes + personas + perfiles/roles)
-- Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- Roles del sistema
do $$ begin
  create type rol_cholao as enum
    ('superadmin', 'gerente', 'encargado', 'compras', 'almacen', 'cajera');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Sedes (los locales)
-- ---------------------------------------------------------------------
create table if not exists sedes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  direccion   text,
  telefono    text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Personas (empleados)
-- ---------------------------------------------------------------------
create table if not exists personas (
  id            uuid primary key default gen_random_uuid(),
  nombres       text not null,
  apellidos     text,
  dni           text,
  telefono      text,
  cargo         text,                         -- descripción libre del puesto
  sede_id       uuid references sedes(id),
  sueldo_base   numeric(10,2),
  fecha_ingreso date,
  activo        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Perfiles (usuarios que entran al sistema; 1 a 1 con auth.users)
-- ---------------------------------------------------------------------
create table if not exists perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  persona_id  uuid references personas(id),
  nombre      text not null,
  rol         rol_cholao not null default 'cajera',
  sede_id     uuid references sedes(id),       -- sede que administra/opera
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RLS — habilitar y afinar políticas más adelante.
-- Por ahora se deja el andamiaje comentado para no bloquear el arranque.
-- ---------------------------------------------------------------------
-- alter table sedes    enable row level security;
-- alter table personas enable row level security;
-- alter table perfiles enable row level security;

-- Helper sugerido para políticas por rol/sede:
-- create or replace function mi_rol() returns rol_cholao language sql stable as $$
--   select rol from perfiles where id = auth.uid()
-- $$;
