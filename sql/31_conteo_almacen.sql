-- =====================================================================
-- Sistema Cholao — Conteo físico del almacén (v31)
--
-- MISMO PRINCIPIO QUE EL EFECTIVO CONTADO (sql/30): el stock que calcula el
-- sistema (ingresos − salidas) SIEMPRE va a cuadrar consigo mismo, porque sale
-- de lo que se registró. Si se perdió, se malogró o alguien sacó algo sin anotar,
-- el número no se entera. El único control real es CONTAR lo que hay.
--
-- Juan cuenta, el sistema guarda las dos cifras y la diferencia, y aplica el
-- ajuste al kardex como un movimiento normal (ingreso si sobró, salida si faltó,
-- con nota CONTEO) para que `vista_almacen_stock` quede igual a la realidad.
--
-- Ejecutar DESPUÉS de 30_efectivo_contado.sql.
-- =====================================================================

create table if not exists almacen_conteos (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null default current_date,
  producto_id uuid references productos(id),
  sistema     numeric(12,2) not null,    -- lo que decía el sistema al momento de contar
  contado     numeric(12,2) not null,    -- lo que había de verdad
  diferencia  numeric(12,2) generated always as (contado - sistema) stored,
  nota        text,
  contado_por uuid references perfiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists almacen_conteos_fecha on almacen_conteos (fecha);
create index if not exists almacen_conteos_prod on almacen_conteos (producto_id);

alter table almacen_conteos enable row level security;
drop policy if exists conteos_op on almacen_conteos;
create policy conteos_op on almacen_conteos
  for all to authenticated using (puede_compras_op()) with check (puede_compras_op());

-- Gerencia mira los conteos (es control: dónde se pierde mercadería).
drop policy if exists conteos_vertodo on almacen_conteos;
create policy conteos_vertodo on almacen_conteos
  for select to authenticated using (ve_todo());

-- Último conteo de cada producto, para saber hace cuánto no se cuenta.
create or replace view vista_ultimo_conteo as
select distinct on (producto_id)
  producto_id, fecha, sistema, contado, diferencia
from almacen_conteos
order by producto_id, fecha desc, created_at desc;
alter view vista_ultimo_conteo set (security_invoker = true);
