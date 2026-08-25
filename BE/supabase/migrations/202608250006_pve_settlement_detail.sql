-- Server-authored settlement narrative/performance/reward facts.
-- Nullable keeps pre-v1 outbox rows readable and recoverable.
-- Depends on 003_pve_reward_outbox.sql. Safe to re-run because the column is additive
-- and the named constraint is replaced deterministically.
-- Rollback policy: leave the nullable column in place and roll application code back;
-- do not delete settlement facts during an incident.
begin;

alter table public.pve_settlement_outbox
  add column if not exists detail_json jsonb;

alter table public.pve_settlement_outbox
  drop constraint if exists pve_settlement_outbox_detail_json_check;

alter table public.pve_settlement_outbox
  add constraint pve_settlement_outbox_detail_json_check
  check (detail_json is null or jsonb_typeof(detail_json) = 'object');

commit;
