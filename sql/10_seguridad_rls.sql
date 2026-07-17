-- =====================================================================
-- ⛔ HISTÓRICO — NO VOLVER A CORRER. Lo reemplaza 21_usuarios_permisos.sql.
-- Este archivo le da a CUALQUIER usuario logueado acceso total a todo
-- (policy `auth_all`). Servía cuando el único usuario era el superadmin.
-- Desde que entra el personal, correrlo otra vez borraría los permisos por
-- rol del sql/21 y dejaría a las cajeras viendo gastos, ventas y sueldos.
-- Se conserva solo como referencia de por qué el sql/21 hace lo que hace.
-- =====================================================================

-- =====================================================================
-- Sistema Cholao — Seguridad RLS (v10)  ⚠️ CRÍTICO antes de compartir el link
-- Cierra la base: solo usuarios LOGUEADOS (authenticated) ven/editan datos.
-- Sin login, la llave publishable no devuelve nada.
-- Los scripts de carga usan la secret key (service_role) y siguen funcionando
-- (service_role ignora RLS). Ejecutar en el SQL Editor.
-- =====================================================================

-- 1) RLS + política "solo autenticados" en TODAS las tablas public
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists auth_all on public.%I', t);
    execute format('create policy auth_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- 2) Vistas con security_invoker para que también respeten el RLS
do $$
declare v text;
begin
  for v in select viewname from pg_views where schemaname = 'public'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v);
  end loop;
end $$;
