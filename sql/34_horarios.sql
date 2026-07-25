-- =====================================================================
-- Sistema Cholao — Programación de horarios por persona y sede (v34)
--
-- Para qué se pidió:
--   1. Programar cuánta gente va a cada sede cada día (unos full, otros solo tarde).
--   2. Que cada quien pueda VER su horario desde su celular.
--   3. Tener la referencia de cuánto se le paga por hora, para las horas extra.
--
-- ⚠️ REGLA DEL USUARIO: los bonos y las horas extra se ponen **A MANO** desde el
-- panel de Gastos. Aquí NO se liquida nada automáticamente ni se cruza con la
-- asistencia. Esto programa y sirve de referencia; el pago lo decide una persona.
--
-- Se programa por FECHA (una fila por persona y día) y no con una plantilla
-- semanal fija: los turnos rotan, y con fechas la rotación sale sola. Para no
-- volver a teclear todo cada semana, la pantalla copia la semana anterior.
--
-- Ejecutar DESPUÉS de 33_consolidado_se_limpia.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Cuánto gana por hora. Es REFERENCIA para calcular una hora extra, no un
-- cálculo automático de planilla.
-- ---------------------------------------------------------------------
alter table personas add column if not exists pago_hora numeric(8,2);
comment on column personas.pago_hora is
  'Referencia de pago por hora, para estimar horas extra. El monto que se paga se registra a mano en Gastos.';

-- ---------------------------------------------------------------------
-- 2) La programación: una fila = una persona, un día, en una sede.
-- ---------------------------------------------------------------------
create table if not exists horarios_programados (
  id          uuid primary key default gen_random_uuid(),
  persona_id  uuid not null references personas(id) on delete cascade,
  sede_id     uuid references sedes(id),
  fecha       date not null,
  hora_inicio time not null,
  hora_fin    time not null,
  nota        text,
  creado_por  uuid references perfiles(id),
  created_at  timestamptz not null default now(),
  -- La misma persona puede tener dos bloques el mismo día (mañana y noche),
  -- pero no dos que empiecen a la misma hora.
  unique (persona_id, fecha, hora_inicio)
);
create index if not exists horarios_fecha on horarios_programados (fecha);
create index if not exists horarios_sede_fecha on horarios_programados (sede_id, fecha);
create index if not exists horarios_persona on horarios_programados (persona_id, fecha);

-- ---------------------------------------------------------------------
-- 3) RLS. La tabla nace DESPUÉS del piso de sql/23, así que necesita sus
-- policies a mano (el bucle de aquel ya corrió y no la alcanza).
-- ---------------------------------------------------------------------
alter table horarios_programados enable row level security;

-- Programar y corregir: super y admin.
drop policy if exists horarios_editar on horarios_programados;
create policy horarios_editar on horarios_programados
  for all to authenticated using (puede_editar()) with check (puede_editar());

-- Gerencia mira todo (necesita ver la dotación por sede).
drop policy if exists horarios_vertodo on horarios_programados;
create policy horarios_vertodo on horarios_programados
  for select to authenticated using (ve_todo());

-- Cada quien ve EL SUYO: se resuelve por perfiles.persona_id, que es lo que
-- une el login con la ficha de personal.
drop policy if exists horarios_mio on horarios_programados;
create policy horarios_mio on horarios_programados
  for select to authenticated
  using (persona_id = (select persona_id from perfiles where id = auth.uid()));

-- ---------------------------------------------------------------------
-- 4) Vista con las horas ya calculadas.
-- Si la hora de fin es menor que la de inicio, el turno cruza la medianoche
-- (entra 22:00, sale 02:00): se le suman 24 h en vez de dar negativo.
-- ---------------------------------------------------------------------
create or replace view vista_horarios as
select
  h.id, h.persona_id, h.sede_id, h.fecha, h.hora_inicio, h.hora_fin, h.nota,
  trim(p.nombres || ' ' || coalesce(p.apellidos, '')) as persona,
  p.pago_hora,
  s.nombre as sede,
  round((extract(epoch from (
    case when h.hora_fin >= h.hora_inicio then h.hora_fin - h.hora_inicio
         else h.hora_fin - h.hora_inicio + interval '24 hours' end
  )) / 3600)::numeric, 2) as horas
from horarios_programados h
join personas p on p.id = h.persona_id
left join sedes s on s.id = h.sede_id;
alter view vista_horarios set (security_invoker = true);
