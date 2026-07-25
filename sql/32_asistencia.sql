-- =====================================================================
-- Sistema Cholao — Asistencia con selfie y georreferencia (v32)
--
-- Cómo se decidió que funcione (elección del usuario, NO cambiar sin preguntar):
--   · La persona marca ENTRADA y SALIDA, siempre con selfie.
--   · La ubicación se VALIDA contra la sede: fuera del radio, no marca.
--   · Sin cámara o sin GPS, no marca. Es estricto a propósito.
--   · VÁLVULA DE ESCAPE: super/admin pueden registrar una marca a mano, con
--     motivo obligatorio, y queda señalada como registrada por otro. Sin esto,
--     un celular viejo o un local sin señal deja a alguien sin poder marcar y
--     el negocio se traba.
--
-- OJO CON EL ALCANCE REAL DEL CONTROL: la ubicación la reporta el navegador del
-- celular, y un teléfono se puede configurar para mentir. La distancia se calcula
-- en la BASE (trigger), no en el navegador, así que nadie puede falsear el número
-- de metros; pero sí podría falsear las coordenadas. Lo que de verdad disuade es
-- la selfie con hora — no confiar en el GPS como prueba absoluta.
--
-- Ejecutar DESPUÉS de 31_conteo_almacen.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Dónde queda cada sede y cuánta tolerancia se le da.
-- ---------------------------------------------------------------------
alter table sedes add column if not exists lat     numeric(10,7);
alter table sedes add column if not exists lng     numeric(10,7);
alter table sedes add column if not exists radio_m integer not null default 120;
comment on column sedes.radio_m is 'Metros de tolerancia para aceptar una marca de asistencia';

-- ---------------------------------------------------------------------
-- 2) Las marcas.
-- ---------------------------------------------------------------------
create table if not exists asistencia_marcas (
  id            uuid primary key default gen_random_uuid(),
  perfil_id     uuid not null references perfiles(id),
  sede_id       uuid references sedes(id),
  tipo          text not null check (tipo in ('entrada', 'salida')),
  fecha         date not null default current_date,
  marcada_en    timestamptz not null default now(),
  lat           numeric(10,7),
  lng           numeric(10,7),
  precision_m   numeric(8,1),          -- cuán exacta dice ser la lectura del GPS
  distancia_m   numeric(10,1),         -- a la sede; la calcula el trigger, NO el navegador
  selfie_url    text,                  -- bucket arqueos, prefijo asistencia/
  -- Válvula de escape: cuando la registra otro por un problema del celular
  manual        boolean not null default false,
  motivo_manual text,
  registrada_por uuid references perfiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists asist_persona_fecha on asistencia_marcas (perfil_id, fecha);
create index if not exists asist_fecha on asistencia_marcas (fecha);
-- Una entrada y una salida por persona y día: marcar dos veces por error no duplica.
create unique index if not exists asist_unica on asistencia_marcas (perfil_id, fecha, tipo);

-- ---------------------------------------------------------------------
-- 3) La distancia se calcula EN LA BASE, no en el navegador.
-- Haversine a mano (no hace falta PostGIS para dos puntos).
-- ---------------------------------------------------------------------
create or replace function calc_distancia_marca() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  s_lat numeric; s_lng numeric;
  r constant numeric := 6371000;   -- radio de la Tierra en metros
  a numeric;
begin
  if new.lat is null or new.lng is null or new.sede_id is null then
    new.distancia_m := null; return new;
  end if;
  select lat, lng into s_lat, s_lng from sedes where id = new.sede_id;
  if s_lat is null or s_lng is null then
    new.distancia_m := null; return new;   -- la sede aún no tiene coordenadas
  end if;
  a := sin(radians(new.lat - s_lat) / 2) ^ 2
     + cos(radians(s_lat)) * cos(radians(new.lat)) * sin(radians(new.lng - s_lng) / 2) ^ 2;
  new.distancia_m := round((2 * r * asin(least(1, sqrt(a))))::numeric, 1);
  return new;
end $$;

drop trigger if exists trg_distancia_marca on asistencia_marcas;
create trigger trg_distancia_marca before insert or update of lat, lng, sede_id
  on asistencia_marcas for each row execute function calc_distancia_marca();

-- ---------------------------------------------------------------------
-- 4) RLS: cada quien marca lo SUYO; gerencia mira todo; super/admin corrigen.
-- ---------------------------------------------------------------------
alter table asistencia_marcas enable row level security;

-- Marcar: solo por uno mismo, y nunca marcándose como "manual" (esa es la
-- válvula de escape de administración, no un permiso del personal).
drop policy if exists asist_propia on asistencia_marcas;
create policy asist_propia on asistencia_marcas
  for insert to authenticated
  with check (perfil_id = auth.uid() and manual = false);

-- Ver: lo suyo cada quien.
drop policy if exists asist_ver_propia on asistencia_marcas;
create policy asist_ver_propia on asistencia_marcas
  for select to authenticated using (perfil_id = auth.uid());

-- Gerencia y administración ven todas (es control de personal).
drop policy if exists asist_ver_todo on asistencia_marcas;
create policy asist_ver_todo on asistencia_marcas
  for select to authenticated using (ve_todo());

-- Super y admin: corrigen y usan la válvula de escape (registrar a mano).
drop policy if exists asist_admin on asistencia_marcas;
create policy asist_admin on asistencia_marcas
  for all to authenticated using (puede_editar()) with check (puede_editar());

-- ---------------------------------------------------------------------
-- 5) Vista del día: quién marcó, a qué hora, a qué distancia y si algo raro.
-- ---------------------------------------------------------------------
create or replace view vista_asistencia_dia as
select
  m.id, m.fecha, m.tipo, m.marcada_en, m.perfil_id,
  p.nombre as persona, p.rol::text as rol,
  s.nombre as sede, m.distancia_m, s.radio_m,
  (m.distancia_m is not null and m.distancia_m > s.radio_m) as fuera_de_rango,
  m.manual, m.motivo_manual, m.selfie_url, m.precision_m
from asistencia_marcas m
join perfiles p on p.id = m.perfil_id
left join sedes s on s.id = m.sede_id
order by m.fecha desc, m.marcada_en desc;
alter view vista_asistencia_dia set (security_invoker = true);
