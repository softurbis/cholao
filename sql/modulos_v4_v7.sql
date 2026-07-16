-- Sistema Cholao — Módulos v4 a v7 (compras/stock, flujo, crédito, obligaciones)
-- Pegar TODO en el SQL Editor de Supabase y RUN (después de setup_completo.sql y 03_ajustes.sql)


-- ===== 04_compras_stock.sql =====
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


-- ===== 05_flujo.sql =====
-- =====================================================================
-- Sistema Cholao — Flujo de dinero (v5)
-- Modelo confirmado: arranca en 0 (2026). Ingreso = toda la venta del día.
-- Egresos = compras + planilla + gastos (admin/gerencial) + deudas/retiros.
-- Saldo = ingresos acumulados − egresos acumulados. Consolidado y por sede.
-- Ejecutar después de 04_compras_stock.sql
-- =====================================================================

-- Saldo de apertura por sede (2026 arranca en 0; editable si algún día hace falta)
create table if not exists flujo_apertura (
  sede_id   uuid references sedes(id),
  fecha     date not null,
  monto     numeric(14,2) not null default 0,
  nota      text,
  primary key (sede_id, fecha)
);

-- ---------------------------------------------------------------------
-- Vista unificada: cada movimiento de dinero (+ ingreso / − egreso)
-- ---------------------------------------------------------------------
create or replace view vista_flujo_mov as
  -- INGRESOS: toda la venta del día, por sede
  select v.fecha, v.sede_id, 'ingreso'::text as tipo, 'ventas'::text as categoria,
         sum(v.total) as monto
  from ventas v
  group by v.fecha, v.sede_id

  union all
  -- EGRESOS: compras / insumos
  select c.fecha, c.destino_sede_id, 'egreso', 'compras',
         -sum(c.total)
  from compras c
  group by c.fecha, c.destino_sede_id

  union all
  -- EGRESOS: gastos (administrativo / gerencial / operativo / financiero / retiro)
  select g.fecha, g.sede_id, 'egreso', g.categoria,
         -sum(g.monto)
  from gastos g
  group by g.fecha, g.sede_id, g.categoria

  union all
  -- EGRESOS: planilla del mes (sueldo neto pagado), fecha = fin de mes
  select (make_date(pm.anio, pm.mes, 1) + interval '1 month - 1 day')::date,
         pe.sede_id, 'egreso', 'planilla',
         -sum(coalesce(pm.sueldo_neto, 0))
  from planilla_mensual pm
  left join personas pe on pe.id = pm.persona_id
  group by 1, pe.sede_id;

-- ---------------------------------------------------------------------
-- Resumen diario por sede con SALDO ACUMULADO (lo que va quedando)
-- ---------------------------------------------------------------------
create or replace view vista_flujo_diario as
select
  fecha,
  sede_id,
  sum(monto) filter (where tipo = 'ingreso') as ingresos,
  -sum(monto) filter (where tipo = 'egreso') as egresos,
  sum(monto)                                 as neto_dia,
  sum(sum(monto)) over (partition by sede_id order by fecha
                        rows between unbounded preceding and current row) as saldo_acumulado
from vista_flujo_mov
group by fecha, sede_id
order by fecha;

-- Consolidado (todas las sedes juntas) por día
create or replace view vista_flujo_consolidado as
select
  fecha,
  sum(monto) filter (where tipo = 'ingreso') as ingresos,
  -sum(monto) filter (where tipo = 'egreso') as egresos,
  sum(monto)                                 as neto_dia,
  sum(sum(monto)) over (order by fecha
                        rows between unbounded preceding and current row) as saldo_acumulado
from vista_flujo_mov
group by fecha
order by fecha;


-- ===== 06_compras_credito.sql =====
-- =====================================================================
-- Sistema Cholao — Compras al contado vs crédito + Cuentas por pagar (v6)
-- Separa los dos "relojes": ALMACÉN (llega el producto) vs DINERO (se paga).
-- Ejecutar después de 04_compras_stock.sql
-- =====================================================================

-- Condición de pago en cada compra (recepción de mercadería)
alter table compras add column if not exists condicion_pago text not null default 'contado'; -- contado | credito
alter table compras add column if not exists acreedor       text;    -- "Tarjeta Primo", "La Peruanita"...
alter table compras add column if not exists estado_pago    text not null default 'pagado';   -- pagado | pendiente
alter table compras add column if not exists fecha_pago     date;    -- cuándo salió el dinero

-- Regla de negocio:
--   * contado  -> estado_pago='pagado',    fecha_pago=fecha   (sube stock Y sale del flujo)
--   * credito  -> estado_pago='pendiente', fecha_pago=null    (sube stock, NO sale del flujo aún)
-- El stock siempre sube al recibir (trigger de 04). El flujo se alimenta del
-- ledger de gastos (pagos reales), NO de estas recepciones -> sin doble conteo.

