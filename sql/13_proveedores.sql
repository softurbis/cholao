-- =====================================================================
-- Sistema Cholao — Catálogo de proveedores (v13)
-- Para que al editar compras se elija de una lista (no texto libre) y se
-- puedan crear nuevos. Los productos usan el catálogo compras_productos.
-- Ejecutar después de 12_stock_config.sql
-- =====================================================================

create table if not exists proveedores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Semilla desde los proveedores que ya aparecen en las compras cargadas
insert into proveedores (nombre)
select distinct trim(proveedor) from compras
where proveedor is not null and trim(proveedor) <> '' and trim(proveedor) <> '-'
on conflict (nombre) do nothing;

-- RLS
alter table proveedores enable row level security;
drop policy if exists auth_all on proveedores;
create policy auth_all on proveedores for all to authenticated using (true) with check (true);
