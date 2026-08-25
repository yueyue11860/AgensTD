create extension if not exists pgcrypto;

-- Durable PVE milestone ledger + recoverable settlement outbox.
-- Service role only: clients never write authoritative rewards.
create table if not exists public.pve_reward_batches (
  batch_key text primary key,
  fingerprint text not null,
  match_id text not null,
  player_id text not null,
  combat_ruleset_version text not null,
  config_snapshot jsonb not null check (jsonb_typeof(config_snapshot) = 'object'),
  batch_kind text not null check (batch_kind in ('wave_milestone', 'match_outcome')),
  events_json jsonb not null default '[]'::jsonb check (jsonb_typeof(events_json) = 'array'),
  created_at timestamptz not null default now()
);

create index if not exists pve_reward_batches_player_match_idx
  on public.pve_reward_batches (match_id, player_id, batch_key);

create table if not exists public.pve_settlement_outbox (
  settlement_id text primary key,
  fingerprint text not null,
  match_id text not null,
  player_id text not null,
  combat_ruleset_version text not null,
  config_snapshot jsonb not null check (jsonb_typeof(config_snapshot) = 'object'),
  reward_table_revision text not null,
  input_json jsonb not null check (jsonb_typeof(input_json) = 'object'),
  detail_json jsonb check (detail_json is null or jsonb_typeof(detail_json) = 'object'),
  status text not null check (status in ('pending', 'committed', 'failed')),
  attempts integer not null default 1 check (attempts >= 1),
  last_error text,
  settlement_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'committed' and settlement_json is not null)
    or status in ('pending', 'failed')
  )
);

create index if not exists pve_settlement_outbox_recovery_idx
  on public.pve_settlement_outbox (status, updated_at)
  where status in ('pending', 'failed');

create index if not exists pve_settlement_outbox_player_match_idx
  on public.pve_settlement_outbox (match_id, player_id);

alter table public.pve_reward_batches enable row level security;
alter table public.pve_settlement_outbox enable row level security;

revoke all on public.pve_reward_batches from anon, authenticated;
revoke all on public.pve_settlement_outbox from anon, authenticated;
grant all on public.pve_reward_batches to service_role;
grant all on public.pve_settlement_outbox to service_role;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 用户表：由 Supabase Auth 的 auth.users 同步游戏公开资料
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists public.users (
  id text primary key,                  -- auth.users.id（UUID 的文本形式）
  name text not null default '',
  email text not null default '',
  avatar text not null default '',
  bio text not null default '',
  route text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 用户游戏进度表：关卡通关记录、排行榜数据
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists public.user_progress (
  player_id text primary key references public.users(id),
  player_type text not null default 'HUMAN' check (player_type in ('HUMAN', 'AGENT')),
  highest_unlocked_level integer not null default 1,
  level5_clear_count integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

grant select on public.users to anon, authenticated;
grant select on public.user_progress to anon, authenticated;

alter table public.user_progress enable row level security;

drop policy if exists "Public can read user progress" on public.user_progress;
create policy "Public can read user progress"
on public.user_progress for select to anon, authenticated using (true);

create or replace function public.sync_auth_user_to_game_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, name, email, avatar, updated_at)
  values (
    new.id::text,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), new.id::text),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', ''),
    timezone('utc', now())
  )
  on conflict (id) do update set
    name = excluded.name,
    email = excluded.email,
    avatar = excluded.avatar,
    updated_at = excluded.updated_at;

  insert into public.user_progress (player_id, player_type)
  values (new.id::text, 'HUMAN')
  on conflict (player_id) do nothing;
  return new;
end;
$$;

drop trigger if exists sync_auth_user_to_game_profile on auth.users;
create trigger sync_auth_user_to_game_profile
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.sync_auth_user_to_game_profile();

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
