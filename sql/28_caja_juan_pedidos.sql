-- =====================================================================
-- Sistema Cholao — Caja diaria de Juan + pedidos con unidad de compra (v28)
--
-- Cierra el circuito de compras con la operación real de Juan:
--
-- 1) CAJA DIARIA DE JUAN (el "cuadre" que faltaba). Su dinero sale SOLO de
--    Amazonas. Cada día arranca con:
--       vuelto del día anterior  (saldo de cierre)
--     + efectivo Amazonas mañana (del turno que cerró)
--     + efectivo Amazonas tarde
--     + adicionales             (a veces le depositan/le dan efectivo, con comprobante)
--     − compras del día         (lo que registró en su app)
--     − entregas a gerencia     (NO es gasto, pero sale de su caja)
--     = vuelto/saldo            (base del día siguiente)
--    Se apoya en `fondo_compras_dia` (ya existía) + `fondo_movimientos` (nuevo,
--    para los adicionales y entregas, cada uno con 1 o varios comprobantes).
--
-- 2) UNIDAD DE COMPRA. La cocina pide en la unidad base (kg). Juan compra al por
--    mayor en otra unidad (saco). El catálogo guarda el factor: 1 saco = 25 kg.
--
-- 3) PEDIDO. Juan arma SU pedido (en su unidad) y lo ENVÍA a Cesar. Cesar
--    reconfirma, ajusta lo que realmente entra (en unidad base), pone
--    comprobantes (si hay) y SOLO al aceptar se ingresa al almacén.
--
-- 4) RECEPCIÓN. Al día siguiente la sede valida, conforme llega, cuánto recibió
--    de cada ítem (parcial permitido). Cada recepción DESCUENTA del almacén
--    central (salida hacia esa sede). Lo hacen la sede (Mi Lista) o Juan/almacén.
--
-- Ejecutar DESPUÉS de 27_lista_enviada.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Factor de conversión de compra en el catálogo.
-- 1 <unidad_compra> = <factor_compra> × <unidad base>. Ej: PAPA base 'kg',
-- unidad_compra 'saco', factor_compra 25 → 1 saco = 25 kg. Si no se define,
-- Juan pide en la unidad base y no hay conversión.
-- ---------------------------------------------------------------------
alter table productos add column if not exists unidad_compra text;
alter table productos add column if not exists factor_compra numeric;
comment on column productos.factor_compra is '1 unidad_compra = factor_compra unidades base (ej. 1 saco = 25 kg)';

-- ---------------------------------------------------------------------
-- 2) Caja diaria de Juan: cierre del cuadre + total de adicionales.
-- (Los movimientos con comprobante van en fondo_movimientos, abajo.)
-- ---------------------------------------------------------------------
alter table fondo_compras_dia add column if not exists adicionales numeric(12,2) default 0;
alter table fondo_compras_dia add column if not exists cerrado boolean not null default false;
alter table fondo_compras_dia add column if not exists cerrado_por uuid references perfiles(id);

-- ---------------------------------------------------------------------
-- 3) Movimientos del fondo: adicionales (entra plata) y entregas a gerencia
-- (sale plata, NO es compra). Cada uno con 1 o varios comprobantes.
-- ---------------------------------------------------------------------
create table if not exists fondo_movimientos (
  id             uuid primary key default gen_random_uuid(),
  fecha          date not null default current_date,
  tipo           text not null check (tipo in ('adicional', 'entrega_gerencia')),
  monto          numeric(12,2) not null,
  medio          text,                            -- efectivo | deposito | yape | transferencia
  nota           text,
  vouchers       text[] not null default '{}',    -- bucket arqueos, prefijo fondo/
  registrado_por uuid references perfiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists fondo_mov_fecha on fondo_movimientos (fecha);

alter table fondo_movimientos enable row level security;
drop policy if exists fondo_mov_op on fondo_movimientos;
create policy fondo_mov_op on fondo_movimientos
  for all to authenticated using (puede_compras_op()) with check (puede_compras_op());

-- fondo_compras_dia: que Juan (compras) lo opere, no solo el piso super/admin.
drop policy if exists fondo_dia_op on fondo_compras_dia;
create policy fondo_dia_op on fondo_compras_dia
  for all to authenticated using (puede_compras_op()) with check (puede_compras_op());

-- ---------------------------------------------------------------------
-- 4) Juan lee la caja de Amazonas (el efectivo que recibe), aunque su sede
-- asignada sea otra. Solo lectura, aditiva a las policies de sql/21.
-- ---------------------------------------------------------------------
drop policy if exists caja_turno_compras on caja_turno;
create policy caja_turno_compras on caja_turno
  for select to authenticated using (puede_compras_op());

