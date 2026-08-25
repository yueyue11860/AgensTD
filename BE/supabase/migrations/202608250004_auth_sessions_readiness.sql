-- Depends on no later migration. Must run before 005, which alters auth_sessions.
-- Re-run policy: create/index/security statements are idempotent for the schema created here.
-- Rollback policy: forward-fix or restore a verified backup; deleting sessions is not an automatic rollback.
begin;

create table if not exists public.oauth_states (
  state_hash text primary key,
  browser_binding_hash text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists oauth_states_expires_at_idx on public.oauth_states(expires_at);

create table if not exists public.auth_sessions (
  token_hash text primary key,
  user_id text not null,
  user_json jsonb not null,
  access_token text not null,
  refresh_token text not null,
  provider_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index if not exists auth_sessions_user_id_idx on public.auth_sessions(user_id);
create index if not exists auth_sessions_expiry_idx on public.auth_sessions(absolute_expires_at) where revoked_at is null;

create table if not exists public.service_persistence_probes (
  probe_id text primary key,
  service_name text not null,
  checked_at timestamptz not null
);

alter table public.oauth_states enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.service_persistence_probes enable row level security;

revoke all on table public.oauth_states from public, anon, authenticated;
revoke all on table public.auth_sessions from public, anon, authenticated;
revoke all on table public.service_persistence_probes from public, anon, authenticated;

grant select, insert, update, delete on table public.oauth_states to service_role;
grant select, insert, update, delete on table public.auth_sessions to service_role;
grant select, insert, update, delete on table public.service_persistence_probes to service_role;

commit;
