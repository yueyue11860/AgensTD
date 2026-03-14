create table if not exists public.run_actions (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.competition_runs(id) on delete cascade,
  tick integer not null default 0,
  action jsonb not null,
  accepted boolean not null default false,
  validation_code text,
  reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists run_actions_run_id_created_at_idx on public.run_actions(run_id, created_at desc);

alter table public.run_actions drop constraint if exists run_actions_action_object_check;
alter table public.run_actions
  add constraint run_actions_action_object_check
  check (jsonb_typeof(action) = 'object');

alter table public.run_actions enable row level security;

drop policy if exists run_actions_public_read on public.run_actions;
create policy run_actions_public_read on public.run_actions
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.competition_runs r
    where r.id = run_actions.run_id
      and r.replay_public = true
  )
);

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
        and tablename = 'run_actions'
    ) then
      alter publication supabase_realtime add table public.run_actions;
    end if;
  end if;
end
$$;