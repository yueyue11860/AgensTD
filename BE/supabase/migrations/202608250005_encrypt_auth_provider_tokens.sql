-- Depends on 004_auth_sessions_readiness.sql.
-- Re-run policy: additive columns and named constraints are safe to re-apply.
-- Rollback policy changes after backfill clears plaintext; see the production release runbook.
begin;

-- Phase 1: deploy additive columns while the old plaintext columns still exist.
alter table public.auth_sessions
  add column if not exists access_token_ciphertext text,
  add column if not exists access_token_key_id text,
  add column if not exists access_token_cipher_version smallint,
  add column if not exists refresh_token_ciphertext text,
  add column if not exists refresh_token_key_id text,
  add column if not exists refresh_token_cipher_version smallint;

alter table public.auth_sessions
  alter column access_token drop not null,
  alter column refresh_token drop not null;

alter table public.auth_sessions
  drop constraint if exists auth_sessions_access_cipher_complete,
  add constraint auth_sessions_access_cipher_complete check (
    (access_token_ciphertext is null and access_token_key_id is null and access_token_cipher_version is null)
    or
    (access_token_ciphertext is not null and access_token_key_id is not null and access_token_cipher_version = 1)
  ) not valid,
  drop constraint if exists auth_sessions_refresh_cipher_complete,
  add constraint auth_sessions_refresh_cipher_complete check (
    (refresh_token_ciphertext is null and refresh_token_key_id is null and refresh_token_cipher_version is null)
    or
    (refresh_token_ciphertext is not null and refresh_token_key_id is not null and refresh_token_cipher_version = 1)
  ) not valid;

comment on column public.auth_sessions.access_token_ciphertext is 'Versioned AES-256-GCM envelope; key material is never stored in Postgres.';
comment on column public.auth_sessions.refresh_token_ciphertext is 'Versioned AES-256-GCM envelope; key material is never stored in Postgres.';

commit;

-- Phase 2 is deliberately outside this transaction:
-- run `pnpm auth:tokens:migrate -- backfill`, verify audit succeeds, then deploy the
-- encrypted-only server. The CLI strictly clears access_token/refresh_token.
