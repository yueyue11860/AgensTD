create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.normalize_core_resources(p_resources jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'gold', coalesce((p_resources->>'gold')::integer, 0),
    'heat', coalesce((p_resources->>'heat')::integer, (p_resources->>'energy')::integer, 20),
    'heat_limit', coalesce((p_resources->>'heat_limit')::integer, (p_resources->>'max_energy')::integer, 100),
    'mana', coalesce((p_resources->>'mana')::integer, 0),
    'mana_limit', coalesce((p_resources->>'mana_limit')::integer, 100),
    'repair', coalesce((p_resources->>'repair')::integer, 0),
    'threat', coalesce((p_resources->>'threat')::integer, 0),
    'fortress', coalesce((p_resources->>'fortress')::integer, (p_resources->>'lives')::integer, 100),
    'fortress_max', coalesce((p_resources->>'fortress_max')::integer, (p_resources->>'max_lives')::integer, 100)
  );
$$;

do $$
declare
  difficulty_labels text[];
begin
  if not exists (select 1 from pg_type where typname = 'agent_status') then
    create type public.agent_status as enum ('active', 'inactive', 'training', 'error');
  end if;

  if not exists (select 1 from pg_type where typname = 'run_status') then
    create type public.run_status as enum ('queued', 'running', 'completed', 'failed', 'timeout');
  end if;

  if not exists (select 1 from pg_type where typname = 'difficulty_level') then
    create type public.difficulty_level as enum ('EASY', 'NORMAL', 'HARD', 'HELL');
  else
    select array_agg(e.enumlabel order by e.enumsortorder)
      into difficulty_labels
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'difficulty_level';

    if difficulty_labels is distinct from array['EASY', 'NORMAL', 'HARD', 'HELL'] then
      drop view if exists public.season_rankings;
      drop view if exists public.agent_difficulty_progress;
      drop view if exists public.replay_library;
      drop function if exists public.enqueue_run(uuid, public.difficulty_level, bigint, integer, text, uuid);

      alter type public.difficulty_level rename to difficulty_level_legacy;
      create type public.difficulty_level as enum ('EASY', 'NORMAL', 'HARD', 'HELL');

      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'competition_runs'
          and column_name = 'difficulty'
      ) then
        alter table public.competition_runs alter column difficulty drop default;
        alter table public.competition_runs
          alter column difficulty type public.difficulty_level
          using (
            case difficulty::text
              when 'NIGHTMARE' then 'HELL'
              when 'INFERNO' then 'HELL'
              else difficulty::text
            end
          )::public.difficulty_level;
      end if;

      drop type public.difficulty_level_legacy;
    end if;
  end if;

  if not exists (select 1 from pg_type where typname = 'season_status') then
    create type public.season_status as enum ('upcoming', 'active', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'replay_visibility') then
    create type public.replay_visibility as enum ('public', 'private', 'unlisted');
  end if;

  if not exists (select 1 from pg_type where typname = 'run_event_type') then
    create type public.run_event_type as enum ('queued', 'started', 'tick', 'milestone', 'completed', 'failed', 'timeout');
  end if;

  if not exists (select 1 from pg_type where typname = 'ranking_trend') then
    create type public.ranking_trend as enum ('up', 'down', 'stable');
  end if;
