-- =====================================================================
-- Sistema Cholao — Adjuntos del turno + Inventario de activos (v16)
--  1) caja_adjuntos: varios archivos por turno (2 PDF, voucher foto, facturas)
--  2) activos + inventario_activos: conteo de cosas de tienda (mesas, sillas,
--     tenedores, maceteros, cremeros...) configurable desde el panel
-- Ejecutar después de 15_storage_arqueos.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Adjuntos del turno (reemplaza el voucher_url único)
-- ---------------------------------------------------------------------
create table if not exists caja_adjuntos (
  id          uuid primary key default gen_random_uuid(),
  turno_id    uuid references caja_turno(id) on delete cascade,
  gasto_id    uuid references caja_gastos(id) on delete cascade,  -- si es factura de un gasto
  tipo        text not null,          -- arqueo | ventas | voucher | factura | otro
  archivo     text not null,          -- ruta en el bucket "arqueos"
  nombre      text,                   -- nombre original
  mime        text,
  subido_por  uuid references perfiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists caja_adjuntos_turno on caja_adjuntos (turno_id);

-- ---------------------------------------------------------------------
-- 2) Activos de tienda (mesas, sillas, tenedores, maceteros, cremeros...)
-- ---------------------------------------------------------------------
create table if not exists activos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  categoria  text,                    -- MOBILIARIO | UTENSILIOS | DECORACION | OTROS
  sede_id    uuid references sedes(id),   -- null = todas
  esperado   numeric(10,2) default 0, -- cuántos debería haber
  activo     boolean not null default true,
  orden      int default 0,
  created_at timestamptz not null default now()
);

-- Conteo de activos (el cuadre de inventario de tienda)
create table if not exists inventario_activos (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null,
  sede_id     uuid references sedes(id),
  activo_id   uuid references activos(id),
  esperado    numeric(10,2),
  contado     numeric(10,2),
  diferencia  numeric(10,2) generated always as (coalesce(contado,0) - coalesce(esperado,0)) stored,
  nota        text,
  contado_por uuid references perfiles(id),
  created_at  timestamptz not null default now(),
  unique (fecha, sede_id, activo_id)
);
create index if not exists inv_activos_fecha on inventario_activos (fecha, sede_id);

-- RLS
do $$ declare t text;
begin
  for t in select unnest(array['caja_adjuntos','activos','inventario_activos'])
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists auth_all on public.%I', t);
    execute format('create policy auth_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Semilla de activos típicos de tienda (editables/ampliables en el panel)
insert into activos (nombre, categoria, orden, esperado) values
  ('Mesas', 'MOBILIARIO', 1, 0), ('Sillas', 'MOBILIARIO', 2, 0), ('Sillas altas', 'MOBILIARIO', 3, 0),
  ('Tenedores', 'UTENSILIOS', 4, 0), ('Cucharas', 'UTENSILIOS', 5, 0), ('Cuchillos', 'UTENSILIOS', 6, 0),
  ('Cremeros', 'UTENSILIOS', 7, 0), ('Azucareros', 'UTENSILIOS', 8, 0), ('Bandejas', 'UTENSILIOS', 9, 0),
  ('Maceteros', 'DECORACION', 10, 0), ('Cuadros', 'DECORACION', 11, 0)
on conflict do nothing;

-- Migrar el voucher_url que ya existiera a la tabla de adjuntos
insert into caja_adjuntos (turno_id, tipo, archivo, nombre)
select id, 'arqueo', voucher_url, 'arqueo.pdf' from caja_turno
where voucher_url is not null
on conflict do nothing;
