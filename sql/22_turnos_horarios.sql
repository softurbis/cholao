-- =====================================================================
-- Sistema Cholao — Turnos y horario por sede (v22)
--
-- Qué resuelve: hasta ahora "los turnos" eran mañana y tarde para todos,
-- cableado en la app. Pero cada sede opera distinto: Amazonas trabaja 2 turnos
-- (218 días con dos, en los datos) y Miraflores 1 solo (204 días con uno).
-- Peor: `caja_turno.turno` es TEXT LIBRE sin constraint, y por ahí entró basura
-- real — el importador volcaba el nombre de la pestaña del Excel ('y', 'n', 't'…)
-- directo a la columna, y nadie se enteró.
--
-- Qué NO hace este archivo: no toca `caja_turno.turno`. Esa columna se queda
-- como está (etiqueta cruda = evidencia de qué Excel vino) y se agrega
-- `turno_id` al lado. Poner un FK sobre `turno` obligaría a inventarse un turno
-- para cada basura o a borrar historia real: son 341 filas CON venta, cajero,
-- gastos y adelantos colgando.
--
-- Ejecutar DESPUÉS de 21_usuarios_permisos.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) sede_turnos — cuántos turnos tiene cada sede y cómo se llaman
-- Esto es lo que hoy no existe en ningún lado: `sedes` no tiene dónde decir
-- "yo trabajo un solo turno". Por eso la app arranca siempre en 'manana', que
-- para Miraflores es directamente el turno equivocado.
-- ---------------------------------------------------------------------
create table if not exists sede_turnos (
  id          uuid primary key default gen_random_uuid(),
  sede_id     uuid not null references sedes(id) on delete cascade,
  codigo      text not null,                      -- manana | tarde | unico | noche…
  nombre      text not null,                      -- lo que ve la gente: "Mañana", "Único"
  orden       int  not null default 1,            -- 1 = el primero del día
  hora_inicio time,
  hora_fin    time,
  -- Un turno que ya no se usa NO se borra: sostiene el histórico. Miraflores
  -- tiene 153 turnos de mañana y 25 de tarde que deben seguir leyéndose aunque
  -- hoy opere distinto. `activo=false` = existió, pero ya no se puede elegir.
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (sede_id, codigo)
);

comment on table sede_turnos is 'Los turnos que opera cada sede. activo=false = histórico, no se puede elegir hoy.';
comment on column sede_turnos.codigo is 'Debe coincidir con caja_turno.turno para que el backfill los case';

-- ---------------------------------------------------------------------
-- 2) sede_horario — la apertura y el cierre de cada día
-- El dueño lo pidió así: "apertura y cierre x día como un horario de tienda
-- para tener referencia de las operaciones".
--
-- `cerrado` es el campo que más va a servir, aunque no lo parezca: hoy un día
-- sin caja es ambiguo — nadie sabe si la tienda no abrió o si simplemente no lo
-- cargaron. Hay ~100 días así solo en Miraflores. Con esto, "no abrimos" se
-- declara y deja de contarse como dato perdido.
-- ---------------------------------------------------------------------
create table if not exists sede_horario (
  id         uuid primary key default gen_random_uuid(),
  sede_id    uuid not null references sedes(id) on delete cascade,
  dia_semana int  not null check (dia_semana between 0 and 6),   -- 0 = domingo
  turno_id   uuid references sede_turnos(id) on delete cascade,
  abre       time,
  cierra     time,
  cerrado    boolean not null default false,
  unique (sede_id, dia_semana, turno_id)
);

comment on column sede_horario.dia_semana is '0=domingo … 6=sábado (igual que extract(dow))';
comment on column sede_horario.cerrado is 'La tienda NO abre ese día. Distingue "cerramos" de "no lo registraron".';

-- ---------------------------------------------------------------------
-- 3) sede_horario_excepcion — el feriado, el día que se cerró por lluvia
-- Sin esto, cada 28 de julio parecería un día de datos perdidos.
-- ---------------------------------------------------------------------
create table if not exists sede_horario_excepcion (
  id       uuid primary key default gen_random_uuid(),
  sede_id  uuid not null references sedes(id) on delete cascade,
  fecha    date not null,
  abre     time,
  cierra   time,
  cerrado  boolean not null default true,
  motivo   text,
  unique (sede_id, fecha)
);

-- ---------------------------------------------------------------------
-- 4) caja_turno.turno_id — el puente con el histórico
-- Se agrega al lado de `turno`, no en su lugar. Queda NULL donde no hay certeza
-- (las letras sueltas) y eso es a propósito: un NULL honesto vale más que un
-- turno inventado. El reparador (scripts/reparar_turnos.js) lo va llenando.
-- ---------------------------------------------------------------------
alter table caja_turno add column if not exists turno_id uuid references sede_turnos(id);
create index if not exists caja_turno_turno_id on caja_turno (turno_id);

