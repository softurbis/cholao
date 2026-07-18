-- =====================================================================
-- Sistema Cholao — Lista de cocina: enviar y bloquear (v27)
--
-- La lista de cada sede ahora tiene un ciclo claro:
--   abierta  → la cocina la arma y edita (botones +/−)
--   enviada  → la cocina le dio "Enviar": queda BLOQUEADA y le llega a Juan
--   atendida → Juan ya la procesó
-- Mientras está `enviada`, la cocina la ve pero no la toca; Juan puede LIBERARLA
-- (volver a `abierta`) si hay que corregir algo.
--
-- El consolidado que ve Juan suma solo las listas ENVIADAS (lo que le mandaron).
--
-- Ejecutar DESPUÉS de 26_fk_productos.sql.
-- =====================================================================

-- La lista es una guía: un comentario que la cocina escribe antes de enviar.
alter table compras_listas add column if not exists comentario text;

-- Consolidado = suma por producto de lo que la cocina ENVIÓ.
create or replace view vista_consolidado_listas as
select
  coalesce(i.producto_id::text, 'libre:' || upper(coalesce(i.nombre_libre, '?'))) as clave,
  coalesce(p.nombre, upper(i.nombre_libre)) as producto,
  coalesce(p.unidad, i.unidad) as unidad,
  sum(coalesce(i.cantidad, 0)) as total_pedido,
  count(distinct l.sede_id) as sedes
from compras_lista_items i
join compras_listas l on l.id = i.lista_id and l.estado = 'enviada'
left join productos p on p.id = i.producto_id
where i.comprado = false
group by 1, 2, 3
order by 2;
alter view vista_consolidado_listas set (security_invoker = true);