end
$$;

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  status public.season_status not null default 'upcoming',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  owner_user_id uuid,
  owner_name text not null,
  latest_version text not null default '1.0.0',
  status public.agent_status not null default 'inactive',
  avatar_url text,
  visibility public.replay_visibility not null default 'public',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_active_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.competition_runs (
  id uuid primary key default gen_random_uuid(),
  run_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  agent_id uuid not null references public.agents(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,
  triggered_by uuid,
  difficulty public.difficulty_level not null,
  seed bigint not null,
  status public.run_status not null default 'queued',
  start_time timestamptz,
  end_time timestamptz,
  duration_ms integer,
  current_tick integer not null default 0,
  max_ticks integer not null default 50000,
  score integer not null default 0,
  wave integer not null default 0,
  max_wave integer not null default 50,
  resources jsonb not null default public.normalize_core_resources('{"gold":500,"heat":20,"heat_limit":100,"mana":100,"mana_limit":100,"repair":4,"threat":15,"fortress":100,"fortress_max":100}'::jsonb),
  towers_built integer not null default 0,
  enemies_killed integer not null default 0,
  damage_dealt bigint not null default 0,
  damage_taken bigint not null default 0,
  is_live boolean not null default false,
  replay_public boolean not null default true,
  view_count integer not null default 0,
  thumbnail_url text,
  error_message text,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists competition_runs_agent_status_idx on public.competition_runs(agent_id, status, created_at desc);
create index if not exists competition_runs_season_score_idx on public.competition_runs(season_id, score desc);
create index if not exists competition_runs_live_idx on public.competition_runs(is_live, updated_at desc);

create table if not exists public.run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.competition_runs(id) on delete cascade,
  event_type public.run_event_type not null,
  tick integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists run_events_run_id_created_at_idx on public.run_events(run_id, created_at desc);

create table if not exists public.run_snapshots (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.competition_runs(id) on delete cascade,
  tick integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (run_id, tick)
);

create index if not exists run_snapshots_run_id_tick_idx on public.run_snapshots(run_id, tick desc);

update public.competition_runs
set resources = public.normalize_core_resources(resources)
where jsonb_typeof(resources) = 'object'
  and resources is distinct from public.normalize_core_resources(resources);

update public.competition_runs
set result_summary = jsonb_set(result_summary, '{resources}', public.normalize_core_resources(result_summary->'resources'))
where jsonb_typeof(result_summary) = 'object'
  and jsonb_typeof(result_summary->'resources') = 'object'
  and (result_summary->'resources') is distinct from public.normalize_core_resources(result_summary->'resources');

update public.run_snapshots
set snapshot = jsonb_set(snapshot, '{game_state,resources}', public.normalize_core_resources(snapshot #> '{game_state,resources}'))
where jsonb_typeof(snapshot) = 'object'
  and jsonb_typeof(snapshot->'game_state') = 'object'
  and jsonb_typeof(snapshot #> '{game_state,resources}') = 'object'
  and (snapshot #> '{game_state,resources}') is distinct from public.normalize_core_resources(snapshot #> '{game_state,resources}');

alter table public.competition_runs drop constraint if exists competition_runs_resources_shape_check;
alter table public.competition_runs
  add constraint competition_runs_resources_shape_check
  check (
    jsonb_typeof(resources) = 'object'
    and resources ? 'gold'
    and resources ? 'heat'
    and resources ? 'heat_limit'
    and resources ? 'mana'
    and resources ? 'mana_limit'
    and resources ? 'repair'
    and resources ? 'threat'
    and resources ? 'fortress'
    and resources ? 'fortress_max'
  );

alter table public.competition_runs drop constraint if exists competition_runs_result_summary_object_check;
alter table public.competition_runs
  add constraint competition_runs_result_summary_object_check
  check (jsonb_typeof(result_summary) = 'object');

alter table public.run_events drop constraint if exists run_events_payload_object_check;
alter table public.run_events
  add constraint run_events_payload_object_check
  check (jsonb_typeof(payload) = 'object');

alter table public.run_snapshots drop constraint if exists run_snapshots_snapshot_object_check;
alter table public.run_snapshots
  add constraint run_snapshots_snapshot_object_check
  check (jsonb_typeof(snapshot) = 'object');

drop trigger if exists agents_set_updated_at on public.agents;
create trigger agents_set_updated_at
before update on public.agents
for each row
execute function public.set_updated_at();

drop trigger if exists seasons_set_updated_at on public.seasons;
create trigger seasons_set_updated_at
before update on public.seasons
for each row
execute function public.set_updated_at();

drop trigger if exists competition_runs_set_updated_at on public.competition_runs;
create trigger competition_runs_set_updated_at
before update on public.competition_runs
for each row
execute function public.set_updated_at();

create or replace view public.agent_overview as
select
  a.id,
  a.name,
  a.latest_version as version,
  a.owner_name as owner,
  a.created_at,
  a.last_active_at as last_active,
  count(r.id)::int as total_runs,
  coalesce(avg(case when r.status = 'completed' then 1 else 0 end), 0)::numeric(6,4) as win_rate,
  coalesce(avg(nullif(r.score, 0)), 0)::numeric(12,2) as avg_score,
  a.status,
  a.avatar_url as avatar
from public.agents a
left join public.competition_runs r on r.agent_id = a.id
group by a.id;

create or replace view public.replay_library as
select
  r.id as run_id,
  r.agent_id,
  a.name as agent_name,
  r.difficulty,
  r.seed,
  r.status,
  coalesce(r.start_time, r.created_at) as start_time,
  r.end_time,
  r.duration_ms,
  r.current_tick,
  r.max_ticks,
  r.score,
  r.wave,
  r.max_wave,
  r.resources,
  r.towers_built,
  r.enemies_killed,
  r.damage_dealt,
  r.damage_taken,
  r.is_live,
  r.view_count,
  r.thumbnail_url
from public.competition_runs r
join public.agents a on a.id = r.agent_id
where r.replay_public = true;

create or replace view public.agent_difficulty_progress as
with attempts as (
  select
    agent_id,
    difficulty,
    count(*)::int as attempts,
    max(score)::int as best_score,
    max(wave)::int as best_wave,
    bool_or(status = 'completed') as cleared,
    avg(case when status = 'completed' then 1 else 0 end)::numeric(6,4) as clear_rate
  from public.competition_runs
  group by agent_id, difficulty
)
select
  agent_id,
  difficulty,
  cleared,
  best_score,
  best_wave,
  attempts,
  clear_rate
from attempts;

create or replace view public.season_rankings as
with ranked as (
  select
    s.code as season_code,
    a.id as agent_id,
    a.name as agent_name,
    a.owner_name as owner,
    coalesce(sum(r.score), 0)::bigint as score,
    count(*) filter (where r.status = 'completed')::int as wins,
    count(*) filter (where r.status in ('failed', 'timeout'))::int as losses,
    coalesce(avg(case when r.status = 'completed' then 1 else 0 end), 0)::numeric(6,4) as win_rate,
    coalesce(avg(r.duration_ms), 0)::int as avg_duration_ms,
    coalesce(max(r.wave), 0)::int as highest_wave,
    coalesce(array_agg(distinct r.difficulty) filter (where r.status = 'completed'), '{}'::public.difficulty_level[])::text[] as difficulty_cleared,
    max(coalesce(r.end_time, r.created_at)) as last_match,
    row_number() over (partition by s.code order by coalesce(sum(r.score), 0) desc, coalesce(max(r.wave), 0) desc, a.created_at asc) as rank
  from public.seasons s
  join public.competition_runs r on r.season_id = s.id
  join public.agents a on a.id = r.agent_id
  group by s.code, a.id
), trend as (
  select
    ranked.*,
    'stable'::public.ranking_trend as trend,
    0::int as rank_change
  from ranked
)
select * from trend;

create or replace function public.enqueue_run(
  p_agent_id uuid,
  p_difficulty public.difficulty_level,
  p_seed bigint default floor(random() * 2147483647)::bigint,
  p_max_ticks integer default 50000,
  p_season_code text default null,
  p_triggered_by uuid default null
)
returns public.competition_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season_id uuid;
  v_run public.competition_runs;
begin
  if p_season_code is not null then
    select id into v_season_id
    from public.seasons
    where code = p_season_code
    limit 1;
  else
    select id into v_season_id
    from public.seasons
    where status = 'active'
    order by starts_at desc
    limit 1;
  end if;

  insert into public.competition_runs (
    agent_id,
    season_id,
    triggered_by,
    difficulty,
    seed,
    max_ticks,
    status,
    resources
  )
  values (
    p_agent_id,
    v_season_id,
    p_triggered_by,
    p_difficulty,
    p_seed,
    p_max_ticks,
    'queued',
    public.normalize_core_resources('{"gold":500,"heat":20,"heat_limit":100,"mana":100,"mana_limit":100,"repair":4,"threat":15,"fortress":100,"fortress_max":100}'::jsonb)
  )
  returning * into v_run;

  insert into public.run_events (run_id, event_type, payload)
  values (
    v_run.id,
    'queued',
    jsonb_build_object('difficulty', p_difficulty, 'seed', p_seed, 'max_ticks', p_max_ticks)
  );

  update public.agents
  set status = 'active', last_active_at = timezone('utc', now())
  where id = p_agent_id;

  return v_run;
end;
$$;

alter table public.seasons enable row level security;
alter table public.agents enable row level security;
alter table public.competition_runs enable row level security;
alter table public.run_events enable row level security;
alter table public.run_snapshots enable row level security;

drop policy if exists seasons_public_read on public.seasons;
create policy seasons_public_read on public.seasons
for select
to anon, authenticated
using (true);

drop policy if exists agents_public_read on public.agents;
create policy agents_public_read on public.agents
for select
to anon, authenticated
using (visibility <> 'private');

drop policy if exists runs_public_read on public.competition_runs;
create policy runs_public_read on public.competition_runs
for select
to anon, authenticated
using (replay_public = true);

drop policy if exists run_events_public_read on public.run_events;
create policy run_events_public_read on public.run_events
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.competition_runs r
    where r.id = run_events.run_id
      and r.replay_public = true
  )
);

drop policy if exists run_snapshots_public_read on public.run_snapshots;
create policy run_snapshots_public_read on public.run_snapshots
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.competition_runs r
    where r.id = run_snapshots.run_id
      and r.replay_public = true
  )
);

grant select on public.agent_overview to anon, authenticated;
grant select on public.replay_library to anon, authenticated;
grant select on public.agent_difficulty_progress to anon, authenticated;
grant select on public.season_rankings to anon, authenticated;
grant execute on function public.enqueue_run(uuid, public.difficulty_level, bigint, integer, text, uuid) to authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'agents'
    ) then
      alter publication supabase_realtime add table public.agents;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'competition_runs'
    ) then
      alter publication supabase_realtime add table public.competition_runs;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'run_events'
    ) then
      alter publication supabase_realtime add table public.run_events;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'run_snapshots'
    ) then
      alter publication supabase_realtime add table public.run_snapshots;
    end if;
  end if;
end
$$;