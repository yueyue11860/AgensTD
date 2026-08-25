-- 武器/道具共用的局外账户。可重复执行；player_id 故意不关联 users。
create table if not exists public.player_accounts (
  player_id text primary key,
  version bigint not null default 0 check (version >= 0),
  account_json jsonb not null check (jsonb_typeof(account_json) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.player_accounts
  add column if not exists version bigint not null default 0,
  add column if not exists account_json jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists player_accounts_updated_at_idx
  on public.player_accounts (updated_at desc);

alter table public.player_accounts enable row level security;

-- 整个账户 JSON 在单行内原子 CAS，避免钱包、购买权、碎片和结算单分步落库。
create or replace function public.cas_player_account(
  p_player_id text,
  p_expected_version bigint,
  p_next_account jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
  next_version bigint;
begin
  if p_player_id is null or p_player_id = '' or jsonb_typeof(p_next_account) <> 'object' then
    return false;
  end if;
  if p_next_account ->> 'playerId' is distinct from p_player_id then
    return false;
  end if;
  begin
    next_version := (p_next_account ->> 'version')::bigint;
  exception when others then
    return false;
  end;
  if next_version <> p_expected_version + 1 then
    return false;
  end if;

  update public.player_accounts
     set version = next_version,
         account_json = p_next_account,
         updated_at = coalesce((p_next_account ->> 'updatedAt')::timestamptz, now())
   where player_id = p_player_id
     and version = p_expected_version;
  get diagnostics affected = row_count;
  return affected = 1;
exception when others then
  return false;
end;
$$;

revoke all on function public.cas_player_account(text, bigint, jsonb) from public;
grant execute on function public.cas_player_account(text, bigint, jsonb) to service_role;

