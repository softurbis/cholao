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
