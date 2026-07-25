-- =====================================================================
-- Sistema Cholao — Juan lee las listas de las sedes (v29)
--
-- BUG SILENCIOSO que arregla:
-- sql/23 le dio acceso a las listas de cocina a `mi_rol() in ('compras','almacen')`.
-- Pero Juan NO tiene rol 'compras': es **cajera con el permiso `puede_compras`**
-- (el patrón de permisos especiales de sql/24, igual que Fernanda con los gastos).
-- Resultado: Juan no podía leer `compras_listas` ni `compras_lista_items`, así que
-- el consolidado le salía VACÍO — sin error, sin aviso, simplemente sin nada.
-- Se notaba recién al entrar con su usuario (probándolo como Cesar funcionaba,
-- porque el superusuario pasa por otra policy).
--
-- La regla correcta es la misma que ya usa todo el módulo de compras:
-- `puede_compras_op()` = superadmin, admin, rol 'compras', o el permiso puede_compras.
--
-- Gerencia ya podía leerlas por el piso `<tabla>_vertodo` (ve_todo) de sql/23,
-- así que no hace falta tocar nada para que Víctor las mire.
--
-- Ejecutar DESPUÉS de 28_caja_juan_pedidos.sql.
-- =====================================================================

-- Las listas: quien opera compras las ve y las gestiona (liberar / marcar atendida).
drop policy if exists listas_compras on compras_listas;
create policy listas_compras on compras_listas
  for all to authenticated
  using (puede_compras_op())
  with check (puede_compras_op());

-- Los items siguen a su lista. `puede_compras_op()` ya incluye a super y admin,
-- así que reemplaza al puede_editar() que estaba suelto.
drop policy if exists items_por_lista on compras_lista_items;
create policy items_por_lista on compras_lista_items
  for all to authenticated
  using (exists (
    select 1 from compras_listas l where l.id = lista_id
      and (puede_compras_op()
        or (mi_rol()::text = 'cocina' and l.sede_id = mi_sede()))
  ))
  with check (exists (
    select 1 from compras_listas l where l.id = lista_id
      and (puede_compras_op()
        or (mi_rol()::text = 'cocina' and l.sede_id = mi_sede()))
  ));

-- Gerencia (solo mira) necesita leer los items para ver qué pidió cada sede.
-- El piso de sql/23 dio `_vertodo` a las tablas, pero los items se filtran por la
-- lista: esta policy aditiva se lo permite explícitamente, solo lectura.
drop policy if exists items_vertodo on compras_lista_items;
create policy items_vertodo on compras_lista_items
  for select to authenticated
  using (ve_todo());
