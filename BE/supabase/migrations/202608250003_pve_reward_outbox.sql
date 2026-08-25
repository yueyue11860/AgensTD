-- Durable PVE milestone ledger + recoverable settlement outbox.
-- Service role only: clients never write authoritative rewards.
-- Re-run policy: all DDL below is idempotent for the schema created by this migration.
-- Rollback policy: forward-fix or restore a verified backup; do not drop an outbox that may contain uncommitted rewards.
begin;

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

commit;
