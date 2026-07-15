-- Setup completo Sistema Cholao (01 + 02). Pegar TODO en el SQL Editor de Supabase y RUN.

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


-- =====================================================================
-- Sistema Cholao — Esquema de módulos (v1 borrador, basado en el Drive real)
-- Ejecutar DESPUÉS de 01_base_schema.sql
-- =====================================================================

-- Semilla de las 3 sedes reales
insert into sedes (nombre) values ('Amazonas'), ('Bulevar'), ('Miraflores')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- CAJA DIARIA / CUADRE  (de "Reporte Ventas General.xlsx")
-- 1 fila por sede y día. Concilia lo que el sistema reporta vs. lo contado.
-- ---------------------------------------------------------------------
create table if not exists caja_diaria (
  id            uuid primary key default gen_random_uuid(),
  sede_id       uuid not null references sedes(id),
  fecha         date not null,
  total_venta   numeric(12,2),          -- TOTAL VENTA (del sistema POS)
  -- Desglose SISTEMA - CAJA
  sis_yape_qr   numeric(12,2) default 0,
  sis_tarjeta   numeric(12,2) default 0,
  sis_efec_tot  numeric(12,2) default 0, -- TOT Efec
  sis_efectivo  numeric(12,2) default 0, -- Efectivo (neto)
  sis_gastos    numeric(12,2) default 0, -- Gastos del día (salidas de caja)
  -- Desglose VALIDACION (contado / comprobantes)
  val_yape_wsp  numeric(12,2) default 0,
  val_yape_cta  numeric(12,2) default 0,
  val_tarjeta   numeric(12,2) default 0,
  val_efectivo  numeric(12,2) default 0,
  -- Conciliación
  diferencia    numeric(12,2) generated always as
                  ((coalesce(val_yape_wsp,0)+coalesce(val_yape_cta,0)+coalesce(val_tarjeta,0)+coalesce(val_efectivo,0))
                   - coalesce(total_venta,0)) stored,
  nota          text,
  creado_por    uuid references perfiles(id),
  created_at    timestamptz not null default now(),
  unique (sede_id, fecha)
);

-- ---------------------------------------------------------------------
-- VENTAS (export crudo del POS — reporte "Reporte de ventas")
-- 1 fila por ticket. La sede se elige al importar (el export no la trae).
-- ---------------------------------------------------------------------
create table if not exists ventas (
  id            uuid primary key default gen_random_uuid(),
  sede_id       uuid references sedes(id),
  vendido_en    timestamptz not null,   -- Fecha (fecha + hora del ticket)
  fecha         date not null,          -- solo día, para agrupar rápido
  caja          text,                   -- "CAJA PRINCIPAL"
  cliente       text,
  documento     text,                   -- "NV01-3982"
  canal         text,                   -- MOSTRADOR | SALON | DELIVERY
  mesa          text,                   -- si canal = SALON
  tipo_pago     text,                   -- YAPE | EFECTIVO | TARJETA | ...
  total         numeric(12,2),
  estado        text,                   -- Registrado | Anulado ...
  origen_archivo text,                  -- nombre del excel importado
  created_at    timestamptz not null default now(),
  unique (sede_id, documento)           -- evita duplicar el mismo ticket
);
create index if not exists ventas_sede_fecha on ventas (sede_id, fecha);

-- VENTAS POR PRODUCTO (reporte "Ventas por producto", agregado por rango)
create table if not exists ventas_productos (
  id            uuid primary key default gen_random_uuid(),
  sede_id       uuid references sedes(id),
  periodo_ini   date,
  periodo_fin   date,
  categoria     text,
  producto      text,
  presentacion  text,
  cant_salon    numeric(10,2) default 0,
  cant_mostrador numeric(10,2) default 0,
  cant_delivery numeric(10,2) default 0,
  cant_total    numeric(10,2) default 0,
  precio_venta  numeric(10,2),
  total         numeric(12,2),
  origen_archivo text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- COMPRAS
-- Catálogo (de "Proyectado de Comprar"), listas por sede y consolidado.
-- ---------------------------------------------------------------------
create table if not exists compras_productos (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  unidad        text,                   -- und, kg, paquete...
  proveedor     text,
  precio_min    numeric(10,2),
  precio_max    numeric(10,2),
  frecuencia    text,                   -- "pasando un día", "diario"...
  activo        boolean not null default true
);

-- Lista que arma cada sede (cabecera)
create table if not exists compras_listas (
  id            uuid primary key default gen_random_uuid(),
  sede_id       uuid references sedes(id),
  fecha         date not null default now(),
  estado        text not null default 'abierta', -- abierta|enviada|consolidada|comprada
  creado_por    uuid references perfiles(id),
  created_at    timestamptz not null default now()
);

create table if not exists compras_lista_items (
  id            uuid primary key default gen_random_uuid(),
  lista_id      uuid not null references compras_listas(id) on delete cascade,
  producto_id   uuid references compras_productos(id),
  nombre_libre  text,                   -- si no está en catálogo
  cantidad      numeric(10,2),
  unidad        text,
  comprado      boolean not null default false
);

-- Faltantes de almacén que compra el dueño y se reparten
create table if not exists almacen_movimientos (
  id            uuid primary key default gen_random_uuid(),
  producto_id   uuid references compras_productos(id),
  nombre_libre  text,
  tipo          text not null,          -- entrada|salida
  cantidad      numeric(10,2),
  sede_id       uuid references sedes(id), -- destino en salidas
  nota          text,
  fecha         date not null default now(),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- PLANILLA + DESCUENTOS  (de "Horario"/"Planilla"/"Descuentos")
-- ---------------------------------------------------------------------
create table if not exists planilla_periodos (
  id            uuid primary key default gen_random_uuid(),
  anio          int not null,
  mes           int not null,
  estado        text not null default 'abierto',
  unique (anio, mes)
);

create table if not exists planilla_detalle (
  id            uuid primary key default gen_random_uuid(),
  periodo_id    uuid not null references planilla_periodos(id) on delete cascade,
  persona_id    uuid references personas(id),
  sueldo_base   numeric(10,2),
  descuentos    numeric(10,2) default 0,
  adelantos     numeric(10,2) default 0,
  neto          numeric(10,2) generated always as
                  (coalesce(sueldo_base,0)-coalesce(descuentos,0)-coalesce(adelantos,0)) stored,
  nota          text
);

-- ---------------------------------------------------------------------
-- GASTOS (gerenciales / administrativos / operativos) + PRÉSTAMOS
-- ---------------------------------------------------------------------
create table if not exists gastos (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null default now(),
  categoria     text not null,          -- gerencial|administrativo|operativo|financiero
  concepto      text not null,
  monto         numeric(12,2) not null,
  sede_id       uuid references sedes(id), -- null = general
  medio_pago    text,
  nota          text,
  creado_por    uuid references perfiles(id),
  created_at    timestamptz not null default now()
);

create table if not exists prestamos (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,          -- "Charo 1 (90k)", "Bastian 30k"...
  cuota         numeric(12,2),
  frecuencia    text default 'Mensual',
  fecha_cuota   date,
  estado        text default 'PENDIENTE', -- PAGADO|PENDIENTE
  nota          text
);
