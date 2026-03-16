create extension if not exists pgcrypto;

create table if not exists public.match_results (
  id uuid primary key default gen_random_uuid(),
  match_id text not null,
  player_id text not null,
  player_name text not null,
  player_kind text not null check (player_kind in ('human', 'agent')),
  survived_waves integer not null default 0,
  score integer not null default 0,
  fortress integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (match_id, player_id)
);

create table if not exists public.leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  player_id text not null,
  player_name text not null,
  player_kind text not null check (player_kind in ('human', 'agent')),
  best_survived_waves integer not null default 0,
  best_score integer not null default 0,
  last_match_id text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (player_id, player_kind)
);

create table if not exists public.match_replays (
  match_id text primary key,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  latest_tick integer not null default 0,
  frame_count integer not null default 0,
  action_count integer not null default 0,
  player_count integer not null default 0,
  top_wave integer not null default 0,
  top_score integer not null default 0,
  replay_json jsonb not null
);

grant usage on schema public to anon, authenticated;
grant select on public.leaderboard_entries to anon, authenticated;

alter table public.leaderboard_entries enable row level security;
alter table public.leaderboard_entries replica identity full;

drop policy if exists "Public can read leaderboard entries" on public.leaderboard_entries;

create policy "Public can read leaderboard entries"
on public.leaderboard_entries
for select
to anon, authenticated
using (true);

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leaderboard_entries'
  ) then
    execute 'alter publication supabase_realtime add table public.leaderboard_entries';
  end if;
end $$;