-- =====================================================================
-- Sistema Cholao — Compras reales + Stock valorizado (v4)
-- Los precios varían por temporada: cada compra guarda su precio real.
-- Ejecutar en el SQL Editor después de 03_ajustes.sql
-- =====================================================================

-- Costos derivados en el catálogo (se recalculan con cada compra)
alter table compras_productos add column if not exists costo_ultimo    numeric(12,2);
alter table compras_productos add column if not exists costo_promedio  numeric(12,2);
alter table compras_productos add column if not exists stock_actual     numeric(12,2) not null default 0;

-- ---------------------------------------------------------------------
-- COMPRAS reales (cada línea = una compra con su precio del momento)
-- ---------------------------------------------------------------------
create table if not exists compras (
  id              uuid primary key default gen_random_uuid(),
  fecha           date not null default now(),
  producto_id     uuid references compras_productos(id),
  nombre_libre    text,                        -- si no está en catálogo
  categoria       text,
  cantidad        numeric(12,3) not null,
  unidad          text,
  precio_unitario numeric(12,2) not null,      -- precio REAL de compra (variable)
  total           numeric(14,2) generated always as (cantidad * precio_unitario) stored,
  proveedor       text,
  destino_sede_id uuid references sedes(id),   -- null = almacén general
  medio_pago      text,
  nota            text,
  registrado_por  uuid references perfiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists compras_fecha on compras (fecha);
create index if not exists compras_producto on compras (producto_id);

-- ---------------------------------------------------------------------
-- Vista de stock valorizado: stock actual x costo (último por defecto)
-- ---------------------------------------------------------------------
create or replace view vista_stock_valorizado as
select
  p.id,
  p.nombre,
  p.categoria,
  p.unidad,
  p.stock_actual,
  p.costo_ultimo,
  p.costo_promedio,
  round(p.stock_actual * coalesce(p.costo_ultimo, p.costo_promedio, 0), 2)  as valor_ultimo,
  round(p.stock_actual * coalesce(p.costo_promedio, p.costo_ultimo, 0), 2)  as valor_promedio
from compras_productos p
where p.activo;

-- ---------------------------------------------------------------------
-- Al registrar una compra: sube stock, guarda costo último y recalcula
-- el costo promedio ponderado del producto.
-- ---------------------------------------------------------------------
create or replace function fn_compra_actualiza_stock() returns trigger
language plpgsql as $$
declare
  v_stock_prev numeric;
  v_costo_prev numeric;
begin
  if new.producto_id is null then return new; end if;

  select stock_actual, costo_promedio into v_stock_prev, v_costo_prev
  from compras_productos where id = new.producto_id;

  -- Promedio ponderado: (stock*costo + compra) / (stock + cantidad)
  update compras_productos
  set
    stock_actual   = coalesce(stock_actual,0) + new.cantidad,
    costo_ultimo   = new.precio_unitario,
    costo_promedio = case
      when coalesce(v_stock_prev,0) + new.cantidad = 0 then new.precio_unitario
      else round(
        (coalesce(v_stock_prev,0) * coalesce(v_costo_prev, new.precio_unitario)
         + new.cantidad * new.precio_unitario)
        / (coalesce(v_stock_prev,0) + new.cantidad), 2)
    end
  where id = new.producto_id;

  return new;
end $$;

drop trigger if exists trg_compra_stock on compras;
create trigger trg_compra_stock after insert on compras
  for each row execute function fn_compra_actualiza_stock();
