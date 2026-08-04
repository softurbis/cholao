-- =====================================================================
-- Sistema Cholao — Recetario (v35)
--
-- Cómo se prepara cada producto: ingredientes, procedimiento y rendimiento.
--
-- ⚠️ SOLO GERENCIA Y ADMINISTRACIÓN, por decisión del usuario. La cocina NO lo
-- ve: las recetas son el know-how del negocio. Si algún día se le quiere dar
-- acceso a cocina, hay que cambiar la policy de abajo A PROPÓSITO, no de rebote.
--
-- Los ingredientes y el procedimiento van como TEXTO y no como tablas
-- relacionadas: lo que existe hoy es una hoja de cálculo que se va a ir pegando
-- aquí, y una estructura rígida obligaría a normalizar 80 recetas antes de poder
-- guardar la primera. Si más adelante hace falta cruzar recetas con el catálogo
-- de productos para costear, se agrega esa capa encima sin perder lo escrito.
--
-- Ejecutar DESPUÉS de 34_horarios.sql.
-- =====================================================================

create table if not exists recetas (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  categoria     text,                    -- CHOLAOS, JUGOS, POSTRES, SALSAS…
  rendimiento   text,                    -- "1 litro", "10 porciones", "1 balde"
  ingredientes  text,                    -- una línea por ingrediente
  preparacion   text,                    -- el paso a paso
  notas         text,                    -- trucos, errores comunes, variantes
  foto_url      text,                    -- bucket arqueos, prefijo recetas/
  activo        boolean not null default true,
  orden         int,                     -- para ordenarlas a mano si hace falta
  creado_por    uuid references perfiles(id),
  created_at    timestamptz not null default now(),
  actualizado_en timestamptz
);
create unique index if not exists recetas_nombre_uniq on recetas (upper(nombre));
create index if not exists recetas_categoria on recetas (categoria);

-- Deja constancia de cuándo se tocó por última vez: una receta vieja que nadie
-- revisa desde hace un año es una receta en la que ya nadie confía.
create or replace function tocar_receta() returns trigger
  language plpgsql set search_path = public as $$
begin
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists trg_tocar_receta on recetas;
create trigger trg_tocar_receta before update on recetas
  for each row execute function tocar_receta();

-- ---------------------------------------------------------------------
-- RLS. La tabla nace después del piso de sql/23, así que necesita sus policies
-- a mano (aquel bucle ya corrió y no la alcanza).
-- ---------------------------------------------------------------------
alter table recetas enable row level security;

-- Ver: gerencia, administración y superusuario. NADIE MÁS — ni cocina, ni caja.
drop policy if exists recetas_ver on recetas;
create policy recetas_ver on recetas
  for select to authenticated using (ve_todo());

-- Escribir: administración y superusuario (gerencia solo mira, como en todo).
drop policy if exists recetas_editar on recetas;
create policy recetas_editar on recetas
  for all to authenticated using (puede_editar()) with check (puede_editar());
