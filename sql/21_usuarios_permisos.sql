-- =====================================================================
-- Sistema Cholao — Usuarios del personal y permisos reales (v21)
--
-- Qué arregla: hasta ahora sql/10 le daba a CUALQUIER usuario logueado
-- acceso total a todas las tablas (policy `auth_all`). Esconder módulos en
-- el menú no protege nada: con la sesión abierta, una cajera podía leer los
-- gastos de gerencia o los sueldos por la API. Aquí se cierra de verdad.
--
-- Cómo está armado (importante para no romperlo después):
--   1) TODA tabla recibe una policy `<tabla>_gerencia`: superadmin y gerente
--      pueden todo. Es el piso — ninguna tabla queda expuesta por olvido, y
--      una tabla nueva sin policy propia nace cerrada, no abierta.
--   2) Encima se agregan policies por rol operativo. Las policies permisivas
--      se suman con OR, así que cada rol ve su piso + lo suyo.
--   3) `perfiles` es la excepción: NO recibe el piso de gerencia (si no, un
--      gerente podría ascenderse a superadmin). Solo superadmin lo gestiona.
--
-- Ejecutar DESPUÉS de 19_traslados.sql y 20_validacion.sql.
-- ⚠️ Este archivo REEMPLAZA la seguridad de sql/10. No volver a correr el 10.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Helpers
-- SECURITY DEFINER es obligatorio, no una optimización: estas funciones leen
-- `perfiles`, y `perfiles` tiene RLS que a su vez las llama. Sin definer se
-- entra en recursión infinita y TODA consulta falla. Con definer se saltan el
-- RLS y cortan el ciclo. `search_path` fijo para que no se puedan secuestrar.
-- ---------------------------------------------------------------------

-- Rol del usuario actual. NULL si no tiene perfil o está inactivo.
-- Ese NULL es la pieza clave del fail-closed: `null in (...)` es null, que en
-- una policy cuenta como false. Usuario sin perfil = no ve nada.
create or replace function mi_rol() returns rol_cholao
  language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

create or replace function mi_sede() returns uuid
  language sql stable security definer set search_path = public as $$
  select sede_id from perfiles where id = auth.uid() and activo
$$;

create or replace function es_super() returns boolean
  language sql stable set search_path = public as $$
  select coalesce(mi_rol() = 'superadmin', false)
$$;

create or replace function es_gerencia() returns boolean
  language sql stable set search_path = public as $$
  select coalesce(mi_rol() in ('superadmin', 'gerente'), false)
$$;

-- Logueado, con perfil y activo. Sirve para los catálogos que todos leen.
create or replace function es_personal() returns boolean
  language sql stable set search_path = public as $$
  select mi_rol() is not null
$$;

-- ¿Trabajo en esa sede? Gerencia ve todas.
create or replace function es_mi_sede(s uuid) returns boolean
  language sql stable set search_path = public as $$
  select es_gerencia() or (s is not null and s = mi_sede())
$$;

-- ¿El turno es de mi sede? Los hijos de caja (gastos, stock, adjuntos…) no
-- tienen sede_id propio: cuelgan del turno.
create or replace function turno_de_mi_sede(t uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from caja_turno ct
    where ct.id = t and (es_gerencia() or ct.sede_id = mi_sede())
  )
$$;

-- ---------------------------------------------------------------------
-- 2) perfiles.usuario — el nombre con el que entra la gente
-- El personal de tienda no tiene correo. Entran con "marcelo"; por dentro se
-- guarda como marcelo@cholao.local para satisfacer a Supabase Auth, pero ese
-- correo no existe ni se usa nunca. Aquí queda el nombre limpio para mostrar.
-- ---------------------------------------------------------------------
alter table perfiles add column if not exists usuario text;
create unique index if not exists perfiles_usuario_uniq on perfiles (lower(usuario))
  where usuario is not null;

comment on column perfiles.usuario is 'Nombre de login sin el @cholao.local (ej: marcelo)';

-- ---------------------------------------------------------------------
-- 3) vista_personal — nombres SIN sueldos
-- RLS filtra filas, no columnas, y todos los usuarios de la app comparten el
-- mismo rol de Postgres (`authenticated`), así que no se puede revocar
-- `sueldo_base` solo a las cajeras. Pero Registrar Caja necesita los nombres
-- para los adelantos. Solución: la tabla `personas` queda para gerencia y el
-- resto lee esta vista, que sencillamente no trae el sueldo.
-- security_invoker = false (definer) a propósito: la vista NO hereda el RLS de
-- `personas`; su única defensa es no exponer la columna.
-- ---------------------------------------------------------------------
create or replace view vista_personal as
select id, nombres, apellidos, cargo, sede_id, activo
from personas;

