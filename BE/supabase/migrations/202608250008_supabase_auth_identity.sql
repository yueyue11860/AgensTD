-- Re-run policy: function replacement, trigger recreation and upserts are idempotent.
-- Rollback policy: forward-fix the trigger/function; never delete player profiles or progress automatically.
-- Legacy oauth_states/auth_sessions tables from migrations 004/005 are intentionally left untouched
-- for deployment-history safety, but the application no longer reads or writes them.
begin;

comment on table public.users is 'Game profiles keyed by Supabase Auth auth.users.id (stored as text).';

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

insert into public.users (id, name, email, avatar, updated_at)
select
  identity.id::text,
  coalesce(nullif(identity.raw_user_meta_data ->> 'display_name', ''), nullif(split_part(coalesce(identity.email, ''), '@', 1), ''), identity.id::text),
  coalesce(identity.email, ''),
  coalesce(identity.raw_user_meta_data ->> 'avatar_url', identity.raw_user_meta_data ->> 'picture', ''),
  timezone('utc', now())
from auth.users identity
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  avatar = excluded.avatar,
  updated_at = excluded.updated_at;

insert into public.user_progress (player_id, player_type)
select identity.id::text, 'HUMAN'
from auth.users identity
on conflict (player_id) do nothing;

commit;
