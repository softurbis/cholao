-- =====================================================================
-- Sistema Cholao — Reapuntar producto_id al catálogo nuevo (v26)
--
-- BUG: almacen_movimientos.producto_id y compras_lista_items.producto_id tenían
-- su llave foránea apuntando a la tabla VIEJA `compras_productos`, no al catálogo
-- maestro nuevo `productos` (sql/24). Por eso:
--   · La cocina no podía guardar un item elegido del catálogo (FK rota).
--   · El almacén/kardex no aceptaba movimientos de productos del catálogo.
-- Aquí se reapuntan esas llaves a `productos`. Las tablas están casi vacías, y
-- cualquier producto_id huérfano (que no exista en productos) se deja en NULL
-- para no romper la migración.
--
-- Ejecutar DESPUÉS de 25_gastos_unificado.sql.
-- =====================================================================

-- ---- almacen_movimientos ----
alter table almacen_movimientos drop constraint if exists almacen_movimientos_producto_id_fkey;
update almacen_movimientos set producto_id = null
  where producto_id is not null and producto_id not in (select id from productos);
alter table almacen_movimientos
  add constraint almacen_movimientos_producto_id_fkey
  foreign key (producto_id) references productos(id);

-- ---- compras_lista_items (la lista de cocina) ----
alter table compras_lista_items drop constraint if exists compras_lista_items_producto_id_fkey;
update compras_lista_items set producto_id = null
  where producto_id is not null and producto_id not in (select id from productos);
alter table compras_lista_items
  add constraint compras_lista_items_producto_id_fkey
  foreign key (producto_id) references productos(id);

-- ---- compras.producto_id (hoy nadie lo usa, pero para que el formulario de
-- compras de Juan pueda ligar al catálogo cuando se construya) ----
alter table compras drop constraint if exists compras_producto_id_fkey;
update compras set producto_id = null
  where producto_id is not null and producto_id not in (select id from productos);
alter table compras
  add constraint compras_producto_id_fkey
  foreign key (producto_id) references productos(id);