alter view vista_personal set (security_invoker = false);
revoke all on vista_personal from anon;
grant select on vista_personal to authenticated;

-- ---------------------------------------------------------------------
-- 4) Piso: fuera `auth_all`, entra el default cerrado
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    -- La barra libre de sql/10
    execute format('drop policy if exists auth_all on public.%I', t);
    execute format('drop policy if exists %I on public.%I', t || '_gerencia', t);
    -- perfiles se maneja aparte (ver punto 5)
    if t <> 'perfiles' then
      execute format(
        'create policy %I on public.%I for all to authenticated using (es_gerencia()) with check (es_gerencia())',
        t || '_gerencia', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5) perfiles — solo superadmin gestiona; cada quien se lee a sí mismo
-- El select propio NO es un detalle: si un usuario no puede leer su propia
-- fila, la app lo trata como "sin perfil" y no sabe ni qué rol tiene.
-- ---------------------------------------------------------------------
drop policy if exists perfiles_propio on perfiles;
create policy perfiles_propio on perfiles
  for select to authenticated using (id = auth.uid());

drop policy if exists perfiles_super on perfiles;
create policy perfiles_super on perfiles
  for all to authenticated using (es_super()) with check (es_super());

-- Gerencia puede mirar la lista (para saber quién tiene acceso), sin tocarla.
drop policy if exists perfiles_lectura_gerencia on perfiles;
create policy perfiles_lectura_gerencia on perfiles
  for select to authenticated using (es_gerencia());

-- ---------------------------------------------------------------------
-- 6) Catálogos — los lee todo el personal, los edita gerencia
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sedes', 'proveedores', 'productos_stock', 'caja_metas', 'activos']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_lectura', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (es_personal())',
      t || '_lectura', t);
  end loop;
end $$;

-- tipos_gasto: además de leerlo, quien registra caja necesita CREAR el tipo al
-- vuelo (Registrar Caja da de alta el gasto que no existía todavía).
drop policy if exists tipos_gasto_lectura on tipos_gasto;
create policy tipos_gasto_lectura on tipos_gasto
  for select to authenticated using (es_personal());

drop policy if exists tipos_gasto_alta on tipos_gasto;
create policy tipos_gasto_alta on tipos_gasto
  for insert to authenticated with check (es_personal());

-- El contador `veces` (ordena la búsqueda rápida) lo sube quien usa el gasto.
drop policy if exists tipos_gasto_uso on tipos_gasto;
create policy tipos_gasto_uso on tipos_gasto
  for update to authenticated using (es_personal()) with check (es_personal());

-- ---------------------------------------------------------------------
-- 7) Caja — encargado y cajera trabajan SU sede
-- ---------------------------------------------------------------------
-- Ver / abrir / cerrar su turno, sí. Borrarlo, no: un turno cerrado es la
-- evidencia que después audita gerencia. Borrar queda SOLO para gerencia (por
-- el piso del punto 4), igual que los archivos del bucket — si el encargado
-- pudiera borrar el turno pero no sus archivos, quedarían huérfanos en storage.
-- Si abren un turno equivocado, se corrige reabriéndolo: el insert es un upsert
-- sobre (sede, fecha, turno), no duplica.
drop policy if exists caja_turno_sede on caja_turno;
create policy caja_turno_sede on caja_turno
  for select to authenticated
  using (mi_rol() in ('encargado', 'cajera') and sede_id = mi_sede());

drop policy if exists caja_turno_abrir on caja_turno;
create policy caja_turno_abrir on caja_turno
  for insert to authenticated
  with check (mi_rol() in ('encargado', 'cajera') and sede_id = mi_sede());

drop policy if exists caja_turno_operar on caja_turno;
create policy caja_turno_operar on caja_turno
  for update to authenticated
  using (mi_rol() in ('encargado', 'cajera') and sede_id = mi_sede())
  with check (mi_rol() in ('encargado', 'cajera') and sede_id = mi_sede());

-- (sin policy de delete: la hereda del piso, o sea solo gerencia)

-- Los hijos cuelgan del turno: no tienen sede propia, se filtran por él.
do $$
declare t text;
begin
  foreach t in array array['caja_gastos', 'caja_descuentos', 'caja_stock']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_sede', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (mi_rol() in (''encargado'',''cajera'') and turno_de_mi_sede(turno_id)) '
      'with check (mi_rol() in (''encargado'',''cajera'') and turno_de_mi_sede(turno_id))',
      t || '_sede', t);
  end loop;
end $$;

