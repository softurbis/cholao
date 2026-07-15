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
