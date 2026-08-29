-- Durable authoritative PVE checkpoint, fenced process lease and action inbox.
-- Depends on 003 reward/outbox and the PVE V2 ruleset snapshot fields.
-- Re-run policy: tables/indexes are additive; functions are replaced deterministically.
-- Rollback policy: stop traffic and roll application code back while retaining recovery facts.
begin;

create table if not exists public.pve_match_leases (
  match_id text primary key,
  room_id text not null,
  holder_id text not null,
  generation bigint not null check (generation >= 1),
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.pve_match_checkpoints (
  match_id text primary key references public.pve_match_leases(match_id) on delete restrict,
  room_id text not null,
  generation bigint not null check (generation >= 1),
  schema_version smallint not null check (schema_version = 1),
  checkpoint_tick bigint not null check (checkpoint_tick >= 0),
  last_action_sequence bigint not null check (last_action_sequence >= 0),
  combat_ruleset_version text not null,
  config_snapshot jsonb not null check (jsonb_typeof(config_snapshot) = 'object'),
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb not null check (jsonb_typeof(payload_json) = 'object'),
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists pve_match_checkpoints_room_updated_idx
  on public.pve_match_checkpoints(room_id, updated_at desc);

create table if not exists public.pve_match_actions (
  action_sequence bigint generated always as identity primary key,
  match_id text not null references public.pve_match_leases(match_id) on delete restrict,
  room_id text not null,
  generation bigint not null check (generation >= 1),
  player_id text not null,
  request_id text not null,
  action_id text not null,
  fingerprint text not null,
  payload_json jsonb not null check (jsonb_typeof(payload_json) = 'object'),
  server_tick bigint not null check (server_tick >= 0),
  rate_limit_remaining integer not null check (rate_limit_remaining >= 0),
  created_at timestamptz not null default now(),
  unique(match_id, player_id, request_id),
  unique(match_id, action_id)
);

create index if not exists pve_match_actions_replay_idx
  on public.pve_match_actions(match_id, action_sequence);

create or replace function public.claim_pve_match_lease(
  p_match_id text, p_room_id text, p_holder_id text, p_ttl_ms integer
) returns table(match_id text, room_id text, holder_id text, generation bigint, lease_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if p_ttl_ms < 5000 then raise exception 'PVE_LEASE_TTL_INVALID'; end if;
  insert into public.pve_match_leases as lease(match_id, room_id, holder_id, generation, lease_expires_at, updated_at)
  values (p_match_id, p_room_id, p_holder_id, 1, clock_timestamp() + make_interval(secs => p_ttl_ms / 1000.0), clock_timestamp())
  -- The function exposes a return-table column named match_id.  Qualifying
  -- the conflict target via the primary-key constraint avoids PostgreSQL
  -- resolving `match_id` against that PL/pgSQL output variable instead of the
  -- table column (which otherwise aborts every new PVE match activation).
  on conflict on constraint pve_match_leases_pkey do update set
    room_id = excluded.room_id,
    holder_id = excluded.holder_id,
    generation = case
      when lease.holder_id = excluded.holder_id and lease.room_id = excluded.room_id
        and lease.lease_expires_at > clock_timestamp()
      then lease.generation
      else lease.generation + 1
    end,
    lease_expires_at = excluded.lease_expires_at,
    updated_at = clock_timestamp()
  where (lease.holder_id = excluded.holder_id and lease.room_id = excluded.room_id)
    or lease.lease_expires_at <= clock_timestamp();
  if not found then raise exception 'PVE_LEASE_HELD'; end if;
  return query select l.match_id, l.room_id, l.holder_id, l.generation, l.lease_expires_at
    from public.pve_match_leases l where l.match_id = p_match_id;
end $$;

create or replace function public.renew_pve_match_lease(
  p_match_id text, p_holder_id text, p_generation bigint, p_ttl_ms integer
) returns table(match_id text, room_id text, holder_id text, generation bigint, lease_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if p_ttl_ms < 5000 then raise exception 'PVE_LEASE_TTL_INVALID'; end if;
  return query update public.pve_match_leases l set
    lease_expires_at = clock_timestamp() + make_interval(secs => p_ttl_ms / 1000.0), updated_at = clock_timestamp()
  where l.match_id = p_match_id and l.holder_id = p_holder_id and l.generation = p_generation
    and l.lease_expires_at > clock_timestamp()
  returning l.match_id, l.room_id, l.holder_id, l.generation, l.lease_expires_at;
end $$;

create or replace function public.save_pve_match_checkpoint(
  p_match_id text, p_room_id text, p_holder_id text, p_generation bigint,
  p_schema_version smallint, p_checkpoint_tick bigint, p_last_action_sequence bigint,
  p_combat_ruleset_version text, p_config_snapshot jsonb, p_state_hash text,
  p_payload_json jsonb, p_created_at timestamptz
) returns boolean language plpgsql security definer set search_path = public as $$
declare lease_ok boolean;
begin
  -- Serialize the lease check with claim/renew/reserve. Without FOR UPDATE an old holder
  -- can pass this check, lose the lease concurrently, and still commit a stale checkpoint.
  select true into lease_ok from public.pve_match_leases l
  where l.match_id = p_match_id and l.room_id = p_room_id and l.holder_id = p_holder_id
    and l.generation = p_generation and l.lease_expires_at > clock_timestamp()
  for update;
  if coalesce(lease_ok, false) is not true then raise exception 'PVE_LEASE_FENCED'; end if;
  insert into public.pve_match_checkpoints as checkpoint(
    match_id, room_id, generation, schema_version, checkpoint_tick, last_action_sequence,
    combat_ruleset_version, config_snapshot, state_hash, payload_json, created_at, updated_at
  ) values (
    p_match_id, p_room_id, p_generation, p_schema_version, p_checkpoint_tick, p_last_action_sequence,
    p_combat_ruleset_version, p_config_snapshot, p_state_hash, p_payload_json, p_created_at, clock_timestamp()
  ) on conflict (match_id) do update set
    room_id = excluded.room_id, generation = excluded.generation, schema_version = excluded.schema_version,
    checkpoint_tick = excluded.checkpoint_tick, last_action_sequence = excluded.last_action_sequence,
    combat_ruleset_version = excluded.combat_ruleset_version, config_snapshot = excluded.config_snapshot,
    state_hash = excluded.state_hash, payload_json = excluded.payload_json,
    created_at = excluded.created_at, updated_at = clock_timestamp()
  where checkpoint.generation < excluded.generation
    or (checkpoint.generation = excluded.generation and checkpoint.checkpoint_tick <= excluded.checkpoint_tick);
  if not found then raise exception 'PVE_CHECKPOINT_CONFLICT'; end if;
  return true;
end $$;

create or replace function public.reserve_pve_match_action(
  p_match_id text, p_room_id text, p_holder_id text, p_generation bigint,
  p_player_id text, p_request_id text, p_action_id text, p_fingerprint text,
  p_payload_json jsonb, p_server_tick bigint, p_rate_limit_remaining integer, p_ttl_ms integer
) returns table(disposition text, record_json jsonb)
language plpgsql security definer set search_path = public as $$
declare existing public.pve_match_actions%rowtype;
begin
  if p_ttl_ms < 5000 then raise exception 'PVE_LEASE_TTL_INVALID'; end if;
  update public.pve_match_leases l set
    lease_expires_at = clock_timestamp() + make_interval(secs => p_ttl_ms / 1000.0), updated_at = clock_timestamp()
  where l.match_id = p_match_id and l.room_id = p_room_id and l.holder_id = p_holder_id
    and l.generation = p_generation and l.lease_expires_at > clock_timestamp();
  if not found then raise exception 'PVE_LEASE_FENCED'; end if;
  select * into existing from public.pve_match_actions a
    where a.match_id = p_match_id and a.player_id = p_player_id and a.request_id = p_request_id;
  if found then
    return query select case when existing.fingerprint = p_fingerprint then 'duplicate' else 'conflict' end,
      to_jsonb(existing);
    return;
  end if;
  insert into public.pve_match_actions(
    match_id, room_id, generation, player_id, request_id, action_id, fingerprint,
    payload_json, server_tick, rate_limit_remaining
  ) values (
    p_match_id, p_room_id, p_generation, p_player_id, p_request_id, p_action_id, p_fingerprint,
    p_payload_json, p_server_tick, p_rate_limit_remaining
  ) returning * into existing;
  return query select 'reserved'::text, to_jsonb(existing);
exception when unique_violation then
  select * into existing from public.pve_match_actions a
    where a.match_id = p_match_id and a.player_id = p_player_id and a.request_id = p_request_id;
  if not found then raise; end if;
  return query select case when existing.fingerprint = p_fingerprint then 'duplicate' else 'conflict' end,
    to_jsonb(existing);
end $$;

alter table public.pve_match_leases enable row level security;
alter table public.pve_match_checkpoints enable row level security;
alter table public.pve_match_actions enable row level security;
revoke all on public.pve_match_leases, public.pve_match_checkpoints, public.pve_match_actions from public, anon, authenticated;
grant select, insert, update, delete on public.pve_match_leases, public.pve_match_checkpoints, public.pve_match_actions to service_role;
grant usage, select on sequence public.pve_match_actions_action_sequence_seq to service_role;
revoke all on function public.claim_pve_match_lease(text,text,text,integer) from public;
revoke all on function public.renew_pve_match_lease(text,text,bigint,integer) from public;
revoke all on function public.save_pve_match_checkpoint(text,text,text,bigint,smallint,bigint,bigint,text,jsonb,text,jsonb,timestamptz) from public;
revoke all on function public.reserve_pve_match_action(text,text,text,bigint,text,text,text,text,jsonb,bigint,integer,integer) from public;
grant execute on function public.claim_pve_match_lease(text,text,text,integer) to service_role;
grant execute on function public.renew_pve_match_lease(text,text,bigint,integer) to service_role;
grant execute on function public.save_pve_match_checkpoint(text,text,text,bigint,smallint,bigint,bigint,text,jsonb,text,jsonb,timestamptz) to service_role;
grant execute on function public.reserve_pve_match_action(text,text,text,bigint,text,text,text,text,jsonb,bigint,integer,integer) to service_role;

commit;