-- caja_adjuntos es la excepción: son los comprobantes del cierre (arqueo PDF,
-- productos vendidos, foto del voucher). Se suben y se leen, pero NO se borran
-- desde la sede — si se pudieran borrar, la validación de gerencia no valdría
-- nada. Si suben el archivo equivocado, lo reemplazan (el upload usa upsert).
drop policy if exists caja_adjuntos_sede on caja_adjuntos;
create policy caja_adjuntos_sede on caja_adjuntos
  for select to authenticated
  using (mi_rol() in ('encargado', 'cajera') and turno_de_mi_sede(turno_id));

drop policy if exists caja_adjuntos_subir on caja_adjuntos;
create policy caja_adjuntos_subir on caja_adjuntos
  for insert to authenticated
  with check (mi_rol() in ('encargado', 'cajera') and turno_de_mi_sede(turno_id));

-- caja_stock_mov es el caso raro: un traslado que me MANDA la otra sede vive en
-- un turno que no es mío. Si solo filtrara por turno, Miraflores nunca vería lo
-- que Amazonas le envió y no podría aceptarlo. Por eso el OR con sede_destino.
drop policy if exists caja_stock_mov_sede on caja_stock_mov;
create policy caja_stock_mov_sede on caja_stock_mov
  for all to authenticated
  using (
    mi_rol() in ('encargado', 'cajera')
    and (turno_de_mi_sede(turno_id) or sede_destino_id = mi_sede())
  )
  with check (
    mi_rol() in ('encargado', 'cajera')
    and (turno_de_mi_sede(turno_id) or sede_destino_id = mi_sede())
  );

-- ---------------------------------------------------------------------
-- 8) Compras — Juan (rol `compras`) manda; almacén y encargado miran
-- ---------------------------------------------------------------------
drop policy if exists compras_juan on compras;
create policy compras_juan on compras
  for all to authenticated
  using (mi_rol() = 'compras') with check (mi_rol() = 'compras');

drop policy if exists compras_lectura on compras;
create policy compras_lectura on compras
  for select to authenticated using (mi_rol() in ('almacen', 'encargado'));

drop policy if exists proveedores_juan on proveedores;
create policy proveedores_juan on proveedores
  for all to authenticated
  using (mi_rol() = 'compras') with check (mi_rol() = 'compras');

-- Entregas: Juan y almacén las registran; la sede ve lo que le llegó.
drop policy if exists entregas_operan on entregas;
create policy entregas_operan on entregas
  for all to authenticated
  using (mi_rol() in ('compras', 'almacen')) with check (mi_rol() in ('compras', 'almacen'));

drop policy if exists entregas_mi_sede on entregas;
create policy entregas_mi_sede on entregas
  for select to authenticated
  using (mi_rol() in ('encargado', 'cajera') and sede_id = mi_sede());

-- ---------------------------------------------------------------------
-- 9) Lo que NO se toca: `gastos`, `fondo_compras_dia`, `ventas`,
-- `obligaciones`, `prestamos`, `planilla_*`, `personas`, `config`…
-- No aparecen aquí a propósito: se quedan con el piso del punto 4, o sea
-- SOLO superadmin y gerente. Si mañana el encargado necesita ver la venta de
-- su sede, se agrega su policy acá y se documenta por qué.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 10) Vistas: que respeten el RLS de quien consulta.
-- vista_personal queda fuera: es definer a propósito (ver punto 3).
-- ---------------------------------------------------------------------
do $$
declare v text;
begin
  for v in select viewname from pg_views where schemaname = 'public' and viewname <> 'vista_personal'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 11) Storage: el bucket `arqueos` guarda los comprobantes del cierre
-- sql/15 lo abrió a cualquier `authenticated`. Mismo agujero que las tablas:
-- un usuario logueado sin perfil podía leer y BORRAR los comprobantes de todos.
-- Ahora hay que ser personal activo. Borrar queda solo para gerencia: un
-- comprobante borrado no se recupera, y es justo la evidencia que se audita.
-- ---------------------------------------------------------------------
drop policy if exists "arqueos_subir" on storage.objects;
create policy "arqueos_subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'arqueos' and public.es_personal());

drop policy if exists "arqueos_ver" on storage.objects;
create policy "arqueos_ver" on storage.objects for select to authenticated
  using (bucket_id = 'arqueos' and public.es_personal());

drop policy if exists "arqueos_actualizar" on storage.objects;
create policy "arqueos_actualizar" on storage.objects for update to authenticated
  using (bucket_id = 'arqueos' and public.es_personal());

drop policy if exists "arqueos_borrar" on storage.objects;
create policy "arqueos_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'arqueos' and public.es_gerencia());

-- ---------------------------------------------------------------------
-- 12) El superadmin de siempre queda ligado a su usuario
-- ---------------------------------------------------------------------
update perfiles set usuario = 'cesar'
where id = 'f52680e3-e75a-45c9-9d95-bfdb108cbb5f' and usuario is null;