-- ---------------------------------------------------------------------
-- Cuentas por pagar: lo que llegó a crédito y aún no se paga
-- ---------------------------------------------------------------------
create or replace view vista_cuentas_por_pagar as
select
  coalesce(acreedor, proveedor, 'Sin acreedor') as acreedor,
  count(*)              as compras_pendientes,
  sum(total)            as deuda_total,
  min(fecha)            as compra_mas_antigua
from compras
where condicion_pago = 'credito' and estado_pago = 'pendiente'
group by 1
order by deuda_total desc;


-- ===== 07_obligaciones.sql =====
-- =====================================================================
-- Sistema Cholao — Cuentas por pagar / Obligaciones (v7)
-- Apartado configurable: gastos fijos y variables con fecha de vencimiento,
-- para prever cuánto se paga cada mes. Editable por el usuario.
-- Ejecutar después de 06_compras_credito.sql
-- =====================================================================

create table if not exists obligaciones (
  id               uuid primary key default gen_random_uuid(),
  concepto         text not null,          -- "Alquiler Amazonas", "Luz", "Cuota préstamo tía Charo"
  tipo             text not null default 'fijo',    -- fijo | variable
  categoria        text,                   -- admin_gerencial | deuda_retiro | planilla | compras | servicios
  acreedor         text,                   -- a quién se le paga
  monto            numeric(12,2),          -- monto (o estimado, si es variable)
  frecuencia       text not null default 'mensual', -- mensual | quincenal | unica
  dia_vencimiento  int,                    -- día del mes que vence (1-31), para recurrentes
  fecha_vencimiento date,                  -- para obligaciones únicas
  sede_id          uuid references sedes(id),
  activo           boolean not null default true,
  nota             text,
  created_at       timestamptz not null default now()
);

-- Pagos aplicados a cada obligación (para saber qué ya se pagó y qué falta este mes)
create table if not exists obligaciones_pagos (
  id             uuid primary key default gen_random_uuid(),
  obligacion_id  uuid references obligaciones(id) on delete cascade,
  anio           int not null,
  mes            int not null,
  fecha_pago     date,
  monto          numeric(12,2),
  gasto_id       uuid references gastos(id),   -- enlace al movimiento real del ledger
  created_at     timestamptz not null default now(),
  unique (obligacion_id, anio, mes)
);

-- ---------------------------------------------------------------------
-- Semilla de obligaciones fijas detectadas en tus datos (EDÍTALAS:
-- montos/días son estimados de tu ledger y reporte gerencial).
-- ---------------------------------------------------------------------
insert into obligaciones (concepto, tipo, categoria, acreedor, monto, frecuencia, dia_vencimiento, nota) values
  ('Alquiler Amazonas',        'fijo', 'admin_gerencial', 'Arrendador',   2500.00, 'mensual', 1,  'estimado del reporte gerencial'),
  ('Luz Amazonas',             'fijo', 'admin_gerencial', 'Electro',      1007.00, 'mensual', 3,  'estimado del ledger'),
  ('Internet Amazonas',        'fijo', 'admin_gerencial', 'ISP',           160.00, 'mensual', 9,  'estimado del ledger'),
  ('Internet Miraflores',      'fijo', 'admin_gerencial', 'ISP',            85.00, 'mensual', 4,  'estimado del ledger'),
  ('Marketing / Piwi',         'fijo', 'admin_gerencial', 'Piwi',         1100.00, 'mensual', 7,  'estimado del ledger'),
  ('Cuota préstamo tía Charo', 'fijo', 'deuda_retiro',    'Tía Charo',    4526.00, 'mensual', 22, 'estimado del ledger'),
  ('Sueldos',                  'variable', 'planilla',    'Personal',    15946.00, 'mensual', 5,  'promedio; el real sale de planilla')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Vista: obligaciones + su estado de pago para un mes (calendario)
-- Uso: select * from vista_obligaciones_mes(2026, 7);
-- ---------------------------------------------------------------------
create or replace function vista_obligaciones_mes(p_anio int, p_mes int)
returns table (
  concepto text, tipo text, categoria text, acreedor text,
  monto numeric, vence date, pagado boolean, monto_pagado numeric
) language sql stable as $$
  select
    o.concepto, o.tipo, o.categoria, o.acreedor, o.monto,
    case when o.frecuencia = 'unica' then o.fecha_vencimiento
         else make_date(p_anio, p_mes, least(coalesce(o.dia_vencimiento,1),
              extract(day from (make_date(p_anio,p_mes,1)+interval '1 month -1 day'))::int)) end as vence,
    (p.id is not null) as pagado,
    p.monto as monto_pagado
  from obligaciones o
  left join obligaciones_pagos p
    on p.obligacion_id = o.id and p.anio = p_anio and p.mes = p_mes
  where o.activo
    and (o.frecuencia <> 'unica'
         or (extract(year from o.fecha_vencimiento) = p_anio
             and extract(month from o.fecha_vencimiento) = p_mes))
  order by vence;
$$;

