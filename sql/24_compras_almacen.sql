-- =====================================================================
-- Sistema Cholao — Compras y Almacén (v24)
--
-- El circuito que opera Juan:
--   1. Cada sede (cocina) sube su lista → a Juan le llega CONSOLIDADO (suma por
--      producto, con su unidad).
--   2. Juan no compra todo: puede pedir del ALMACÉN central lo que ya haya.
--   3. Lo que falta lo arma como PEDIDO → va a Cesar (superusuario).
--   4. Cesar compra al por mayor e INGRESA al stock del almacén.
--   5. Del almacén se reparte a las sedes (salida).
--
-- Para que el consolidado se sume solo, la lista de cocina elige PRODUCTOS de un
-- catálogo (cada uno con su unidad), no texto libre. Ese catálogo lo mantiene Juan.
--
-- Ejecutar DESPUÉS de 23_roles_admin_cocina.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Permiso especial de Juan (es cajero, pero además registra compras).
-- Mismo patrón que el puede_gastos de Fernanda.
-- ---------------------------------------------------------------------
alter table perfiles add column if not exists puede_compras boolean not null default false;
comment on column perfiles.puede_compras is 'true = aunque sea cajera, opera el módulo Compras (caso Juan)';

-- ---------------------------------------------------------------------
-- 2) Proveedores: contacto (Juan necesita el número y la ubicación)
-- ---------------------------------------------------------------------
alter table proveedores add column if not exists telefono  text;
alter table proveedores add column if not exists ubicacion text;
alter table proveedores add column if not exists nota      text;

-- ---------------------------------------------------------------------
-- 3) Las compras de Juan llevan voucher (como los gastos de Fernanda)
-- ---------------------------------------------------------------------
alter table compras add column if not exists voucher_url text;   -- bucket arqueos, prefijo compras/

-- ---------------------------------------------------------------------
-- 4) Catálogo maestro de productos. Cada producto tiene SU unidad, y de ahí
-- elige la cocina — así 5 kg + 5 kg de "PAPA" se consolidan exactos.
-- ---------------------------------------------------------------------
create table if not exists productos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  unidad     text not null default 'unidad',   -- kg, unidad, caja, litro, atado…
  categoria  text,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
-- Único por nombre en mayúscula: no dos "papa"/"PAPA".
create unique index if not exists productos_nombre_uniq on productos (upper(nombre));

-- ---------------------------------------------------------------------
-- 5) Pedidos de Juan a Cesar (lo que Juan necesita que se compre al por mayor)
-- ---------------------------------------------------------------------
create table if not exists pedidos (
  id         uuid primary key default gen_random_uuid(),
  fecha      date not null default current_date,
  estado     text not null default 'pendiente'
             check (estado in ('pendiente', 'comprado', 'recibido', 'anulado')),
  creado_por uuid references perfiles(id),   -- Juan
  nota       text,
  created_at timestamptz not null default now()
);
create table if not exists pedido_items (
  id          uuid primary key default gen_random_uuid(),
  pedido_id   uuid references pedidos(id) on delete cascade,
  producto_id uuid references productos(id),
  nombre_libre text,
  cantidad    numeric(12,2),
  unidad      text,
  comprado    boolean not null default false
);
create index if not exists pedido_items_pedido on pedido_items (pedido_id);

-- ---------------------------------------------------------------------
-- 6) Helper: quién opera compras/almacén.
-- Super, admin, el rol histórico 'compras', y quien tenga el permiso (Juan).
-- ---------------------------------------------------------------------
create or replace function puede_compras_op() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfiles where id = auth.uid() and activo
      and (rol::text in ('superadmin', 'admin', 'compras') or puede_compras)
  )
$$;

-- ---------------------------------------------------------------------
-- 7) RLS de las tablas NUEVAS (nacen después del piso de sql/21/23, así que
-- necesitan sus policies a mano) + ajustes en compras y almacén.
-- ---------------------------------------------------------------------

-- productos: lo LEE todo el personal (la cocina elige de ahí); lo EDITA quien
-- opera compras.
alter table productos enable row level security;
drop policy if exists productos_lee on productos;
create policy productos_lee on productos
  for select to authenticated using (es_personal());
drop policy if exists productos_edita on productos;
create policy productos_edita on productos
  for all to authenticated using (puede_compras_op()) with check (puede_compras_op());

-- pedidos y sus items: Juan y super/admin.
alter table pedidos enable row level security;
drop policy if exists pedidos_op on pedidos;
create policy pedidos_op on pedidos
  for all to authenticated using (puede_compras_op()) with check (puede_compras_op());

alter table pedido_items enable row level security;
drop policy if exists pedido_items_op on pedido_items;
create policy pedido_items_op on pedido_items
  for all to authenticated using (puede_compras_op()) with check (puede_compras_op());

-- compras: Juan (con permiso) registra y ve, además del piso super/admin.
-- Reemplaza la policy compras_juan de sql/21 (que era solo para rol='compras').
drop policy if exists compras_juan on compras;
create policy compras_juan on compras
  for all to authenticated using (puede_compras_op()) with check (puede_compras_op());

-- almacén: Cesar ingresa (piso super/admin) y Juan reparte a sedes (salida).
drop policy if exists almacen_juan on almacen_movimientos;
create policy almacen_juan on almacen_movimientos
  for all to authenticated using (puede_compras_op()) with check (puede_compras_op());

-- ---------------------------------------------------------------------
-- 8) Vista del stock del almacén central.
-- central = sede_id null; ingreso suma, salida resta.
-- ---------------------------------------------------------------------
create or replace view vista_almacen_stock as
select p.id as producto_id, p.nombre, p.unidad,
  coalesce(sum(case when m.tipo = 'ingreso' then m.cantidad
                    when m.tipo = 'salida'  then -m.cantidad else 0 end), 0) as stock
from productos p
left join almacen_movimientos m on m.producto_id = p.id
where p.activo
group by p.id, p.nombre, p.unidad
order by p.nombre;
alter view vista_almacen_stock set (security_invoker = true);

-- ---------------------------------------------------------------------
-- 9) Consolidado de las listas de cocina para Juan: suma por producto de las
-- listas ABIERTAS de todas las sedes. Ligado al catálogo por producto_id;
-- si algún item quedó como texto libre, se agrupa por su nombre en mayúscula.
-- ---------------------------------------------------------------------
create or replace view vista_consolidado_listas as
select
  coalesce(i.producto_id::text, 'libre:' || upper(coalesce(i.nombre_libre, '?'))) as clave,
  coalesce(p.nombre, upper(i.nombre_libre)) as producto,
  coalesce(p.unidad, i.unidad) as unidad,
  sum(coalesce(i.cantidad, 0)) as total_pedido,
  count(distinct l.sede_id) as sedes
from compras_lista_items i
join compras_listas l on l.id = i.lista_id and l.estado <> 'cerrada'
left join productos p on p.id = i.producto_id
where i.comprado = false
group by 1, 2, 3
order by 2;
alter view vista_consolidado_listas set (security_invoker = true);
