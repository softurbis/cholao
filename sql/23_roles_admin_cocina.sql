-- =====================================================================
-- Sistema Cholao — Administrador, Cocina y el permiso de gastos (v23)
--
-- Reparte el acceso como opera de verdad el negocio:
--   Superusuario  → todo, incluida la configuración y crear usuarios
--   Administrador → ve todo, EDITA y valida cajas, registra gastos. Sin config.
--   Gerencia      → ve todo (solo mira) y sube SUS propios gastos
--   Cajero        → su caja
--   Compras (Juan)→ compras y sus gastos del día
--   Cocina        → solo su sede, para armar su lista
--   + Fernanda: es cajera, pero con un permiso extra registra los gastos de
--     tienda y adelantos de todos (perfiles.puede_gastos).
--
-- Cambia el "piso" de sql/21: allí super+gerente tenían CRUD total. Ahora el
-- CRUD total es super+ADMIN, y gerente pasa a SOLO LECTURA (ve todo, no toca).
--
-- Ejecutar DESPUÉS de 22_turnos_horarios.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Roles nuevos en el enum
-- `add value if not exists` no puede USARSE (asignarse a una fila) en la misma
-- transacción en que se agrega. Por eso aquí NO se asigna ningún rol nuevo a
-- nadie: eso se hace después desde la pantalla Personas. Y todas las
-- comparaciones de rol usan ::text, para no depender del literal del enum.
-- ---------------------------------------------------------------------
alter type rol_cholao add value if not exists 'admin';
alter type rol_cholao add value if not exists 'cocina';

-- ---------------------------------------------------------------------
-- 2) El permiso extra de Fernanda + el voucher de los gastos
-- ---------------------------------------------------------------------
alter table perfiles add column if not exists puede_gastos boolean not null default false;
comment on column perfiles.puede_gastos is 'true = aunque sea cajera, puede registrar gastos de tienda y adelantos de todos (caso Fernanda)';

alter table gastos add column if not exists voucher_url text;   -- foto del comprobante (bucket arqueos, prefijo gastos/)
alter table gastos add column if not exists creado_en timestamptz default now();

-- El panel INDEPENDIENTE de Fernanda. Es un registro aparte del ledger de gastos
-- y de la caja —por eso su propia tabla—: aquí van, cada uno con su voucher por
-- Yape, los gastos de tienda (agua, luz, alquiler) y los adelantos, descuentos y
-- bonos de cada persona. De aquí sale su consolidado en PDF.
-- Se crea ACÁ arriba a propósito: así el "piso" de permisos del punto 4 (que
-- recorre todas las tablas) también le pone las policies de super/admin/gerente.
create table if not exists pagos_tienda (
  id             uuid primary key default gen_random_uuid(),
  fecha          date not null default current_date,
  tipo           text not null check (tipo in ('gasto', 'adelanto', 'descuento', 'bono')),
  persona_id     uuid references personas(id),   -- adelanto/descuento/bono van a una persona; el gasto no
  concepto       text,                            -- para el gasto (agua, luz…) o el detalle
  monto          numeric(12,2) not null,
  medio_pago     text default 'yape',
  voucher_url    text,
  nota           text,
  sede_id        uuid references sedes(id),
  registrado_por uuid references perfiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists pagos_tienda_fecha on pagos_tienda (fecha);
comment on table pagos_tienda is 'Panel independiente de Fernanda: gastos de tienda + adelantos/descuentos/bonos por persona, con voucher.';

-- ---------------------------------------------------------------------
-- 3) Helpers de permiso (SECURITY DEFINER: leen perfiles, que tiene RLS que los
-- llama → sin definer se cae en recursión, igual que en sql/21).
-- ---------------------------------------------------------------------

-- Puede EDITAR y validar: superusuario y administrador.
create or replace function puede_editar() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfiles
    where id = auth.uid() and activo and rol::text in ('superadmin', 'admin')
  )
$$;

-- VE TODO lo financiero: los de arriba + gerencia (que solo mira).
create or replace function ve_todo() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfiles
    where id = auth.uid() and activo and rol::text in ('superadmin', 'admin', 'gerente')
  )
$$;

-- Puede registrar GASTOS de tienda y adelantos: los que ven todo + quien tenga
-- el permiso especial (Fernanda), aunque su rol sea cajera.
create or replace function puede_gastos_tienda() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from perfiles
    where id = auth.uid() and activo
      and (rol::text in ('superadmin', 'admin', 'gerente') or puede_gastos)
  )
