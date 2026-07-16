-- =====================================================================
-- Sistema Cholao — Permisos del bucket "arqueos" (v15)
-- El bucket ya fue creado (privado). Esto permite que los usuarios
-- logueados suban y vean los PDF de arqueo del POS.
-- Ejecutar después de 14_caja_flujo.sql
-- =====================================================================

-- Subir arqueos (solo usuarios logueados)
drop policy if exists "arqueos_subir" on storage.objects;
create policy "arqueos_subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'arqueos');

-- Ver arqueos (solo usuarios logueados)
drop policy if exists "arqueos_ver" on storage.objects;
create policy "arqueos_ver" on storage.objects for select to authenticated
  using (bucket_id = 'arqueos');

-- Reemplazar/borrar (por si se sube el PDF equivocado)
drop policy if exists "arqueos_actualizar" on storage.objects;
create policy "arqueos_actualizar" on storage.objects for update to authenticated
  using (bucket_id = 'arqueos');
drop policy if exists "arqueos_borrar" on storage.objects;
create policy "arqueos_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'arqueos');
