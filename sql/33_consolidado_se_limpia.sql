-- =====================================================================
-- Sistema Cholao — El consolidado se limpia solo (v33)
--
-- EL PROBLEMA (venía desde sql/24): `vista_consolidado_listas` y
-- `vista_consolidado_sede` filtran por `compras_lista_items.comprado = false`,
-- pero NADA en la app ponía ese campo en true. El `comprado = true` que existía
-- en el código era sobre `pedido_items`, que es otra tabla.
--
-- Consecuencia: lo que una sede pidió el lunes le seguía apareciendo a Juan el
-- martes y el miércoles. La única forma de sacarlo era que alguien se acordara
-- de marcar la lista como "atendida" a mano, en otra pantalla. Si se le olvidaba,
-- el consolidado se iba acumulando y Juan terminaba comprando de más.
--
-- LA REGLA CORRECTA: un producto deja de estar pendiente cuando LLEGÓ a la sede
-- (no cuando se compró — comprado y no entregado sigue siendo un pendiente).
-- Y una lista se cierra sola cuando ya no le queda nada por llegar.
--
-- Ejecutar DESPUÉS de 32_asistencia.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) El ítem se marca atendido cuando ya llegó todo lo que se pidió.
-- BEFORE sobre la misma fila: no hay recursión.
-- ---------------------------------------------------------------------
create or replace function marcar_item_recibido() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(new.cantidad, 0) > 0
     and coalesce(new.cantidad_recibida, 0) >= new.cantidad then
    new.comprado := true;
  end if;
  return new;
end $$;

drop trigger if exists trg_item_recibido on compras_lista_items;
create trigger trg_item_recibido
  before insert or update of cantidad_recibida, cantidad on compras_lista_items
  for each row execute function marcar_item_recibido();

-- ---------------------------------------------------------------------
-- 2) La lista se cierra sola cuando ya no le queda nada pendiente.
-- AFTER, y solo pasa de 'enviada' a 'atendida': no revive listas cerradas ni
-- toca las que la cocina todavía está armando.
-- ---------------------------------------------------------------------
create or replace function cerrar_lista_completa() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- Una lista sin ítems no se cierra: estaría "completa" por vacía.
  if exists (select 1 from compras_lista_items where lista_id = new.lista_id)
     and not exists (
       select 1 from compras_lista_items
       where lista_id = new.lista_id and coalesce(comprado, false) = false
     )
  then
    update compras_listas set estado = 'atendida'
      where id = new.lista_id and estado = 'enviada';
  end if;
  return null;
end $$;

drop trigger if exists trg_cerrar_lista on compras_lista_items;
create trigger trg_cerrar_lista
  after insert or update of cantidad_recibida, cantidad, comprado on compras_lista_items
  for each row execute function cerrar_lista_completa();

-- ---------------------------------------------------------------------
-- 3) Poner al día lo que ya estaba recibido antes de este arreglo.
-- ---------------------------------------------------------------------
update compras_lista_items
   set comprado = true
 where coalesce(cantidad, 0) > 0
   and coalesce(cantidad_recibida, 0) >= cantidad
   and coalesce(comprado, false) = false;

update compras_listas l
   set estado = 'atendida'
 where l.estado = 'enviada'
   and exists (select 1 from compras_lista_items i where i.lista_id = l.id)
   and not exists (
     select 1 from compras_lista_items i
      where i.lista_id = l.id and coalesce(i.comprado, false) = false
   );