-- La etiqueta cruda con la que vino del Excel ('y', 'n', 'm'…). El reparador
-- corrige `turno` al código real, pero deja aquí lo que decía la pestaña: si
-- mañana resulta que una letra se interpretó mal, se puede rehacer. Sin esto la
-- reparación sería irreversible y a ciegas.
alter table caja_turno add column if not exists turno_origen text;

comment on column caja_turno.turno_origen is 'Lo que decía la pestaña del Excel antes de repararlo. NULL = nunca hizo falta tocarlo.';

-- caja_metas ya era (sede, día, turno): se le engancha el turno_id y así la
-- pantalla de Configuración puede generar una columna por turno REAL de la sede,
-- en vez de las dos fijas (Mañana/Tarde) que tiene cableadas hoy.
alter table caja_metas add column if not exists turno_id uuid references sede_turnos(id);

-- ---------------------------------------------------------------------
-- 5) Siembra: lo que dicen los DATOS, no lo que suponemos
--   Amazonas   → 2 turnos (218 días con dos turnos registrados)
--   Miraflores → 1 turno  (204 días con uno). Se siembra 'unico' ACTIVO, y
--                mañana/tarde INACTIVOS para sostener sus 178 turnos históricos.
--                El dueño decide luego cómo llamarlo y a qué hora: por eso esto
--                es una tabla y no una constante en el código.
--   Bulevar    → nada. Está inactiva y no tiene un solo turno registrado.
-- ---------------------------------------------------------------------
insert into sede_turnos (sede_id, codigo, nombre, orden, hora_inicio, hora_fin, activo)
select s.id, t.codigo, t.nombre, t.orden, t.ini::time, t.fin::time, t.activo
from sedes s
join (values
  ('Amazonas',   'manana', 'Mañana', 1, '10:00', '15:00', true),
  ('Amazonas',   'tarde',  'Tarde',  2, '15:00', '22:00', true),
  ('Miraflores', 'unico',  'Único',  1, '15:00', '22:00', true),
  ('Miraflores', 'manana', 'Mañana', 1, null,    null,    false),  -- histórico
  ('Miraflores', 'tarde',  'Tarde',  2, null,    null,    false)   -- histórico
) as t(sede, codigo, nombre, orden, ini, fin, activo) on t.sede = s.nombre
on conflict (sede_id, codigo) do nothing;

-- Horario por defecto: abierto todos los días, con las horas del turno.
-- Es solo un punto de partida para que la pantalla no salga vacía; el dueño lo
-- corrige desde Sedes.
insert into sede_horario (sede_id, dia_semana, turno_id, abre, cierra, cerrado)
select st.sede_id, d.dia, st.id, st.hora_inicio, st.hora_fin, false
from sede_turnos st
cross join generate_series(0, 6) as d(dia)
where st.activo
on conflict (sede_id, dia_semana, turno_id) do nothing;

-- ---------------------------------------------------------------------
-- 6) Backfill de turno_id donde el código YA coincide
-- Solo lo obvio: 'manana'→mañana, 'tarde'→tarde, 'unico'→único. Las letras
-- sueltas ('y','n','m','t'…) las resuelve scripts/reparar_turnos.js, que sabe de
-- qué Excel vino cada una — aquí no hay forma de saberlo.
-- ---------------------------------------------------------------------
update caja_turno ct
set turno_id = st.id
from sede_turnos st
where st.sede_id = ct.sede_id and st.codigo = ct.turno and ct.turno_id is null;

update caja_metas cm
set turno_id = st.id
from sede_turnos st
where st.sede_id = cm.sede_id and st.codigo = cm.turno and cm.turno_id is null;

-- ---------------------------------------------------------------------
-- 7) Permisos (sql/21: el piso `<tabla>_gerencia` ya lo pone el DO block de
-- allí, pero estas tablas nacen DESPUÉS, así que hay que dárselo a mano —
-- si no, nacen sin ninguna policy y con RLS activo = invisibles para todos).
-- Todo el personal necesita LEERLAS: sin saber qué turnos tiene su sede, la
-- cajera no puede ni abrir la caja.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sede_turnos', 'sede_horario', 'sede_horario_excepcion']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_gerencia', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (es_gerencia()) with check (es_gerencia())',
      t || '_gerencia', t);

    execute format('drop policy if exists %I on public.%I', t || '_lectura', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (es_personal())',
      t || '_lectura', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8) Vista: los turnos que una sede puede usar HOY
-- Para que la app no tenga que acordarse de filtrar por activo.
-- ---------------------------------------------------------------------
create or replace view vista_turnos_activos as
select st.id, st.sede_id, s.nombre as sede, st.codigo, st.nombre, st.orden,
       st.hora_inicio, st.hora_fin
from sede_turnos st
join sedes s on s.id = st.sede_id
where st.activo and s.activo
order by s.nombre, st.orden;

alter view vista_turnos_activos set (security_invoker = true);