$$;

-- ---------------------------------------------------------------------
-- 4) Rehacer el piso: super+admin CRUD total; gerente solo lectura
-- Reemplaza el <tabla>_gerencia de sql/21 (que daba CRUD a super+gerente).
-- perfiles NO entra: se maneja aparte (punto 6).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    if t = 'perfiles' then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    -- fuera el piso viejo de sql/21
    execute format('drop policy if exists %I on public.%I', t || '_gerencia', t);
    -- super + admin: todo
    execute format('drop policy if exists %I on public.%I', t || '_editar', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (puede_editar()) with check (puede_editar())',
      t || '_editar', t);
    -- gerente: solo lectura
    execute format('drop policy if exists %I on public.%I', t || '_vertodo', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (ve_todo())',
      t || '_vertodo', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5) Ledger de gastos (Víctor/gerencia registran los suyos). Leer = ve_todo (piso).
-- Editar/borrar sigue siendo super+admin.
-- ---------------------------------------------------------------------
drop policy if exists gastos_registrar on gastos;
create policy gastos_registrar on gastos
  for insert to authenticated with check (ve_todo());

-- El panel de Fernanda (pagos_tienda): además del piso super/admin/gerente, ella
-- (con el permiso especial) registra y ve lo suyo. Es su registro aparte.
drop policy if exists pagos_fernanda on pagos_tienda;
create policy pagos_fernanda on pagos_tienda
  for all to authenticated
  using (puede_gastos_tienda()) with check (puede_gastos_tienda());

-- Limpieza: una versión anterior de este archivo creó una policy en caja_descuentos
-- para que Fernanda escribiera adelantos ahí. Ahora sus adelantos van a pagos_tienda,
-- así que esa policy sobra. Si no existe, este drop no hace nada.
drop policy if exists caja_descuentos_fernanda on caja_descuentos;

-- ---------------------------------------------------------------------
-- 6) perfiles: la lectura de la lista ahora es para todos los que ven todo
-- (antes solo gerencia). Gestionar sigue siendo solo superusuario.
-- ---------------------------------------------------------------------
drop policy if exists perfiles_lectura_gerencia on perfiles;
drop policy if exists perfiles_lectura on perfiles;
create policy perfiles_lectura on perfiles
  for select to authenticated using (ve_todo());

-- ---------------------------------------------------------------------
-- 7) Cocina: arma la lista de SU sede. Compras (Juan) y los que editan la ven
-- toda para consolidar.
-- ---------------------------------------------------------------------
alter table compras_listas enable row level security;
alter table compras_lista_items enable row level security;

drop policy if exists listas_cocina on compras_listas;
create policy listas_cocina on compras_listas
  for all to authenticated
  using (mi_rol()::text = 'cocina' and sede_id = mi_sede())
  with check (mi_rol()::text = 'cocina' and sede_id = mi_sede());

-- Juan (compras) y almacén ven/gestionan todas las listas para consolidarlas.
drop policy if exists listas_compras on compras_listas;
create policy listas_compras on compras_listas
  for all to authenticated
  using (mi_rol()::text in ('compras', 'almacen'))
  with check (mi_rol()::text in ('compras', 'almacen'));

-- Los items siguen a su lista.
drop policy if exists items_por_lista on compras_lista_items;
create policy items_por_lista on compras_lista_items
  for all to authenticated
  using (exists (
    select 1 from compras_listas l where l.id = lista_id
      and (puede_editar()
        or (mi_rol()::text = 'cocina' and l.sede_id = mi_sede())
        or mi_rol()::text in ('compras', 'almacen'))
  ))
  with check (exists (
    select 1 from compras_listas l where l.id = lista_id
      and (puede_editar()
        or (mi_rol()::text = 'cocina' and l.sede_id = mi_sede())
        or mi_rol()::text in ('compras', 'almacen'))
  ));

-- ---------------------------------------------------------------------
-- 8) Storage: borrar vouchers pasa de gerencia a super+admin (gerente solo mira)
-- ---------------------------------------------------------------------
drop policy if exists "arqueos_borrar" on storage.objects;
create policy "arqueos_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'arqueos' and public.puede_editar());
