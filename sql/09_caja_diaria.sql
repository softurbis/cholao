-- =====================================================================
-- Sistema Cholao — Caja Diaria por TURNO (v9) — el módulo central
-- Reemplaza la caja_diaria simple por el modelo real (turno mañana/tarde
-- con cuadre de pagos, gastos tienda, descuentos a personal, stock y metas).
-- Ejecutar después de 08_vistas_dashboard.sql
-- =====================================================================

-- Turno de caja (1 por sede, fecha y turno)
create table if not exists caja_turno (
  id            uuid primary key default gen_random_uuid(),
  sede_id       uuid references sedes(id),
  fecha         date not null,
  turno         text not null,               -- manana | tarde
  cajero        text,
  -- Cuadre de medios de pago
  tarjeta       numeric(12,2) default 0,
  plin          numeric(12,2) default 0,
  yape_qr       numeric(12,2) default 0,
  yape_fotos    numeric(12,2) default 0,
  yape_total    numeric(12,2) default 0,
  efectivo      numeric(12,2) default 0,
  gastos_tienda numeric(12,2) default 0,      -- total gastos del turno
  venta_total   numeric(12,2),               -- venta contada del turno
  venta_sistema numeric(12,2),               -- lo que dice el POS
  deficit_sobra numeric(12,2),               -- + sobra / − déficit
  meta_turno    numeric(12,2),
  rendimiento   text,
  clima         text,
  observaciones text,
  origen_archivo text,
  created_at    timestamptz not null default now(),
  unique (sede_id, fecha, turno)
);
create index if not exists caja_turno_fecha on caja_turno (fecha);

-- Gastos de tienda del turno (almuerzo, gasolina, vigilancia...)
create table if not exists caja_gastos (
  id          uuid primary key default gen_random_uuid(),
  turno_id    uuid references caja_turno(id) on delete cascade,
  descripcion text,
  monto       numeric(12,2),
  detalle     text                            -- LOCAL | DELIVERY
);

-- Descuentos / adelantos al personal (→ alimentan la planilla)
create table if not exists caja_descuentos (
  id          uuid primary key default gen_random_uuid(),
  turno_id    uuid references caja_turno(id) on delete cascade,
  persona     text,
  monto       numeric(12,2),
  tipo        text                            -- ADELANTO | CONSUMO | DESCUENTO
);

-- Control de stock por turno y producto
create table if not exists caja_stock (
  id            uuid primary key default gen_random_uuid(),
  turno_id      uuid references caja_turno(id) on delete cascade,
  producto      text,
  inicio        numeric(12,2),
  adicion       numeric(12,2),
  salida        numeric(12,2),
  cierre        numeric(12,2),
  vendido       numeric(12,2),
  venta_sistema numeric(12,2),
  diferencia    numeric(12,2)
);

-- Metas por sede, día de la semana y turno (de la hoja CONFIGURACION)
create table if not exists caja_metas (
  id          uuid primary key default gen_random_uuid(),
  sede_id     uuid references sedes(id),
  dia_semana  text,
  turno       text,
  meta        numeric(12,2),
  unique (sede_id, dia_semana, turno)
);