-- ---------------------------------------------------------------------
-- 5) Pedidos: Juan los ENVÍA; Cesar reconfirma, pone comprobantes y al
-- ACEPTAR recién ingresa al almacén. Nuevo estado 'enviado' + comprobantes.
-- ---------------------------------------------------------------------
alter table pedidos drop constraint if exists pedidos_estado_check;
alter table pedidos add constraint pedidos_estado_check
  check (estado in ('pendiente', 'enviado', 'comprado', 'recibido', 'anulado'));
alter table pedidos add column if not exists vouchers       text[] not null default '{}';
alter table pedidos add column if not exists comprobante    text;
alter table pedidos add column if not exists confirmado_por uuid references perfiles(id);

-- La cantidad que Juan pide va en SU unidad (pedido_items.cantidad/unidad); la
-- que realmente ENTRA al almacén (unidad base) se fija al aceptar.
alter table pedido_items add column if not exists cantidad_ingreso numeric(12,2);
comment on column pedido_items.cantidad_ingreso is 'Cantidad en unidad base que entró al almacén al aceptar el pedido';

-- ---------------------------------------------------------------------
-- 6) Consolidado POR SEDE: además del total (vista_consolidado_listas de
-- sql/27), el desglose por sede. Suma solo listas ENVIADAS, ítems no comprados.
-- ---------------------------------------------------------------------
create or replace view vista_consolidado_sede as
select
  coalesce(i.producto_id::text, 'libre:' || upper(coalesce(i.nombre_libre, '?'))) as clave,
  coalesce(p.nombre, upper(i.nombre_libre)) as producto,
  coalesce(p.unidad, i.unidad) as unidad,
  l.sede_id,
  s.nombre as sede,
  sum(coalesce(i.cantidad, 0)) as cantidad
from compras_lista_items i
join compras_listas l on l.id = i.lista_id and l.estado = 'enviada'
left join productos p on p.id = i.producto_id
left join sedes s on s.id = l.sede_id
where i.comprado = false
group by 1, 2, 3, 4, 5
order by 2, 5;
alter view vista_consolidado_sede set (security_invoker = true);

-- ---------------------------------------------------------------------
-- 7) RECEPCIÓN / VALIDACIÓN DE ENTREGA por la sede.
-- Al día siguiente, las señoras del almacén de cada sede confirman, CONFORME va
-- llegando, cuánto recibieron de cada ítem de su lista. Cada recepción descuenta
-- del almacén central (una SALIDA hacia esa sede). Es incremental y parcial:
-- cantidad_recibida se acumula. Lo hacen la sede (en Mi Lista) o Juan/almacén
-- (en Compras). También pueden entrar recepciones de emergencia (fuera de la
-- lista): una salida directa con nota.
-- ---------------------------------------------------------------------
alter table compras_lista_items add column if not exists cantidad_recibida numeric(12,2) not null default 0;

-- La cocina inserta SALIDAS del almacén al validar recepción (solo de SU sede).
-- Aditiva a almacen_juan (puede_compras_op) de sql/24.
drop policy if exists almacen_recepcion_cocina on almacen_movimientos;
create policy almacen_recepcion_cocina on almacen_movimientos
  for insert to authenticated
  with check (mi_rol()::text = 'cocina' and tipo = 'salida' and sede_id = mi_sede());

-- Y que la cocina LEA los movimientos de su sede (para ver qué ya recibió).
drop policy if exists almacen_lee_cocina on almacen_movimientos;
create policy almacen_lee_cocina on almacen_movimientos
  for select to authenticated
  using (puede_compras_op() or (mi_rol()::text = 'cocina' and sede_id = mi_sede()));
