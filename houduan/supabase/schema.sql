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