-- Fix PVE lease activation on databases that already applied 202608250007.
-- `match_id` is also a return-table variable in the PL/pgSQL function, so an
-- unqualified ON CONFLICT target is ambiguous at runtime.
begin;

create or replace function public.claim_pve_match_lease(
  p_match_id text, p_room_id text, p_holder_id text, p_ttl_ms integer
) returns table(match_id text, room_id text, holder_id text, generation bigint, lease_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if p_ttl_ms < 5000 then raise exception 'PVE_LEASE_TTL_INVALID'; end if;
  insert into public.pve_match_leases as lease(match_id, room_id, holder_id, generation, lease_expires_at, updated_at)
  values (p_match_id, p_room_id, p_holder_id, 1, clock_timestamp() + make_interval(secs => p_ttl_ms / 1000.0), clock_timestamp())
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

revoke all on function public.claim_pve_match_lease(text,text,text,integer) from public;
grant execute on function public.claim_pve_match_lease(text,text,text,integer) to service_role;

commit;
