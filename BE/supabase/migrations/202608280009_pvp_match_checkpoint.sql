-- Durable, process-fenced PVP authority checkpoints.
begin;

create table if not exists public.pvp_match_leases (
  match_id text primary key,
  holder_id text not null,
  generation bigint not null check (generation >= 1),
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.pvp_match_checkpoints (
  match_id text primary key references public.pvp_match_leases(match_id) on delete restrict,
  generation bigint not null check (generation >= 1),
  schema_version smallint not null check (schema_version = 1),
  checkpoint_tick bigint not null check (checkpoint_tick >= 0),
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  runtime_json jsonb not null check (jsonb_typeof(runtime_json) = 'object'),
  metadata_json jsonb not null check (jsonb_typeof(metadata_json) = 'object'),
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists pvp_match_checkpoints_tick_idx on public.pvp_match_checkpoints(checkpoint_tick desc);

create or replace function public.claim_pvp_match_lease(p_match_id text, p_holder_id text, p_ttl_ms integer)
returns table(match_id text, holder_id text, generation bigint, lease_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if p_ttl_ms < 5000 then raise exception 'PVP_LEASE_TTL_INVALID'; end if;
  insert into public.pvp_match_leases as lease(match_id, holder_id, generation, lease_expires_at, updated_at)
  values (p_match_id, p_holder_id, 1, clock_timestamp() + make_interval(secs => p_ttl_ms / 1000.0), clock_timestamp())
  on conflict (match_id) do update set holder_id = excluded.holder_id,
    generation = case when lease.holder_id = excluded.holder_id and lease.lease_expires_at > clock_timestamp() then lease.generation else lease.generation + 1 end,
    lease_expires_at = excluded.lease_expires_at, updated_at = clock_timestamp()
  where lease.holder_id = excluded.holder_id or lease.lease_expires_at <= clock_timestamp();
  if not found then raise exception 'PVP_LEASE_HELD'; end if;
  return query select l.match_id, l.holder_id, l.generation, l.lease_expires_at from public.pvp_match_leases l where l.match_id = p_match_id;
end $$;

create or replace function public.renew_pvp_match_lease(p_match_id text, p_holder_id text, p_generation bigint, p_ttl_ms integer)
returns table(match_id text, holder_id text, generation bigint, lease_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if p_ttl_ms < 5000 then raise exception 'PVP_LEASE_TTL_INVALID'; end if;
  return query update public.pvp_match_leases l set lease_expires_at = clock_timestamp() + make_interval(secs => p_ttl_ms / 1000.0), updated_at = clock_timestamp()
  where l.match_id = p_match_id and l.holder_id = p_holder_id and l.generation = p_generation and l.lease_expires_at > clock_timestamp()
  returning l.match_id, l.holder_id, l.generation, l.lease_expires_at;
end $$;
create or replace function public.save_pvp_match_checkpoint(p_match_id text, p_holder_id text, p_generation bigint, p_checkpoint_tick bigint, p_state_hash text, p_runtime_json jsonb, p_metadata_json jsonb, p_created_at timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select true into ok from public.pvp_match_leases l where l.match_id = p_match_id and l.holder_id = p_holder_id and l.generation = p_generation and l.lease_expires_at > clock_timestamp() for update;
  if coalesce(ok, false) is not true then raise exception 'PVP_LEASE_FENCED'; end if;
  insert into public.pvp_match_checkpoints as c(match_id,generation,schema_version,checkpoint_tick,state_hash,runtime_json,metadata_json,created_at,updated_at)
  values(p_match_id,p_generation,1,p_checkpoint_tick,p_state_hash,p_runtime_json,p_metadata_json,p_created_at,clock_timestamp())
  on conflict(match_id) do update set generation=excluded.generation, checkpoint_tick=excluded.checkpoint_tick, state_hash=excluded.state_hash, runtime_json=excluded.runtime_json, metadata_json=excluded.metadata_json, created_at=excluded.created_at, updated_at=clock_timestamp()
  where c.generation < excluded.generation or (c.generation = excluded.generation and c.checkpoint_tick <= excluded.checkpoint_tick);
  if not found then raise exception 'PVP_CHECKPOINT_CONFLICT'; end if;
  return true;
end $$;

alter table public.pvp_match_leases enable row level security;
alter table public.pvp_match_checkpoints enable row level security;
revoke all on public.pvp_match_leases, public.pvp_match_checkpoints from public, anon, authenticated;
grant select, insert, update, delete on public.pvp_match_leases, public.pvp_match_checkpoints to service_role;
grant execute on function public.claim_pvp_match_lease(text,text,integer), public.renew_pvp_match_lease(text,text,bigint,integer), public.save_pvp_match_checkpoint(text,text,bigint,bigint,text,jsonb,jsonb,timestamptz) to service_role;
commit;
