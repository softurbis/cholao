-- =====================================================================
-- Sistema Cholao — Gastos unificado + detalles de producto (v25)
--
-- Dos cambios:
--   1. Un solo módulo de Gastos. Fernanda INGRESA y ve SOLO lo suyo; Víctor
--      (gerente), Cesar (super) y admin ven TODO. Antes la policy pagos_fernanda
--      la dejaba ver TODO pagos_tienda; ahora solo lo que ella registró.
--   2. El catálogo de productos gana FOTO y UBICACIÓN (para el almacén/kardex).
--
-- Ejecutar DESPUÉS de 24_compras_almacen.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) pagos_tienda: Fernanda ingresa y ve solo lo suyo
-- El piso de sql/23 ya da: super/admin CRUD (pagos_tienda_editar) y gerente
-- lectura (pagos_tienda_vertodo). O sea Víctor/Cesar/admin ya ven todo. Solo
-- falta acotar a Fernanda: que inserte, y que lea únicamente sus registros.
-- ---------------------------------------------------------------------
drop policy if exists pagos_fernanda on pagos_tienda;   -- era "for all" (veía todo)

drop policy if exists pagos_insert on pagos_tienda;
create policy pagos_insert on pagos_tienda
  for insert to authenticated with check (puede_gastos_tienda());

-- Ve lo que ELLA registró (para revisar y corregir). registrado_por = su id.
drop policy if exists pagos_propio on pagos_tienda;
create policy pagos_propio on pagos_tienda
  for select to authenticated using (registrado_por = auth.uid());

-- Y puede corregir/borrar lo suyo mientras nadie lo haya validado todavía.
drop policy if exists pagos_edita_propio on pagos_tienda;
create policy pagos_edita_propio on pagos_tienda
  for update to authenticated
  using (registrado_por = auth.uid()) with check (registrado_por = auth.uid());
drop policy if exists pagos_borra_propio on pagos_tienda;
create policy pagos_borra_propio on pagos_tienda
  for delete to authenticated using (registrado_por = auth.uid());

-- ---------------------------------------------------------------------
-- 2) Detalles del producto: foto y ubicación en el almacén
-- ubicacion = dónde está guardado (estante/zona), para encontrarlo rápido.
-- ---------------------------------------------------------------------
alter table productos add column if not exists foto_url  text;   -- bucket arqueos, prefijo productos/
alter table productos add column if not exists ubicacion text;   -- p.ej. "Estante A2", "Cámara fría"
